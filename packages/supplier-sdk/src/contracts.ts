/**
 * Supplier adapter contracts (docs/05-suppliers.md, docs/03-domain-model.md).
 *
 * One interface per vertical, one lifecycle for every supplier:
 * search → check → book → retrieve → cancel. Normalization is the adapter's
 * whole job: every signature here speaks @jenova/domain canonical types
 * only — no supplier shape crosses this boundary (CLAUDE.md rule 4).
 */

import type { CancellationPolicy, Locale, Money, TenantId } from "@jenova/domain";

export const SUPPLIER_ENVIRONMENTS = ["sandbox", "production"] as const;
export type SupplierEnvironment = (typeof SUPPLIER_ENVIRONMENTS)[number];

export function isSupplierEnvironment(value: string): value is SupplierEnvironment {
  return (SUPPLIER_ENVIRONMENTS as readonly string[]).includes(value);
}

/**
 * A tenant's own credentials for one supplier + environment (the tenant DB's
 * SupplierAccount, decrypted at call time). Jenova is a technology partner:
 * every call runs on the tenant's account and credit, never on Jenova's.
 */
export interface SupplierAccountCredentials {
  readonly tenantId: TenantId;
  /** Platform-level supplier code (SupplierCatalogEntry / registry key). */
  readonly supplierCode: string;
  readonly environment: SupplierEnvironment;
  /**
   * Decrypted secret material keyed by supplier-specific names (api key,
   * client id, …). Never logged; the sandbox-replay recorder sanitizes
   * these out of any capture before it can be committed.
   */
  readonly secrets: Readonly<Record<string, string>>;
}

/**
 * Everything an adapter call needs beyond its payload, built by the engine
 * per call. Adapters must honor `deadline` (the shared transport aborts at
 * it) and apply `nationality`/`currency` wherever the supplier supports
 * them — nationality is a first-class search parameter in the GCC
 * (CLAUDE.md rule 9).
 */
export interface AdapterCallContext {
  readonly credentials: SupplierAccountCredentials;
  /** Absolute UTC instant after which the call must no longer be running. */
  readonly deadline: Date;
  /** Guest nationality, ISO 3166-1 alpha-2 (e.g. "SA"). */
  readonly nationality: string;
  /** Requested pricing currency, ISO 4217; returned Money says what was actually priced. */
  readonly currency: string;
  readonly locale: Locale;
}

// ---------------------------------------------------------------------------
// Hotel payloads
// ---------------------------------------------------------------------------

export interface RoomOccupancy {
  readonly adults: number;
  /** One age per child, in years at check-in. Empty when none. */
  readonly childAges: readonly number[];
}

/**
 * Search either specific canonical properties or a canonical location.
 * Ids are canonical (mapping service) — adapters translate them to their
 * supplier's codes, never the other way around.
 */
export type HotelSearchTarget =
  | { readonly kind: "properties"; readonly canonicalPropertyIds: readonly string[] }
  | { readonly kind: "location"; readonly canonicalLocationId: string };

export interface HotelSearchQuery {
  readonly target: HotelSearchTarget;
  /** ISO 8601 calendar date (YYYY-MM-DD), hotel-local. */
  readonly checkIn: string;
  /** ISO 8601 calendar date (YYYY-MM-DD), hotel-local. */
  readonly checkOut: string;
  readonly rooms: readonly RoomOccupancy[];
}

/** Canonical board basis: room only, bed & breakfast, half/full board, all-inclusive. */
export const BOARD_BASES = ["RO", "BB", "HB", "FB", "AI"] as const;
export type BoardBasis = (typeof BOARD_BASES)[number];

export function isBoardBasis(value: string): value is BoardBasis {
  return (BOARD_BASES as readonly string[]).includes(value);
}

