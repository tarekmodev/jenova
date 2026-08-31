/**
 * DocumentsService voucher tests (issue #99) on REAL per-tenant Postgres
 * driving the REAL TBO adapter in replay mode over the committed recordings
 * of the live certification lifecycle (booking LVFXI5, booked on the real
 * sandbox on 2026-08-30) — the voucher renders from a REAL booked flow, zero
 * fabricated supplier data (CLAUDE.md rule 5).
 *
 * The holder/guest/clientReference literals MUST byte-match the recorded
 * Book request, and the property name literal byte-matches the recorded
 * TBOHotelCodeList response for hotel 1065918 (packages/sandbox-replay/
 * recordings/tbo) — replay fails loudly on drift.
 *
 * Requires: local Postgres (pgAvailable) AND a Typst binary
 * (DOCUMENTS_TYPST_BIN or `typst` on PATH) — skipped otherwise.
 */

import { createHash } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolvePenaltyAt, tenantId as brandTenantId, type TenantId } from "@jenova/domain";
import {
  createTenantDatabase,
  createTenantDbResolver,
  documents as documentRows,
  tenants,
  type ControlPlaneClient,
  type TenantDbResolver,
} from "@jenova/db";
import { createTestPlatform, pgAvailable, type TestPlatform } from "@jenova/db/testing";
import { BookingTransitionRunner } from "@jenova/booking-engine";
import {
  createSupplierRegistry,
  type SupplierCredentialsSource,
  type SupplierRegistry,
} from "@jenova/supplier-registry";
import type { AdapterCallContext } from "@jenova/supplier-sdk";
import {
  DocumentsService,
  InMemoryDocumentStore,
  StaticPropertyNameSource,
  TypstRenderer,
  typstAvailable,
  VoucherDataError,
  type TypstRenderRequest,
} from "@jenova/documents";
import { assemblePricedOffer } from "../pricing/offer";
import { resolvePrice } from "../pricing/resolve";
import type { PricingContext } from "../pricing/rules";
import { DrizzleOfferStore } from "../offers/offer-store";
import { FixedOfferTtlSource, OffersService } from "../offers/offers.service";
import { HotelBookingService } from "../hotel-booking/booking.service";

const SIGNING_KEY = "integration-test-signing-key-0123456789";

// --- Recorded lifecycle request data (recorded-scenarios.ts, duplicated) ---
const RECORDED_SEARCH_QUERY = {
  target: {
    kind: "properties" as const,
    canonicalPropertyIds: [
      "tbo:1010062",
      "tbo:1032860",
      "tbo:1037420",
      "tbo:1065918",
      "tbo:1065929",
      "tbo:1065933",
      "tbo:1065937",
      "tbo:1065954",
      "tbo:1077182",
      "tbo:1087447",
    ],
  },
  checkIn: "2026-10-13",
  checkOut: "2026-10-14",
  rooms: [{ adults: 1, childAges: [] as number[] }],
};
const RECORDED_SEARCH_INSTANT = "2026-08-30T16:00:00Z";
const RECORDED_CLIENT_REFERENCE = "JENOVA-M1-TBO-CERT-0001";
const RECORDED_CONFIRMATION_NUMBER = "LVFXI5";
const RECORDED_HOLDER = {
  firstName: "Jenova",
  lastName: "Certification",
  email: "jenova.certification@example.com",
  phone: "966555000000",
};
const RECORDED_ROOMS = [{ guests: [{ firstName: "Jenova", lastName: "Certification" }] }];
/** Byte-matches the recorded TBOHotelCodeList entry for HotelCode 1065918. */
const RECORDED_PROPERTY_NAMES = { "tbo:1065918": "Comfort Inn Taawn" };
// ---------------------------------------------------------------------------

const CONTEXT: PricingContext = {
  subTenantId: null,
  channel: "b2b",
  vertical: "hotel",
  supplierCode: "tbo",
  destination: null,
  travelDate: RECORDED_SEARCH_QUERY.checkIn,
  nights: 1,
  paxCount: 1,
};

const ACTOR = { actorType: "agency_user" as const, actorId: "agent-structural-1" };

class ReplayCredentialsSource implements SupplierCredentialsSource {
  credentialsFor(tenant: TenantId, supplierCode: string) {
    return Promise.resolve({
      tenantId: tenant,
      supplierCode,
      environment: "sandbox" as const,
      secrets: {
        apiUrl: "https://api.tbotechnology.in/TBOHolidays_HotelAPI",
        username: "replay",
        password: "replay",
      },
    });
  }
}

