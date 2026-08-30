/**
 * Hotel book/cancel service (issue #67; CLAUDE.md rules 7/8).
 *
 * The ONLY way a hotel gets booked, on every surface (rule 2 — per-surface
 * differences arrive as parameters):
 *
 *   requireBookableOffer (signed, checked, unexpired — THE gate, rule 8)
 *   → create Booking + BookingItem(quoted)  [idempotent on clientReference]
 *   → runner: quoted → reserved
 *   → adapter book() through the registry, clientReference passed through
 *     (supplier-side idempotency: one clientReference, one booking)
 *   → runner: reserved → confirmed | pending_confirmation
 *     (supplier failure after reserve → reserved → failed, with
 *     compensation notes on the audit event)
 *
 * Retry safety end to end: the booking table's UNIQUE clientReference makes
 * a retried call return the ORIGINAL booking (never a second row), and the
 * adapter passes the same clientReference to the supplier, so even a retry
 * that races a crashed first attempt cannot double-book supplier-side.
 *
 * Cancellation: the fee is previewed from the STORED normalized policy
 * (resolvePenaltyAt) BEFORE any supplier call; async supplier cancellation
 * (TBO CancellationInProgress) parks the item as a pending-cancel wait the
 * worker settles — penalty postings then use the fee quoted at request time.
 */

import type { Locale, Money, SalesChannel, SubTenantId, TenantId } from "@jenova/domain";
import {
  isSupplierError,
  resolvePenaltyAt,
  subtract,
  zero,
  type BookingItemState,
  type CancellationPolicy,
} from "@jenova/domain";
import type {
  AdapterCallContext,
  HotelBookingHolder,
  HotelBookingRecord,
  HotelRoomGuests,
  HotelSupplierAdapter,
} from "@jenova/supplier-sdk";
import {
  BookingTransitionRunner,
  DEFAULT_PENDING_BACKOFF,
  loadBookingWithItems,
  type AuditActor,
  type BookingItemRow,
  type BookingRow,
} from "@jenova/booking-engine";
import { bookingItems, bookings, type TenantDbResolver } from "@jenova/db";
import { eq } from "drizzle-orm";
import type { SupplierCredentialsSource, SupplierRegistry } from "@jenova/supplier-registry";
import { SupplierUnavailableError } from "../offers/errors";
import type { OffersService, VerifiedOffer } from "../offers/offers.service";
import { BookingError } from "./errors";

export const HOTEL_BOOKING_SERVICE = Symbol("jenova.api.hotelBookingService");
export const BOOKING_TRANSITION_RUNNER = Symbol("jenova.api.bookingTransitionRunner");

export interface BookHotelInput {
  readonly offerToken: string;
  /** Caller idempotency key (rule 8) — one clientReference, one booking. */
  readonly clientReference: string;
  readonly holder: HotelBookingHolder;
  /** Guests per room, same order as the offer's occupancy. */
  readonly rooms: readonly HotelRoomGuests[];
  readonly channel: SalesChannel;
  readonly subTenantId: SubTenantId | null;
  readonly actor: AuditActor;
  readonly locale?: Locale;
}

export interface BookHotelResult {
  readonly bookingId: string;
  readonly bookingItemId: string;
  readonly clientReference: string;
  readonly state: BookingItemState;
  readonly supplierReference: string | null;
  readonly sell: Money;
  /** True when this call replayed an existing clientReference. */
  readonly idempotentReplay: boolean;
}

export interface CancellationPreview {
  /** Penalty in force NOW per the stored normalized policy. */
  readonly penalty: Money;
  /** sell − penalty when currencies agree; null when they differ (FX at ledger time only). */
  readonly refund: Money | null;
  readonly refundable: boolean;
  readonly asOf: Date;
}

export type CancelBookingStatus = "cancelled" | "cancellation_pending";

export interface CancelBookingResult {
  readonly bookingId: string;
  readonly bookingItemId: string;
  readonly status: CancelBookingStatus;
  readonly state: BookingItemState;
  readonly preview: CancellationPreview;
}

export interface HotelBookingServiceOptions {
  /** Supplier call budget per book/cancel/retrieve hop, ms (default 30s). */
  readonly supplierDeadlineMs?: number;
  readonly now?: () => Date;
}

interface CallScope {
  readonly subTenantId: SubTenantId | null;
  readonly actor: AuditActor;
  readonly locale?: Locale;
}

export class HotelBookingService {
  private readonly supplierDeadlineMs: number;
  private readonly now: () => Date;

  constructor(
    private readonly resolver: TenantDbResolver,
    private readonly offers: OffersService,
    private readonly registry: SupplierRegistry,
    private readonly credentials: SupplierCredentialsSource,
    private readonly runner: BookingTransitionRunner,
    options: HotelBookingServiceOptions = {},
  ) {
    this.supplierDeadlineMs = options.supplierDeadlineMs ?? 30_000;
    this.now = options.now ?? (() => new Date());
  }

