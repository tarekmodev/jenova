/**
 * Voucher data loader (issue #99): assembles VoucherData from the booked
 * rows — booking + item (guests snapshot, policy, sell, supplier ref), the
 * consumed offer row (property, stay, board basis, room name), and the
 * control-plane Tenant row (legal name + branding). Reads tenant data ONLY
 * through the @jenova/db resolver (CLAUDE.md rule 1).
 */

import { eq } from "drizzle-orm";
import type { Money, TenantId } from "@jenova/domain";
import {
  offers,
  tenants,
  type ControlPlaneClient,
  type TenantDbResolver,
} from "@jenova/db";
import { loadBookingWithItems, moneyAmountFrom } from "@jenova/booking-engine";
import { addDaysUtc } from "./format";
import type { VoucherBrand, VoucherData } from "./voucher-content";

export type VoucherDataErrorKind =
  | "booking_not_found"
  | "voucher_not_available"
  | "voucher_data_incomplete";

/** Typed refusal: what the voucher pipeline cannot render, and why. */
export class VoucherDataError extends Error {
  constructor(
    readonly kind: VoucherDataErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "VoucherDataError";
  }
}

/**
 * Canonical-property display names. Supplier search payloads carry no
 * property names (only canonical ids) — the M3 mapping service becomes the
 * real implementation; until then the null source renders the canonical id.
 */
export interface PropertyNameSource {
  propertyName(tenant: TenantId, canonicalPropertyId: string): Promise<string | null>;
}

export class NullPropertyNameSource implements PropertyNameSource {
  propertyName(): Promise<string | null> {
    return Promise.resolve(null);
  }
}

/** Fixed directory (tests/tools feed it names from recorded supplier content). */
export class StaticPropertyNameSource implements PropertyNameSource {
  constructor(private readonly names: Readonly<Record<string, string>>) {}

  propertyName(_tenant: TenantId, canonicalPropertyId: string): Promise<string | null> {
    return Promise.resolve(this.names[canonicalPropertyId] ?? null);
  }
}

/** Booking-item states a voucher may be issued for. */
const VOUCHERABLE_STATES = new Set(["confirmed", "issued", "completed"]);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface StayFacts {
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nights: number;
}

/** checkIn/nights ride the offer's pricing context; checkOut is derived. */
function stayFromPricingContext(context: Record<string, unknown> | null): StayFacts | null {
  if (context === null) return null;
  const travelDate = context["travelDate"];
  const nights = context["nights"];
  if (typeof travelDate !== "string" || !ISO_DATE_RE.test(travelDate)) return null;
  if (typeof nights !== "number" || !Number.isSafeInteger(nights) || nights < 1) return null;
  return { checkIn: travelDate, checkOut: addDaysUtc(travelDate, nights), nights };
}

function brandFrom(row: { name: string; branding: Record<string, unknown> }): VoucherBrand {
  const legalName = row.branding["legalName"];
  const brandColor = row.branding["brandColor"];
  const logoPngBase64 = row.branding["logoPngBase64"];
  let logoPng: Uint8Array | null = null;
  if (typeof logoPngBase64 === "string" && logoPngBase64.length > 0) {
    try {
      logoPng = Uint8Array.from(Buffer.from(logoPngBase64, "base64"));
    } catch {
      logoPng = null; // unreadable branding never blocks a voucher
    }
  }
  return {
    legalName: typeof legalName === "string" && legalName.length > 0 ? legalName : row.name,
    brandColor: typeof brandColor === "string" ? brandColor : null,
    logoPng,
  };
}

export interface VoucherDataLoaderDeps {
  readonly resolver: TenantDbResolver;
  readonly controlPlane: ControlPlaneClient;
  readonly propertyNames: PropertyNameSource;
}

export async function loadVoucherData(
  deps: VoucherDataLoaderDeps,
  tenant: TenantId,
  bookingId: string,
): Promise<VoucherData> {
  const db = await deps.resolver.getTenantDb(tenant);
  const loaded = await loadBookingWithItems(db, bookingId);
  if (loaded === null) {
    throw new VoucherDataError("booking_not_found", "unknown booking");
  }
  const item = loaded.items[0];
  if (item === undefined || loaded.items.length !== 1) {
    // M2 books exactly one hotel item per booking; multi-item vouchers
    // arrive with the saga coordinator.
    throw new VoucherDataError("booking_not_found", "unknown booking");
  }
  if (!VOUCHERABLE_STATES.has(item.state) || item.supplierReference === null) {
    throw new VoucherDataError(
      "voucher_not_available",
      `no voucher exists for a booking in state ${item.state}`,
    );
  }
  if (item.guests === null) {
    throw new VoucherDataError(
      "voucher_data_incomplete",
      "the booking item carries no guests snapshot (booked before documents v1)",
    );
  }
  if (item.offerId === null) {
    throw new VoucherDataError(
      "voucher_data_incomplete",
      "the booking item references no offer row",
    );
  }
  const [offer] = await db.select().from(offers).where(eq(offers.id, item.offerId)).limit(1);
  if (offer === undefined || offer.canonicalPropertyId === null) {
    throw new VoucherDataError(
      "voucher_data_incomplete",
      "the consumed offer row is missing or carries no canonical property id",
    );
  }
  const stay = stayFromPricingContext(offer.pricingContext);
  if (stay === null) {
    throw new VoucherDataError(
      "voucher_data_incomplete",
      "the consumed offer carries no stay dates in its pricing context",
    );
  }
  const [tenantRow] = await deps.controlPlane.db
    .select({ name: tenants.name, branding: tenants.branding })
    .from(tenants)
    .where(eq(tenants.id, tenant))
    .limit(1);
  if (tenantRow === undefined) {
    throw new VoucherDataError("voucher_data_incomplete", "unknown tenant");
  }

  const sell: Money = {
    amount: moneyAmountFrom(item.sellAmount, "sell_amount"),
    currency: item.currency,
  };
  return {
    bookingId: loaded.booking.id,
    bookingItemId: item.id,
    clientReference: loaded.booking.clientReference,
    supplierReference: item.supplierReference,
    property: {
      canonicalId: offer.canonicalPropertyId,
      name: await deps.propertyNames.propertyName(tenant, offer.canonicalPropertyId),
    },
    stay,
    boardBasis: offer.boardBasis,
    roomName: offer.supplierRoomName,
    nationality: offer.nationality,
    guests: item.guests,
    sell,
    policy: item.policySnapshot,
    brand: brandFrom(tenantRow),
  };
}
