/**
 * The portal's view of the api contracts (apps/api controllers). Types only —
 * every value here always originates from a server response; the portal never
 * computes prices, policy verdicts, or booking states client-side.
 */

import type { BookingItemState, CancellationPolicy } from "@jenova/domain";

export interface MoneyPayload {
  readonly amount: number;
  readonly currency: string;
}

export interface SessionContext {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
    readonly role: string;
  };
  readonly agency: {
    readonly id: string;
    readonly name: string;
    readonly defaultNationality: string | null;
    readonly allowedCurrencies: readonly string[];
  };
  readonly tenant: {
    readonly name: string;
    readonly branding: Readonly<Record<string, unknown>>;
  };
}

// --- hotel content -----------------------------------------------------------

export interface ContentCountry {
  readonly code: string;
  readonly name: string;
}

export interface ContentCity {
  readonly cityId: string;
  readonly name: string;
  readonly countryCode: string;
}

export interface ContentProperty {
  readonly canonicalPropertyId: string;
  readonly name: string;
  readonly cityId: string;
  readonly countryCode: string;
}

// --- hotel search (SSE) ------------------------------------------------------

export interface RoomOccupancyInput {
  readonly adults: number;
  readonly childAges: readonly number[];
}

export interface SearchRequestBody {
  readonly target: { readonly kind: "properties"; readonly canonicalPropertyIds: readonly string[] };
  readonly checkIn: string;
  readonly checkOut: string;
  readonly rooms: readonly RoomOccupancyInput[];
  readonly nationality: string;
  readonly currency: string;
  readonly locale: "ar" | "en";
}

export interface OfferSummary {
  readonly offerId: string;
  readonly offerToken: string;
  readonly expiresAt: string;
  readonly supplierCode: string;
  readonly canonicalPropertyId: string;
  readonly supplierRoomName: string;
  readonly boardBasis: "RO" | "BB" | "HB" | "FB" | "AI";
  readonly sell: MoneyPayload;
  readonly refundable: boolean;
  readonly cancellationPolicy: CancellationPolicy;
}

export interface SearchStartedFrame {
  readonly searchId: string;
  readonly supplierCodes: readonly string[];
}

export interface SupplierResultsFrame {
  readonly searchId: string;
  readonly supplierCode: string;
  readonly fromCache: boolean;
  readonly offers: readonly OfferSummary[];
}

export interface SupplierFailedFrame {
  readonly searchId: string;
  readonly supplierCode: string;
  readonly kind: string;
}

export interface SearchCompletedFrame {
  readonly searchId: string;
  readonly status: "complete" | "budget_exhausted";
  readonly offerCount: number;
}

// --- offers ------------------------------------------------------------------

export type CheckResponse =
  | {
      readonly status: "unchanged";
      readonly offerId: string;
      readonly offerToken: string;
      readonly sell: MoneyPayload;
      readonly expiresAt: string;
      readonly checkedAt: string;
      readonly cancellationPolicy: CancellationPolicy | null;
    }
  | {
      readonly status: "price_changed";
      readonly oldSell: MoneyPayload;
      readonly newSell: MoneyPayload;
      readonly newOfferId: string;
      readonly newOfferToken: string;
      readonly newExpiresAt: string;
      readonly policyChanged: boolean;
      readonly newCancellationPolicy: CancellationPolicy | null;
    };

// --- bookings ----------------------------------------------------------------

export interface BookResponse {
  readonly bookingId: string;
  readonly bookingItemId: string;
  readonly clientReference: string;
  readonly state: BookingItemState;
  readonly supplierReference: string | null;
  readonly sell: MoneyPayload;
  readonly idempotentReplay: boolean;
}

export interface BookingListRow {
  readonly bookingId: string;
  readonly clientReference: string;
  readonly createdAt: string;
  readonly state: BookingItemState;
  readonly supplierCode: string;
  readonly supplierReference: string | null;
  readonly sell: MoneyPayload;
  readonly escalated: boolean;
  readonly cancellationRequestedAt: string | null;
}

export interface BookingHistoryEntry {
  readonly action: string;
  readonly fromState: string | null;
  readonly toState: string | null;
  readonly occurredAt: string;
}

export interface BookingDetail {
  readonly bookingId: string;
  readonly clientReference: string;
  readonly channel: string;
  readonly paymentState: "unpaid" | "partially_paid" | "paid" | "refunded";
  readonly createdAt: string | null;
  readonly item: {
    readonly bookingItemId: string;
    readonly state: BookingItemState;
    readonly supplierCode: string;
    readonly supplierReference: string | null;
    readonly sell: MoneyPayload;
    readonly cancellationRequestedAt: string | null;
    readonly escalated: boolean;
    readonly policy: CancellationPolicy | null;
  };
  readonly history: readonly BookingHistoryEntry[];
}

export interface CancellationPreviewPayload {
  readonly penalty: MoneyPayload;
  readonly refund: MoneyPayload | null;
  readonly refundable: boolean;
  readonly asOf: string;
}

export interface CancelResponse {
  readonly bookingId: string;
  readonly bookingItemId: string;
  readonly status: "cancelled" | "cancellation_pending";
  readonly state: BookingItemState;
  readonly preview: CancellationPreviewPayload;
}

/** Standard api error envelope. */
export interface ErrorEnvelope {
  readonly error: { readonly code: string; readonly message: string; readonly requestId: string };
}

export function errorCodeOf(payload: unknown): string | null {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const inner = (payload as { error?: { code?: unknown } }).error;
    if (typeof inner?.code === "string") return inner.code;
  }
  return null;
}

/**
 * What the results page hands the offer page (sessionStorage): the offer
 * summary AS RECEIVED plus the search context needed to render the stay
 * summary and the book form. Prices/policies inside are server-issued
 * values; the signed offerToken remains the only thing the server trusts.
 */
export interface StoredOfferContext {
  readonly offer: OfferSummary;
  readonly hotelName: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly rooms: readonly RoomOccupancyInput[];
  readonly nationality: string;
  readonly currency: string;
}