  async bookHotel(tenant: TenantId, input: BookHotelInput): Promise<BookHotelResult> {
    if (input.clientReference.length === 0 || input.clientReference.length > 64) {
      throw new BookingError("booking_request_invalid", "clientReference must be 1..64 characters");
    }
    // Idempotency FIRST: a retry of an already-successful call must return
    // the original booking even though that call consumed the offer (the
    // offer gate would otherwise answer offer_invalidated to a retry). The
    // race window this read leaves is closed by createHotelBooking's unique
    // constraint below.
    const replayed = await this.findByClientReference(tenant, input);
    if (replayed !== null) {
      return replayed;
    }
    // THE gate (rule 8): verified signature + unexpired + not invalidated +
    // recent successful check, scoped to the calling agency.
    const offer = await this.offers.requireBookableOffer(tenant, input.offerToken, {
      subTenantId: input.subTenantId,
    });
    const policy = this.requirePolicy(offer);
    this.assertGuestsMatchOccupancy(input.rooms, offer);

    const created = await this.runner.createHotelBooking(tenant, {
      clientReference: input.clientReference,
      channel: input.channel,
      agencyId: input.subTenantId,
      supplierCode: offer.supplierCode,
      vertical: offer.vertical,
      offerId: offer.id,
      net: offer.net,
      sell: offer.sell,
      policySnapshot: policy,
      actor: input.actor,
    });
    if (!created.created) {
      // Idempotent replay: the clientReference already booked (or is mid
      // flight / failed). Return the ORIGINAL state — never re-drive the
      // supplier from a replayed call.
      return this.toBookResult(created.booking, created.item, true);
    }
    const { booking, item } = created;

    await this.runner.transition(tenant, item.id, "reserved", {
      expectedFrom: "quoted",
      actor: input.actor,
      reason: "bookable offer verified — reserving with the supplier",
    });

    const adapter = this.hotelAdapterFor(offer.supplierCode);
    let record: HotelBookingRecord;
    try {
      record = await adapter.book(await this.callContext(tenant, offer, input.locale), {
        supplierOfferToken: offer.supplierOfferToken,
        holder: input.holder,
        rooms: input.rooms,
        clientReference: input.clientReference,
      });
    } catch (error) {
      await this.failAfterReserve(tenant, item.id, input, error);
      // One book attempt per offer: whatever the failure, this offer is
      // spent (sold_out/price_changed are dead anyway; on a timeout the
      // supplier MAY hold a reservation — see the compensation note).
      await this.offers.invalidateOffer(tenant, offer.id);
      throw error;
    }

    if (record.clientReference !== "" && record.clientReference !== input.clientReference) {
      // Adapter contract violation — an invariant failure, never mappable.
      throw new Error(
        `adapter ${offer.supplierCode} echoed clientReference ${record.clientReference} for ${input.clientReference}`,
      );
    }

    const supplierReference = record.supplierBookingReference;
    let state: BookingItemState;
    if (record.status === "confirmed") {
      state = "confirmed";
      await this.runner.transition(tenant, item.id, "confirmed", {
        expectedFrom: "reserved",
        actor: input.actor,
        reason: "supplier confirmed the booking synchronously",
        patch: { supplierReference },
        details: { supplierStatus: record.status },
      });
    } else if (record.status === "pending") {
      state = "pending_confirmation";
      const now = this.now();
      await this.runner.transition(tenant, item.id, "pending_confirmation", {
        expectedFrom: "reserved",
        actor: input.actor,
        reason: "supplier accepted the booking pending confirmation — worker polls retrieve()",
        patch: {
          supplierReference,
          pendingSince: now,
          nextPollAt: new Date(now.getTime() + DEFAULT_PENDING_BACKOFF.baseMs),
        },
        details: { supplierStatus: record.status },
      });
    } else {
      // "cancelled" straight from book(): the supplier voided its own
      // reservation. Nothing was recognized; surface as a failed booking.
      state = "failed";
      await this.runner.transition(tenant, item.id, "failed", {
        expectedFrom: "reserved",
        actor: input.actor,
        reason: "supplier reported the booking cancelled at creation",
        patch: { supplierReference },
        details: {
          supplierStatus: record.status,
          compensation: `verify supplier-side state for clientReference ${input.clientReference} (ref ${supplierReference})`,
        },
      });
    }
    // The offer is consumed — it can never book a second reservation.
    await this.offers.invalidateOffer(tenant, offer.id);

    const settled = await this.loadScoped(tenant, booking.id, input.subTenantId);
    return this.toBookResult(settled.booking, settled.item, false, state);
  }