export interface HotelOffer {
  /**
   * Opaque supplier-side token that `check` revalidates and a book request
   * consumes. Adapters encode whatever their supplier needs to rebuild the
   * rate; the engine treats it as opaque and wraps it in its own signed,
   * short-lived Offer (CLAUDE.md rule 8).
   */
  readonly supplierOfferToken: string;
  /** Canonical property id (mapping service); anchors dedup across suppliers. */
  readonly canonicalPropertyId: string;
  /** The supplier's own room name, shown verbatim (room mapping is best-effort). */
  readonly supplierRoomName: string;
  readonly boardBasis: BoardBasis;
  /** Supplier net for the whole stay, all rooms. */
  readonly net: Money;
  /** Deadlines already resolved to UTC, penalties already Money (docs/03). */
  readonly cancellationPolicy: CancellationPolicy;
  /** Nationality the supplier actually priced for — must echo the context's. */
  readonly nationalityApplied: string;
}

export interface HotelGuest {
  readonly firstName: string;
  readonly lastName: string;
  /** Age in years at check-in; required for children, omitted for adults. */
  readonly age?: number;
}

export interface HotelBookingHolder {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
}

export interface HotelRoomGuests {
  readonly guests: readonly HotelGuest[];
}

export interface HotelBookRequest {
  /** The checked offer being booked. */
  readonly supplierOfferToken: string;
  readonly holder: HotelBookingHolder;
  /** Guests per room, in the same order as the searched occupancy. */
  readonly rooms: readonly HotelRoomGuests[];
  /**
   * Idempotency key. The adapter MUST pass this through to the supplier so
   * retries never double-book (docs/05): one clientReference, one booking.
   */
  readonly clientReference: string;
}

/**
 * Supplier-side booking status. `pending` covers async confirmation flows;
 * the engine's BookingItemState machine (@jenova/domain) — not the adapter —
 * decides what each status means for the booking item.
 */
export const SUPPLIER_BOOKING_STATUSES = ["confirmed", "pending", "cancelled"] as const;
export type SupplierBookingStatus = (typeof SUPPLIER_BOOKING_STATUSES)[number];

export interface HotelBookingRecord {
  readonly supplierBookingReference: string;
  /**
   * Echoes HotelBookRequest.clientReference. May be "" on records built
   * from a supplier retrieval surface that does not return it (e.g. TBO's
   * BookingDetail) — the engine persists its own copy and never relies on
   * the supplier echo outside book().
   */
  readonly clientReference: string;
  readonly status: SupplierBookingStatus;
  readonly net: Money;
  readonly cancellationPolicy: CancellationPolicy;
}

// ---------------------------------------------------------------------------
// Adapter interfaces — one per vertical, one lifecycle for all suppliers
// ---------------------------------------------------------------------------

export interface HotelSupplierAdapter {
  readonly supplierCode: string;
  readonly vertical: "hotel";
  search(ctx: AdapterCallContext, query: HotelSearchQuery): Promise<readonly HotelOffer[]>;
  /**
   * Revalidate price/availability just before booking. Rejects with
   * SupplierError `price_changed` / `sold_out` when the rate moved or died.
   */
  check(ctx: AdapterCallContext, supplierOfferToken: string): Promise<HotelOffer>;
  book(ctx: AdapterCallContext, request: HotelBookRequest): Promise<HotelBookingRecord>;
  retrieve(
    ctx: AdapterCallContext,
    supplierBookingReference: string,
  ): Promise<HotelBookingRecord>;
  cancel(ctx: AdapterCallContext, supplierBookingReference: string): Promise<HotelBookingRecord>;
}

/**
 * Flight adapters (consolidator air — docs/05 roadmap) land in M10–M12; the
 * lifecycle there adds fareRules/ticket/void/refund. Payload types are
 * intentionally absent at M0 and are specified with the first air adapter.
 */
export interface FlightSupplierAdapter {
  readonly supplierCode: string;
  readonly vertical: "air";
}

/**
 * Ground adapters (transfers + activities — docs/05 roadmap) land in M8–M9.
 * Payload types are intentionally absent at M0 and are specified with the
 * first ground adapter.
 */
export interface GroundSupplierAdapter {
  readonly supplierCode: string;
  readonly vertical: "ground";
}

export type SupplierAdapter =
  | HotelSupplierAdapter
  | FlightSupplierAdapter
  | GroundSupplierAdapter;