/** Counts renders so served-from-store reads are observable. */
class CountingTypstRenderer extends TypstRenderer {
  renders = 0;

  override render(request: TypstRenderRequest): Promise<Uint8Array> {
    this.renders += 1;
    return super.render(request);
  }
}

const TYPST_BIN = process.env["DOCUMENTS_TYPST_BIN"] ?? "typst";
const available = (await pgAvailable()) && (await typstAvailable(TYPST_BIN));

describe.skipIf(!available)("DocumentsService — voucher over the recorded TBO booking", () => {
  let platform: TestPlatform;
  let resolver: TenantDbResolver;
  let controlPlane: ControlPlaneClient;
  let tenant: TenantId;
  let registry: SupplierRegistry;
  let service: HotelBookingService;
  let documents: DocumentsService;
  let store: InMemoryDocumentStore;
  let renderer: CountingTypstRenderer;
  let bookingId = "";
  const credentials = new ReplayCredentialsSource();

  beforeAll(async () => {
    platform = await createTestPlatform();
    controlPlane = platform.controlPlane;
    resolver = createTenantDbResolver(platform.controlPlane, {
      runtimeDsn: platform.runtimeDsn,
      connectionsPerTenant: 4,
    });
    platform.registerCleanup(() => resolver.close());

    const slug = `documents_${platform.suffix}`;
    const [row] = await platform.controlPlane.db
      .insert(tenants)
      .values({
        slug,
        name: slug,
        baseCurrency: "SAR",
        branding: { legalName: "وكالة الاختبار للسفر — Jenova Test Agency", brandColor: "#1f4e79" },
      })
      .returning({ id: tenants.id });
    if (row === undefined) throw new Error("tenant insert returned no row");
    tenant = brandTenantId(row.id);
    const provisioned = await createTenantDatabase(platform.controlPlane, slug);
    platform.registerDb(provisioned.dbName);

    const offers = new OffersService(
      new DrizzleOfferStore(resolver),
      new FixedOfferTtlSource(),
      SIGNING_KEY,
    );
    registry = createSupplierRegistry({ mode: "replay" });
    const runner = new BookingTransitionRunner(resolver);
    service = new HotelBookingService(resolver, offers, registry, credentials, runner);
    store = new InMemoryDocumentStore();
    renderer = new CountingTypstRenderer({ bin: TYPST_BIN });
    documents = new DocumentsService({
      resolver,
      controlPlane,
      store,
      renderer,
      propertyNames: new StaticPropertyNameSource(RECORDED_PROPERTY_NAMES),
    });

    // Book the recorded lifecycle through the REAL service over replay.
    const adapter = registry.hotelAdapter("tbo");
    if (adapter === null) throw new Error("tbo adapter missing from registry");
    const ctx: AdapterCallContext = {
      credentials: await credentials.credentialsFor(tenant, "tbo"),
      deadline: new Date(Date.now() + 40_000),
      nationality: "SA",
      currency: "SAR",
      locale: "en",
    };
    const results = await adapter.search(ctx, RECORDED_SEARCH_QUERY);
    const at = new Date(RECORDED_SEARCH_INSTANT);
    const picked = [...results]
      .filter((offer) => {
        if (!offer.cancellationPolicy.refundable) return false;
        const penalty = resolvePenaltyAt(offer.cancellationPolicy, at);
        return penalty === undefined || penalty.amount === 0;
      })
      .sort((a, b) => a.net.amount - b.net.amount)[0];
    if (picked === undefined) throw new Error("no refundable zero-penalty offer in the recording");
    const checked = await adapter.check(ctx, picked.supplierOfferToken);
    const priced = assemblePricedOffer(
      {
        supplierCode: "tbo",
        vertical: "hotel",
        policySnapshot: checked.cancellationPolicy,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
      resolvePrice(checked.net, CONTEXT, []),
    );
    const issued = await offers.issueOffer(tenant, {
      offer: priced,
      supplierOfferToken: checked.supplierOfferToken,
      canonicalPropertyId: checked.canonicalPropertyId,
      nationality: "SA",
      occupancy: [{ adults: 1, childAges: [] }],
      pricingContext: CONTEXT,
      boardBasis: checked.boardBasis,
      supplierRoomName: checked.supplierRoomName,
    });
    await offers.markChecked(tenant, issued.offerId);
    const result = await service.bookHotel(tenant, {
      offerToken: issued.offerToken,
      clientReference: RECORDED_CLIENT_REFERENCE,
      holder: RECORDED_HOLDER,
      rooms: RECORDED_ROOMS,
      channel: "b2b",
      subTenantId: null,
      actor: ACTOR,
    });
    if (result.state !== "confirmed") {
      throw new Error(`replayed booking landed in ${result.state}, not confirmed`);
    }
    bookingId = result.bookingId;
  }, 120_000);

  afterAll(async () => {
    await platform.destroy();
  });

  it("renders the voucher from the replayed booking: real refs, bilingual, net-free", async () => {
    const rendered = await documents.renderVoucher(tenant, bookingId);

    // A real PDF from the real flow.
    expect(Buffer.from(rendered.bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(rendered.bytes.byteLength).toBeGreaterThan(1_000);

    // The voucher facts come from the RECORDED lifecycle.
    expect(rendered.data.supplierReference).toBe(RECORDED_CONFIRMATION_NUMBER);
    expect(rendered.data.clientReference).toBe(RECORDED_CLIENT_REFERENCE);
    expect(rendered.data.property.canonicalId).toBe("tbo:1065918");
    expect(rendered.data.property.name).toBe(RECORDED_PROPERTY_NAMES["tbo:1065918"]);
    expect(rendered.data.stay).toEqual({ checkIn: "2026-10-13", checkOut: "2026-10-14", nights: 1 });
    expect(rendered.data.boardBasis).toBe("RO");
    expect(rendered.data.roomName).not.toBeNull();
    expect(rendered.data.guests.holder).toEqual(RECORDED_HOLDER);
    // The recorded rate: 139.73 USD → 13973 minor units; sell only (net-free
    // is structural: VoucherData carries no net field at the type level).
    expect(rendered.data.sell).toEqual({ amount: 13_973, currency: "USD" });
    expect("net" in rendered.data).toBe(false);
    expect(rendered.data.policy.refundable).toBe(true);
  });

  it("stores the artifact and records the document row (sha-pinned)", async () => {
    const rendered = await documents.renderVoucher(tenant, bookingId);
    const sha = createHash("sha256").update(rendered.bytes).digest("hex");
    expect(rendered.document.kind).toBe("hotel_voucher");
    expect(rendered.document.locale).toBe("ar");
    expect(rendered.document.contentSha256).toBe(sha);
    expect(rendered.document.sizeBytes).toBe(rendered.bytes.byteLength);
    expect(store.keys()).toContain(rendered.document.storageKey);
    const fromStore = await store.get(rendered.document.storageKey);
    expect(fromStore !== null && Buffer.from(fromStore).equals(Buffer.from(rendered.bytes))).toBe(
      true,
    );
  });

  it("re-rendering is deterministic and upserts ONE row per (item, kind, locale)", async () => {
    const first = await documents.renderVoucher(tenant, bookingId);
    const second = await documents.renderVoucher(tenant, bookingId);
    expect(second.document.contentSha256).toBe(first.document.contentSha256);
    expect(second.document.id).toBe(first.document.id);
    const db = await resolver.getTenantDb(tenant);
    const [n] = await db
      .select({ n: count() })
      .from(documentRows)
      .where(eq(documentRows.bookingId, bookingId));
    expect(n?.n).toBe(1); // ar renders above; en row would be separate
  });

  it("voucherPdf serves the stored artifact without re-rendering", async () => {
    await documents.renderVoucher(tenant, bookingId);
    const before = renderer.renders;
    const served = await documents.voucherPdf(tenant, bookingId);
    expect(renderer.renders).toBe(before);
    expect(Buffer.from(served.bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });

  it("locale=en leads with the English section as a distinct document row", async () => {
    const rendered = await documents.renderVoucher(tenant, bookingId, "en");
    expect(rendered.document.locale).toBe("en");
    const db = await resolver.getTenantDb(tenant);
    const [n] = await db
      .select({ n: count() })
      .from(documentRows)
      .where(eq(documentRows.bookingId, bookingId));
    expect(n?.n).toBe(2);
  });

  it("refuses unknown bookings opaquely", async () => {
    await expect(
      documents.renderVoucher(tenant, "00000000-0000-0000-0000-00000000dead"),
    ).rejects.toMatchObject({ kind: "booking_not_found" });
    await expect(
      documents.renderVoucher(tenant, "00000000-0000-0000-0000-00000000dead"),
    ).rejects.toBeInstanceOf(VoucherDataError);
  });
});