  /** Fee preview from the STORED policy — no supplier call, no state change. */
  async previewCancellation(
    tenant: TenantId,
    bookingId: string,
    scope: CallScope,
  ): Promise<CancellationPreview> {
    const { item } = await this.loadScoped(tenant, bookingId, scope.subTenantId);
    this.assertCancellable(item);
    return this.buildPreview(item, this.now());
  }

  async cancelBooking(
    tenant: TenantId,
    bookingId: string,
    scope: CallScope,
  ): Promise<CancelBookingResult> {
    const { booking, item } = await this.loadScoped(tenant, bookingId, scope.subTenantId);

    if (item.state === "cancelled") {
      // Idempotent: cancelling a cancelled booking reports the fact.
      return {
        bookingId: booking.id,
        bookingItemId: item.id,
        status: "cancelled",
        state: "cancelled",
        preview: this.buildPreview(item, item.cancellationRequestedAt ?? this.now()),
      };
    }
    this.assertCancellable(item);
    if (item.supplierReference === null) {
      throw new BookingError(
        "booking_not_cancellable",
        "the booking has no supplier reference to cancel",
      );
    }

    // MANDATORY fee preview BEFORE execution (issue #67): the penalty in
    // force now, from the stored normalized policy.
    const now = this.now();
    const preview = this.buildPreview(item, now);

    if (item.cancellationRequestedAt !== null) {
      // A cancel is already in flight supplier-side; the worker settles it.
      return {
        bookingId: booking.id,
        bookingItemId: item.id,
        status: "cancellation_pending",
        state: item.state,
        preview: this.buildPreview(item, item.cancellationRequestedAt),
      };
    }

    const adapter = this.hotelAdapterFor(item.supplierCode);
    const record = await adapter.cancel(
      await this.cancelContext(tenant, item, scope.locale),
      item.supplierReference,
    );

    if (record.status === "cancelled") {
      await this.runner.transition(tenant, item.id, "cancelled", {
        expectedFrom: item.state,
        actor: scope.actor,
        reason: "supplier cancelled the booking",
        patch: { cancellationRequestedAt: now },
        penalty: preview.penalty.amount === 0 ? null : preview.penalty,
        details: { supplierStatus: record.status },
      });
      return {
        bookingId: booking.id,
        bookingItemId: item.id,
        status: "cancelled",
        state: "cancelled",
        preview,
      };
    }

    // Async cancellation (e.g. TBO CancellationInProgress). For a confirmed
    // item, park it as a pending-cancel wait the worker polls; a
    // pending_confirmation item is ALREADY polled — the confirmation wait
    // settles to cancelled when the supplier reports it.
    if (item.state === "confirmed") {
      await this.runner.markCancellationRequested(tenant, item.id, scope.actor, now);
    }
    return {
      bookingId: booking.id,
      bookingItemId: item.id,
      status: "cancellation_pending",
      state: item.state,
      preview,
    };
  }

  async getBooking(
    tenant: TenantId,
    bookingId: string,
    scope: Pick<CallScope, "subTenantId">,
  ): Promise<{ booking: BookingRow; item: BookingItemRow }> {
    return this.loadScoped(tenant, bookingId, scope.subTenantId);
  }

  // -------------------------------------------------------------------------

  private toBookResult(
    booking: BookingRow,
    item: BookingItemRow,
    idempotentReplay: boolean,
    stateOverride?: BookingItemState,
  ): BookHotelResult {
    return {
      bookingId: booking.id,
      bookingItemId: item.id,
      clientReference: booking.clientReference,
      state: stateOverride ?? item.state,
      supplierReference: item.supplierReference,
      sell: { amount: Number(item.sellAmount), currency: item.currency },
      idempotentReplay,
    };
  }

  private requirePolicy(offer: VerifiedOffer): CancellationPolicy {
    if (offer.policySnapshot === null) {
      // Hotel adapters always normalize a policy; an offer without one is
      // not bookable — money would move against unknown cancellation terms.
      throw new BookingError(
        "booking_request_invalid",
        "the offer carries no cancellation policy snapshot",
      );
    }
    return offer.policySnapshot;
  }

  private assertGuestsMatchOccupancy(
    rooms: readonly HotelRoomGuests[],
    offer: VerifiedOffer,
  ): void {
    if (rooms.length !== offer.occupancy.length) {
      throw new BookingError(
        "booking_request_invalid",
        `guest list covers ${String(rooms.length)} rooms but the offer was priced for ${String(offer.occupancy.length)}`,
      );
    }
    for (const [index, room] of rooms.entries()) {
      const priced = offer.occupancy[index];
      if (priced === undefined) continue;
      const expected = priced.adults + priced.childAges.length;
      if (room.guests.length !== expected) {
        throw new BookingError(
          "booking_request_invalid",
          `room ${String(index + 1)} names ${String(room.guests.length)} guests but was priced for ${String(expected)}`,
        );
      }
    }
  }

