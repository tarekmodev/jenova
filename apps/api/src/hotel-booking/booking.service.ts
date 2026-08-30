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
  moneyAmountFrom,
  TransitionConflictError,
  type AuditActor,
  type BookingItemRow,
  type BookingRow,
} from "@jenova/booking-engine";
import { bookingItems, bookings, type TenantDbResolver } from "@jenova/db";
import { eq } from "drizzle-orm";
import type { SupplierCredentialsSource, SupplierRegistry } from "@jenova/supplier-registry";
import { OfferError, SupplierUnavailableError } from "../offers/errors";
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

    // Claim the offer atomically BEFORE anything irreversible: one offer,
    // one supplier book attempt, ever. Two racing book calls (different
    // clientReferences, same offer) both pass the gate above — the
    // rowcount-gated claim admits exactly one to the supplier; the loser is
    // refused here with no booking row and no supplier call (review M1).
    const claimed = await this.offers.claimOfferForBooking(tenant, offer.id);
    if (!claimed) {
      throw new OfferError(
        "offer_invalidated",
        "this offer was already consumed by another booking attempt — check again or search again",
      );
    }

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
      // Idempotent replay via the unique constraint (the race twin of the
      // findByClientReference fast path). Same scope rule (review M1): a
      // clientReference owned by ANOTHER agency must not leak its booking.
      if (created.booking.agencyId !== input.subTenantId) {
        throw new BookingError("booking_request_invalid", "clientReference is already in use");
      }
      // Return the ORIGINAL state — never re-drive the supplier from a
      // replayed call.
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
      if (record.clientReference !== "" && record.clientReference !== input.clientReference) {
        // Adapter contract violation — an invariant failure. Raised INSIDE
        // the try (review M1): the supplier may hold a live reservation, so
        // the item must land in `failed` with the compensation note, never
        // linger in `reserved`.
        throw new Error(
          `adapter ${offer.supplierCode} echoed clientReference ${record.clientReference} for ${input.clientReference}`,
        );
      }
    } catch (error) {
      // The offer stays claimed: one book attempt per offer, whatever the
      // failure (sold_out/price_changed are dead anyway; on a timeout the
      // supplier MAY hold a reservation — see the compensation note).
      await this.failAfterReserve(tenant, item.id, input, error);
      throw error;
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

    // The supplier's answer is authoritative, but OUR row may have moved
    // while the call was in flight (the worker can confirm a
    // pending_confirmation item concurrently) — settle against the FRESH
    // state, never the pre-call snapshot (review M1).
    if (record.status === "cancelled") {
      const state = await this.settleSupplierCancelled(tenant, item.id, scope.actor, now, preview);
      return {
        bookingId: booking.id,
        bookingItemId: item.id,
        status: "cancelled",
        state,
        preview,
      };
    }

    // Async cancellation (e.g. TBO CancellationInProgress). The durable
    // cancel-intent marker is recorded on confirmed AND pending_confirmation
    // items alike (review M1): if the worker later confirms a pending item,
    // the requested cancellation survives as a pending-cancel wait instead
    // of being silently dropped.
    const fresh = (await this.loadScoped(tenant, bookingId, scope.subTenantId)).item;
    if (fresh.state === "cancelled") {
      return {
        bookingId: booking.id,
        bookingItemId: item.id,
        status: "cancelled",
        state: "cancelled",
        preview,
      };
    }
    if (
      (fresh.state === "confirmed" || fresh.state === "pending_confirmation") &&
      fresh.cancellationRequestedAt === null
    ) {
      try {
        await this.runner.markCancellationRequested(tenant, item.id, scope.actor, now);
      } catch (error) {
        if (!(error instanceof TransitionConflictError)) {
          throw error;
        }
        // A concurrent cancel/worker action claimed the wait (or settled
        // it) first — the wait exists either way; fall through.
      }
    }
    return {
      bookingId: booking.id,
      bookingItemId: item.id,
      status: "cancellation_pending",
      state: fresh.state,
      preview,
    };
  }

  /**
   * The supplier reports the booking cancelled — converge our state onto
   * that fact even while the worker races us: retry the transition against
   * the fresh state; if the item keeps moving underneath (or sits in a
   * state that cannot legally reach cancelled), ESCALATE so the divergence
   * lands in the manual-intervention queue instead of standing silently
   * with revenue posted for a supplier-cancelled booking (review M1).
   */
  private async settleSupplierCancelled(
    tenant: TenantId,
    bookingItemId: string,
    actor: AuditActor,
    requestedAt: Date,
    preview: CancellationPreview,
  ): Promise<BookingItemState> {
    const db = await this.resolver.getTenantDb(tenant);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [fresh] = await db
        .select()
        .from(bookingItems)
        .where(eq(bookingItems.id, bookingItemId));
      if (fresh === undefined) break;
      if (fresh.state === "cancelled") {
        return "cancelled";
      }
      if (fresh.state !== "confirmed" && fresh.state !== "pending_confirmation") {
        break; // cannot legally reach cancelled from here — escalate below
      }
      try {
        await this.runner.transition(tenant, bookingItemId, "cancelled", {
          expectedFrom: fresh.state,
          actor,
          reason: "supplier cancelled the booking",
          patch: { cancellationRequestedAt: requestedAt },
          penalty: preview.penalty.amount === 0 ? null : preview.penalty,
        });
        return "cancelled";
      } catch (error) {
        if (!(error instanceof TransitionConflictError)) {
          throw error;
        }
      }
    }
    await this.runner.escalate(
      tenant,
      bookingItemId,
      actor,
      "supplier reports this booking cancelled but the local item could not be settled — reconcile manually",
    );
    throw new BookingError(
      "booking_not_cancellable",
      "the supplier cancelled this booking but local settlement conflicted — it has been escalated for manual reconciliation",
    );
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
      sell: { amount: moneyAmountFrom(item.sellAmount, "sell_amount"), currency: item.currency },
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
    const sell: Money = { amount: moneyAmountFrom(item.sellAmount, "sell_amount"), currency: item.currency };
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
