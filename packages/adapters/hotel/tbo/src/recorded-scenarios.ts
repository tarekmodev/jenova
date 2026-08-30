/**
 * The scenario inputs behind the committed recordings in
 * packages/sandbox-replay/recordings/tbo — shared by the contract/unit tests
 * (replay) and tools/record.ts (re-recording), so both always speak the same
 * request fingerprint.
 *
 * Provenance (CLAUDE.md rule 5 — nothing invented): hotel codes come from
 * the live TBOHotelCodeList recording for Riyadh (CityList "SA" →
 * city 147536), captured 2026-08-30. Dates are the recorded stay window.
 * Re-recording (weekly drift job, or after supplier changes) may need fresh
 * dates: update here, run `pnpm record search`, commit both.
 */

import { resolvePenaltyAt } from "@jenova/domain";
import type {
  HotelBookRequest,
  HotelOffer,
  HotelSearchQuery,
} from "@jenova/supplier-sdk";

/** Riyadh hotel codes drawn from the recorded TBOHotelCodeList response. */
export const RECORDED_RIYADH_HOTEL_CODES = [
  "1010062",
  "1032860",
  "1037420",
  "1065918",
  "1065929",
  "1065933",
  "1065937",
  "1065954",
  "1077182",
  "1087447",
] as const;

export const RECORDED_SEARCH_QUERY: HotelSearchQuery = {
  target: {
    kind: "properties",
    canonicalPropertyIds: RECORDED_RIYADH_HOTEL_CODES.map((code) => `tbo:${code}`),
  },
  checkIn: "2026-10-13",
  checkOut: "2026-10-14",
  rooms: [{ adults: 1, childAges: [] }],
};

/**
 * The client reference of the recorded certification booking. TBO receives
 * it as ClientReferenceId/BookingReferenceId; replay resolves the Book
 * recording by it. Bump the suffix when re-recording the lifecycle — one
 * clientReference, one booking (idempotency passthrough).
 */
export const RECORDED_CLIENT_REFERENCE = "JENOVA-M1-TBO-CERT-0001";

/**
 * Holder/guest inputs of the recorded certification booking (our own request
 * data, matching the recorded traffic — not supplier data). The mailbox is a
 * reserved-domain placeholder so sandbox vouchers go nowhere.
 */
export function makeRecordedBookRequest(checkedOffer: HotelOffer): HotelBookRequest {
  return {
    supplierOfferToken: checkedOffer.supplierOfferToken,
    holder: {
      firstName: "Jenova",
      lastName: "Certification",
      email: "jenova.certification@example.com",
      phone: "966555000000",
    },
    rooms: [{ guests: [{ firstName: "Jenova", lastName: "Certification" }] }],
    clientReference: RECORDED_CLIENT_REFERENCE,
  };
}

// ---------------------------------------------------------------------------
// Error scenarios (M1.a4 #57) — every recording is a REAL sandbox failure
// ---------------------------------------------------------------------------

/**
 * A BookingCode from the first live search session, PreBooked again after it
 * expired: TBO answers 201 "No Available rooms for given criteria"
 * (recorded) — expiry and sold-out are indistinguishable on PreBook.
 */
export const RECORDED_EXPIRED_BOOKING_CODE =
  "1065918!TB!1!TB!6acadf51-a48b-11f1-a512-aa71e0cecaa6!TB!N!TB!AFF!";

/** CheckOut before CheckIn → Status 400 "Invalid date entered…" (recorded). */
export const RECORDED_INVALID_DATES_QUERY: HotelSearchQuery = {
  target: { kind: "properties", canonicalPropertyIds: ["tbo:1065918"] },
  checkIn: "2026-10-14",
  checkOut: "2026-10-13",
  rooms: [{ adults: 1, childAges: [] }],
};

/**
 * The query recorded with a deliberately wrong password (scratch variable —
 * the real .env was never touched): HTTP 200 with Status 401 "Access
 * Credentials is incorrect". Credentials never enter the fingerprint, so
 * this scenario needs its own query shape to stay distinct.
 */
export const RECORDED_BAD_AUTH_QUERY: HotelSearchQuery = {
  target: { kind: "properties", canonicalPropertyIds: ["tbo:1032860"] },
  checkIn: "2026-10-13",
  checkOut: "2026-10-14",
  rooms: [{ adults: 1, childAges: [] }],
};

/** A hotel code TBO has no property for → 201, mapped to an empty search. */
export const RECORDED_UNKNOWN_HOTEL_QUERY: HotelSearchQuery = {
  target: { kind: "properties", canonicalPropertyIds: ["tbo:999999999"] },
  checkIn: "2026-10-13",
  checkOut: "2026-10-14",
  rooms: [{ adults: 1, childAges: [] }],
};

/** Cancel → 479 "No Itinerary exist for this input" (recorded). */
export const RECORDED_UNKNOWN_CONFIRMATION = "JENOVAX";

/**
 * The rate the lifecycle recording books: the cheapest refundable offer
 * whose penalty is currently zero (free cancellation window still open), so
 * the certification booking can be cancelled immediately at no charge.
 */
export function pickLifecycleOffer(
  offers: readonly HotelOffer[],
  at: Date = new Date(),
): HotelOffer {
  const cancellableNow = offers.filter((offer) => {
    if (!offer.cancellationPolicy.refundable) return false;
    const penalty = resolvePenaltyAt(offer.cancellationPolicy, at);
    return penalty === undefined || penalty.amount === 0;
  });
  const cheapest = [...cancellableNow].sort((a, b) => a.net.amount - b.net.amount)[0];
  if (cheapest === undefined) {
    throw new Error("no refundable zero-penalty offer available for the lifecycle recording");
  }
  return cheapest;
}