  private hotelAdapterFor(supplierCode: string): HotelSupplierAdapter {
    const adapter = this.registry.hotelAdapter(supplierCode);
    if (adapter === null) {
      throw new SupplierUnavailableError(supplierCode);
    }
    return adapter;
  }

  private async callContext(
    tenant: TenantId,
    offer: VerifiedOffer,
    locale: Locale | undefined,
  ): Promise<AdapterCallContext> {
    return {
      credentials: await this.credentials.credentialsFor(tenant, offer.supplierCode),
      deadline: new Date(this.now().getTime() + this.supplierDeadlineMs),
      nationality: offer.nationality,
      currency: (offer.breakdown.fx?.supplierNet ?? offer.net).currency,
      locale: locale ?? "en",
    };
  }

  private async cancelContext(
    tenant: TenantId,
    item: BookingItemRow,
    locale: Locale | undefined,
  ): Promise<AdapterCallContext> {
    return {
      credentials: await this.credentials.credentialsFor(tenant, item.supplierCode),
      deadline: new Date(this.now().getTime() + this.supplierDeadlineMs),
      // Cancellation addresses an existing reservation; nationality/currency
      // context is informational for the adapters' cancel surface.
      nationality: "SA",
      currency: item.currency,
      locale: locale ?? "en",
    };
  }

  private async failAfterReserve(
    tenant: TenantId,
    bookingItemId: string,
    input: BookHotelInput,
    error: unknown,
  ): Promise<void> {
    const kind = isSupplierError(error) ? error.kind : "unexpected_failure";
    await this.runner.transition(tenant, bookingItemId, "failed", {
      expectedFrom: "reserved",
      actor: input.actor,
      reason: `supplier book failed after reserve: ${kind}`,
      details: {
        supplierErrorKind: kind,
        compensation:
          `verify with the supplier that NO reservation exists for clientReference ` +
          `${input.clientReference}; if one exists (possible on timeouts), cancel it there — ` +
          `the same clientReference re-sent would return it, never create a second one`,
      },
    });
  }

  private buildPreview(item: BookingItemRow, at: Date): CancellationPreview {
    const policy = item.policySnapshot;
    const penalty = resolvePenaltyAt(policy, at) ?? zero(item.currency);
    const sell: Money = { amount: Number(item.sellAmount), currency: item.currency };
    const refund = penalty.currency === sell.currency ? subtract(sell, penalty) : null;
    return { penalty, refund, refundable: policy.refundable, asOf: at };
  }

  private assertCancellable(item: BookingItemRow): void {
    if (item.state !== "confirmed" && item.state !== "pending_confirmation") {
      throw new BookingError(
        "booking_not_cancellable",
        `a booking in state ${item.state} cannot be cancelled`,
      );
    }
  }

  /** The original booking for a replayed clientReference, if one exists. */
  private async findByClientReference(
    tenant: TenantId,
    input: BookHotelInput,
  ): Promise<BookHotelResult | null> {
    const db = await this.resolver.getTenantDb(tenant);
    const found = await db
      .select()
      .from(bookings)
      .where(eq(bookings.clientReference, input.clientReference))
      .limit(1);
    const booking = found[0];
    if (booking === undefined) {
      return null;
    }
    if (booking.agencyId !== input.subTenantId) {
      // Someone else's idempotency key: refuse opaquely — a clientReference
      // must not become a probe into other agencies' bookings.
      throw new BookingError(
        "booking_request_invalid",
        "clientReference is already in use",
      );
    }
    const items = await db
      .select()
      .from(bookingItems)
      .where(eq(bookingItems.bookingId, booking.id))
      .limit(1);
    const item = items[0];
    if (item === undefined) {
      throw new BookingError("booking_not_found", "unknown booking");
    }
    return this.toBookResult(booking, item, true);
  }

  private async loadScoped(
    tenant: TenantId,
    bookingId: string,
    subTenantId: SubTenantId | null,
  ): Promise<{ booking: BookingRow; item: BookingItemRow }> {
    const db = await this.resolver.getTenantDb(tenant);
    const loaded = await loadBookingWithItems(db, bookingId);
    // Scope check folded into existence (opaque not_found — no oracle over
    // other agencies' booking ids).
    if (loaded === null || loaded.booking.agencyId !== subTenantId) {
      throw new BookingError("booking_not_found", "unknown booking");
    }
    const item = loaded.items[0];
    if (item === undefined || loaded.items.length !== 1) {
      // M1 books exactly one hotel item per booking; sagas arrive later.
      throw new BookingError("booking_not_found", "unknown booking");
    }
    return { booking: loaded.booking, item };
  }
}
