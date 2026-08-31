/**
 * TBO Holidays hotel adapter — implements the HotelSupplierAdapter lifecycle
 * over the TBO HotelAPI (docs/05-suppliers.md #1 on the roadmap).
 *
 * Lifecycle mapping: search → PreBook(check) → Book → BookingDetail(retrieve)
 * → Cancel. Normalization is this package's whole job: canonical Money,
 * UTC cancellation deadlines, board basis, and the unified error taxonomy —
 * no TBO shape crosses this boundary (CLAUDE.md rule 4).
 */

import {
  add,
  resolvePenaltyAt,
  SupplierError,
  zero,
  type CancellationPolicy,
  type Money,
} from "@jenova/domain";
import {
  parseJsonWith,
  type AdapterCallContext,
  type HotelBookRequest,
  type HotelBookingRecord,
  type HotelOffer,
  type HotelSearchQuery,
  type HotelSupplierAdapter,
  type SupplierBookingStatus,
  type Transport,
  type TransportResponse,
} from "@jenova/supplier-sdk";
import { TBO_SUPPLIER_CODE, TboClient } from "./client";
import {
  supplierErrorFromHttp,
  supplierErrorFromStatus,
  TBO_STATUS_NO_ROOMS,
  TBO_STATUS_OK,
} from "./errors";
import { createSkippedRoomRateLog } from "./diagnostics";
import {
  decodeOfferToken,
  mapCancellationPolicy,
  mapHotelRooms,
  mapRoomToOffer,
  tboAmountToMoney,
  toTboHotelCode,
  type SkippedRoomRateObserver,
} from "./mapping";
import {
  tboBookingDetailResponseSchema,
  tboBookResponseSchema,
  tboCancelResponseSchema,
  tboEnvelopeSchema,
  tboSearchResponseSchema,
  type TboStatus,
} from "./schemas";

export interface TboHotelAdapterOptions {
  /** The wired transport seam (createTboTransport: live, record or replay). */
  readonly transport: Transport;
  /**
   * Observation seam for supplier vocabulary drift (review M1): called once
   * per room rate a search skips because its MealType could not be
   * normalized. Defaults to a structured warn + counter
   * (createSkippedRoomRateLog); the registry injects its own so the
   * supplier health board can read the counts.
   */
  readonly onSkippedRoomRate?: SkippedRoomRateObserver;
}

/**
 * TBO caps its own search processing time via the ResponseTime request field
 * (seconds). Fixed at TBO's documented maximum — the caller's real budget is
 * ctx.deadline, which the transport enforces by aborting.
 */
const TBO_SEARCH_RESPONSE_TIME_SECONDS = 23.0;

function assertHttpOk(response: TransportResponse, operation: string): void {
  if (response.status < 200 || response.status >= 300) {
    throw supplierErrorFromHttp(response, operation);
  }
}

class TboHotelAdapter implements HotelSupplierAdapter {
  readonly supplierCode = TBO_SUPPLIER_CODE;
  readonly vertical = "hotel" as const;
  readonly client: TboClient;
  readonly #onSkippedRoomRate: SkippedRoomRateObserver;

  constructor(options: TboHotelAdapterOptions) {
    this.client = new TboClient(options.transport);
    this.#onSkippedRoomRate =
      options.onSkippedRoomRate ?? createSkippedRoomRateLog().observer;
  }

  /**
   * Credential probe for the Settings "test connection" button: GET
   * CountryList — TBO's cheapest authenticated static-content read, never
   * a search (look-to-book discipline). Wrong credentials surface as the
   * taxonomy's auth_failed (observed live: HTTP 401, and Status 401 inside
   * an HTTP 200 envelope — both mapped in errors.ts).
   */
  async testConnection(ctx: AdapterCallContext): Promise<void> {
    const response = await this.client.call(ctx, "countryList");
    assertHttpOk(response, "testConnection");
    const body = parseJsonWith(tboEnvelopeSchema, response.body, {
      supplierCode: TBO_SUPPLIER_CODE,
    });
    if (body.Status.Code !== TBO_STATUS_OK) {
      throw supplierErrorFromStatus(body.Status, "testConnection");
    }
  }

  async search(
    ctx: AdapterCallContext,
    query: HotelSearchQuery,
  ): Promise<readonly HotelOffer[]> {
    if (query.target.kind !== "properties") {
      // TBO searches by hotel codes; canonical-location fan-out arrives with
      // the M3 mapping service (docs/05-suppliers.md, "Hotel content mapping").
      throw new SupplierError(
        "invalid_request",
        "TBO search requires canonical property ids (location search lands with the M3 mapping service)",
      );
    }
    const payload = {
      CheckIn: query.checkIn,
      CheckOut: query.checkOut,
      HotelCodes: query.target.canonicalPropertyIds.map(toTboHotelCode).join(","),
      GuestNationality: ctx.nationality,
      PaxRooms: query.rooms.map((room) => ({
        Adults: room.adults,
        Children: room.childAges.length,
        ChildrenAges: [...room.childAges],
      })),
      ResponseTime: TBO_SEARCH_RESPONSE_TIME_SECONDS,
      IsDetailedResponse: true,
    };
    const response = await this.client.call(ctx, "search", payload);
    assertHttpOk(response, "search");
    const body = parseJsonWith(tboSearchResponseSchema, response.body, {
      supplierCode: TBO_SUPPLIER_CODE,
    });
    if (body.Status.Code === TBO_STATUS_NO_ROOMS) {
      // "No Available rooms for given criteria": an empty result for a broad
      // search — sold_out is reserved for a specific rate dying (check/book).
      return [];
    }
    if (body.Status.Code !== TBO_STATUS_OK) {
      throw supplierErrorFromStatus(body.Status, "search");
    }
    const offers: HotelOffer[] = [];
    for (const hotel of body.HotelResult ?? []) {
      // Unmappable rooms are skipped, never mislabeled — and every skip is
      // reported so supplier vocabulary drift stays visible (review M1).
      offers.push(...mapHotelRooms(hotel, ctx.nationality, this.#onSkippedRoomRate));
    }
    return offers;
  }

  /**
   * PreBook: revalidate the rate behind the offer token. Rejects with
   * price_changed when the revalidated TotalFare or cancellation policy
   * differs from what was priced at search; sold_out when the rate is gone.
   */
  async check(ctx: AdapterCallContext, supplierOfferToken: string): Promise<HotelOffer> {
    const token = decodeOfferToken(supplierOfferToken);
    const response = await this.client.call(ctx, "check", {
      BookingCode: token.bookingCode,
      PaymentMode: TBO_PAYMENT_MODE,
    });
    assertHttpOk(response, "check");
    const body = parseJsonWith(tboSearchResponseSchema, response.body, {
      supplierCode: TBO_SUPPLIER_CODE,
    });
    assertStatusOk(body.Status, "check");
    const hotel = body.HotelResult?.[0];
    const room = hotel?.Rooms[0];
    if (hotel === undefined || room === undefined) {
      throw new SupplierError(
        "sold_out",
        "TBO check: PreBook returned no rate for the offer",
        { supplierCode: String(body.Status.Code), raw: body.Status },
      );
    }
    const offer = mapRoomToOffer(room, hotel.HotelCode, hotel.Currency, ctx.nationality);
    if (offer === undefined) {
      throw new SupplierError(
        "invalid_request",
        `TBO check: unmappable meal type ${JSON.stringify(room.MealType)}`,
      );
    }
    const priced = tboAmountToMoney(token.totalFare, token.currency);
    if (!moneyEquals(offer.net, priced)) {
      throw new SupplierError(
        "price_changed",
        `TBO check: price moved from ${priced.amount} ${priced.currency} to ${offer.net.amount} ${offer.net.currency}`,
        { raw: { was: priced, now: offer.net } },
      );
    }
    if (!policyEquals(offer.cancellationPolicy, token.policy)) {
      throw new SupplierError(
        "price_changed",
        "TBO check: cancellation policy changed since the offer was priced",
        { raw: { was: token.policy, now: offer.cancellationPolicy } },
      );
    }
    return offer;
  }

  /**
   * Book: consumes a checked offer. clientReference is passed through as
   * TBO's ClientReferenceId (and BookingReferenceId) so supplier-side
   * idempotency holds — one clientReference, one booking. TBO echoes the
   * ClientReferenceId in the Book response (verified on the recorded live
   * booking).
   */
  async book(ctx: AdapterCallContext, request: HotelBookRequest): Promise<HotelBookingRecord> {
    const token = decodeOfferToken(request.supplierOfferToken);
    const response = await this.client.call(ctx, "book", {
      BookingCode: token.bookingCode,
      CustomerDetails: request.rooms.map((room) => ({
        CustomerNames: room.guests.map((guest) => ({
          // HotelGuest carries no honorific; TBO requires one. "Mr" is sent
          // until the domain grows a title field (documented in README.md).
          Title: "Mr",
          FirstName: guest.firstName,
          LastName: guest.lastName,
          Type: guest.age !== undefined && guest.age < 18 ? "Child" : "Adult",
        })),
      })),
      ClientReferenceId: request.clientReference,
      BookingReferenceId: request.clientReference,
      TotalFare: token.totalFare,
      EmailId: request.holder.email,
      PhoneNumber: request.holder.phone,
      BookingType: TBO_BOOKING_TYPE,
      PaymentMode: TBO_PAYMENT_MODE,
    });
    assertHttpOk(response, "book");
    const body = parseJsonWith(tboBookResponseSchema, response.body, {
      supplierCode: TBO_SUPPLIER_CODE,
    });
    assertStatusOk(body.Status, "book");
    if (body.ConfirmationNumber === undefined || body.ConfirmationNumber === "") {
      throw new SupplierError(
        "supplier_rejected",
        "TBO book: success status without a ConfirmationNumber",
        { supplierCode: String(body.Status.Code), raw: body.Status },
      );
    }
    return {
      supplierBookingReference: body.ConfirmationNumber,
      clientReference: body.ClientReferenceId ?? request.clientReference,
      // TBO's voucher flow confirms synchronously on Status 200; the
      // retrieved BookingStatus is the ground truth (mapBookingStatus).
      status: "confirmed",
      net: tboAmountToMoney(token.totalFare, token.currency),
      cancellationPolicy: token.policy,
    };
  }

  /** BookingDetail by ConfirmationNumber. */
  async retrieve(
    ctx: AdapterCallContext,
    supplierBookingReference: string,
  ): Promise<HotelBookingRecord> {
    const response = await this.client.call(ctx, "retrieve", {
      ConfirmationNumber: supplierBookingReference,
      PaymentMode: TBO_PAYMENT_MODE,
    });
    assertHttpOk(response, "retrieve");
    const body = parseJsonWith(tboBookingDetailResponseSchema, response.body, {
      supplierCode: TBO_SUPPLIER_CODE,
    });
    assertStatusOk(body.Status, "retrieve");
    const detail = body.BookingDetail;
    const rooms = detail?.Rooms ?? [];
    const first = rooms[0];
    if (detail === undefined || first === undefined) {
      throw new SupplierError(
        "supplier_rejected",
        "TBO retrieve: success status without booked rooms",
        { supplierCode: String(body.Status.Code), raw: body.Status },
      );
    }
    // Fare and cancellation policies are PER ROOM on BookingDetail (recorded
    // live); the canonical record aggregates them: net = sum of room fares,
    // policy = per-instant sum of each room's penalty in force.
    for (const room of rooms) {
      if (room.Currency !== first.Currency) {
        throw new SupplierError(
          "invalid_request",
          `TBO retrieve: mixed room currencies ${first.Currency}/${room.Currency}`,
        );
      }
    }
    const net = rooms
      .map((room) => tboAmountToMoney(room.TotalFare, room.Currency))
      .reduce(addMoney);
    const roomPolicies = rooms.map((room) =>
      mapCancellationPolicy(
        room.CancelPolicies,
        tboAmountToMoney(room.TotalFare, room.Currency),
        room.IsRefundable ?? false,
      ),
    );
    return {
      supplierBookingReference: detail.ConfirmationNumber ?? supplierBookingReference,
      // TBO's BookingDetail does not echo ClientReferenceId (only the Book
      // response does — verified live); the engine keeps its own copy.
      clientReference: "",
      status: mapBookingStatus(detail.BookingStatus),
      net,
      cancellationPolicy: mergeCancellationPolicies(roomPolicies),
    };
  }

  /**
   * Cancel by ConfirmationNumber, then re-read BookingDetail so the record
   * reflects the supplier's stored state (status, and the penalty the
   * policy's rules resolve at cancellation time).
   */
  async cancel(
    ctx: AdapterCallContext,
    supplierBookingReference: string,
  ): Promise<HotelBookingRecord> {
    const response = await this.client.call(ctx, "cancel", {
      ConfirmationNumber: supplierBookingReference,
    });
    assertHttpOk(response, "cancel");
    const body = parseJsonWith(tboCancelResponseSchema, response.body, {
      supplierCode: TBO_SUPPLIER_CODE,
    });
    assertStatusOk(body.Status, "cancel");
    return this.retrieve(ctx, supplierBookingReference);
  }
}

const TBO_PAYMENT_MODE = "Limit";
const TBO_BOOKING_TYPE = "Voucher";

function assertStatusOk(status: TboStatus, operation: string): void {
  if (status.Code !== TBO_STATUS_OK) {
    throw supplierErrorFromStatus(status, operation);
  }
}

function moneyEquals(a: Money, b: Money): boolean {
  return a.amount === b.amount && a.currency === b.currency;
}

function addMoney(a: Money, b: Money): Money {
  return add(a, b);
}

/**
 * Aggregate per-room policies into one booking-level policy: at every
 * deadline any room introduces, the penalty is the sum of each room's
 * penalty then in force. Refundable only when every room is.
 */
function mergeCancellationPolicies(
  policies: readonly CancellationPolicy[],
): CancellationPolicy {
  const single = policies[0];
  if (policies.length === 1 && single !== undefined) {
    return single;
  }
  const currency =
    policies.flatMap((policy) => policy.rules.map((rule) => rule.penalty.currency))[0] ?? "USD";
  const instants = [
    ...new Set(policies.flatMap((policy) => policy.rules.map((rule) => rule.fromUtc))),
  ].sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    refundable: policies.every((policy) => policy.refundable),
    rules: instants.map((fromUtc) => ({
      fromUtc,
      penalty: policies
        .map((policy) => resolvePenaltyAt(policy, new Date(fromUtc)) ?? zero(currency))
        .reduce(addMoney, zero(currency)),
    })),
  };
}

function policyEquals(a: CancellationPolicy, b: CancellationPolicy): boolean {
  return (
    a.refundable === b.refundable &&
    a.rules.length === b.rules.length &&
    a.rules.every((rule, i) => {
      const other = b.rules[i];
      return (
        other !== undefined &&
        rule.fromUtc === other.fromUtc &&
        moneyEquals(rule.penalty, other.penalty)
      );
    })
  );
}

/**
 * TBO BookingStatus → supplier-side status. Values observed live are listed
 * first; TBO's documented pending/async vocabulary maps to "pending" so the
 * engine's pending_confirmation polling owns them. Unknown vocabulary fails
 * loudly (drift detection) rather than guessing a state.
 */
function mapBookingStatus(value: string | undefined): SupplierBookingStatus {
  const status = (value ?? "").trim().toLowerCase();
  switch (status) {
    case "confirmed":
    case "vouchered":
      return "confirmed";
    case "cancelled":
    case "canceled":
      return "cancelled";
    // CancellationInProgress observed live: Cancel is asynchronous —
    // BookingDetail reports it until the cancellation settles to Cancelled.
    case "pending":
    case "inprogress":
    case "in progress":
    case "onrequest":
    case "on request":
    case "unconfirmed":
    case "cancellationinprogress":
      return "pending";
    default:
      throw new SupplierError(
        "invalid_request",
        `TBO retrieve: unknown BookingStatus ${JSON.stringify(value)}`,
      );
  }
}

export function createTboHotelAdapter(options: TboHotelAdapterOptions): HotelSupplierAdapter {
  return new TboHotelAdapter(options);
}
