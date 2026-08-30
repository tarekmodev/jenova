/**
 * Voucher delivery consumer tests (issue #100) on REAL per-tenant Postgres,
 * consuming the REAL `booking_item.confirmed` outbox event produced by
 * replaying the recorded TBO certification booking (LVFXI5) through the real
 * booking service — no fabricated supplier data (CLAUDE.md rule 5). The
 * retry/terminal scenarios re-enqueue ADDITIONAL outbox rows for that same
 * real confirmed item (simulating at-least-once redelivery, which consumers
 * must tolerate anyway); those rows are our own outbox shape, not supplier
 * data.
 *
 * Requires: local Postgres AND a Typst binary — skipped otherwise.
 */

import { and, count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolvePenaltyAt, tenantId as brandTenantId, type TenantId } from "@jenova/domain";
import {
  bookingEvents,
  bookingItems,
  createTenantDatabase,
  createTenantDbResolver,
  documentDeliveries,
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
  RecordingMailSender,
  StaticPropertyNameSource,
  TypstRenderer,
  typstAvailable,
  VoucherDeliveryConsumer,
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

const TYPST_BIN = process.env["DOCUMENTS_TYPST_BIN"] ?? "typst";
const available = (await pgAvailable()) && (await typstAvailable(TYPST_BIN));

describe.skipIf(!available)("VoucherDeliveryConsumer — confirm event → voucher → email", () => {
  let platform: TestPlatform;
  let resolver: TenantDbResolver;
  let controlPlane: ControlPlaneClient;
  let tenant: TenantId;
  let runner: BookingTransitionRunner;
  let documents: DocumentsService;
  let mail: RecordingMailSender;
  let clock: Date;
  let bookingId = "";
  let bookingItemId = "";
  const credentials = new ReplayCredentialsSource();

  function consumer(options: { maxAttempts?: number; backoffBaseMs?: number } = {}) {
    return new VoucherDeliveryConsumer(
      { resolver, documents, mail, runner },
      { ...options, now: () => clock },
    );
  }

  async function insertRedeliveredConfirmEvent(): Promise<string> {
    // At-least-once outbox: consumers must tolerate duplicate/late events
    // for an already-confirmed item — this simulates exactly that.
    const db = await resolver.getTenantDb(tenant);
    const [row] = await db
      .insert(bookingEvents)
      .values({
        bookingId,
        bookingItemId,
        eventType: "booking_item.confirmed",
        payload: { from: "reserved", to: "confirmed", reason: "structural redelivery twin" },
      })
      .returning({ id: bookingEvents.id });
    if (row === undefined) throw new Error("event insert returned no row");
    return row.id;
  }

  beforeAll(async () => {
    platform = await createTestPlatform();
    controlPlane = platform.controlPlane;
    resolver = createTenantDbResolver(platform.controlPlane, {
      runtimeDsn: platform.runtimeDsn,
      connectionsPerTenant: 4,
    });
    platform.registerCleanup(() => resolver.close());

    const slug = `delivery_${platform.suffix}`;
    const [row] = await platform.controlPlane.db
      .insert(tenants)
      .values({ slug, name: "Jenova Delivery Test", baseCurrency: "SAR" })
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
    const registry: SupplierRegistry = createSupplierRegistry({ mode: "replay" });
    runner = new BookingTransitionRunner(resolver);
    const service = new HotelBookingService(resolver, offers, registry, credentials, runner);
    documents = new DocumentsService({
      resolver,
      controlPlane,
      store: new InMemoryDocumentStore(),
      renderer: new TypstRenderer({ bin: TYPST_BIN }),
      propertyNames: new StaticPropertyNameSource(RECORDED_PROPERTY_NAMES),
    });
    mail = new RecordingMailSender();
    clock = new Date();

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
    bookingItemId = result.bookingItemId;
  }, 120_000);

  afterAll(async () => {
    await platform.destroy();
  });

  it("delivers the voucher for the REAL confirmed event: rendered, emailed, recorded", async () => {
    const report = await consumer().sweepTenant(tenant);
    expect(report.claimed).toBe(1);
    expect(report.sent).toBe(1);
    expect(report.retried).toBe(0);
    expect(report.failed).toBe(0);

    // The email: bilingual, to the recorded holder, voucher attached.
    expect(mail.sent).toHaveLength(1);
    const sent = mail.sent[0];
    expect(sent?.to).toBe(RECORDED_HOLDER.email);
    expect(sent?.subject).toContain(RECORDED_CONFIRMATION_NUMBER);
    expect(sent?.subject).toContain("تأكيد الحجز");
    expect(sent?.subject).toContain("Comfort Inn Taawn");
    expect(sent?.text).toContain("تم تأكيد حجزكم");
    expect(sent?.text).toContain("Your booking at Comfort Inn Taawn is confirmed.");
    const attachment = sent?.attachments[0];
    expect(attachment?.filename).toBe(`voucher-${RECORDED_CONFIRMATION_NUMBER}.pdf`);
    expect(attachment?.contentType).toBe("application/pdf");
    expect(
      Buffer.from((attachment?.bytes ?? new Uint8Array()).subarray(0, 5)).toString("latin1"),
    ).toBe("%PDF-");

    // The delivery row: sent, pointing at the stored document.
    const db = await resolver.getTenantDb(tenant);
    const rows = await db.select().from(documentDeliveries);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("sent");
    expect(rows[0]?.recipient).toBe(RECORDED_HOLDER.email);
    expect(rows[0]?.documentId).not.toBeNull();
    expect(rows[0]?.sentAt).not.toBeNull();
  });

  it("is idempotent: a second sweep claims and sends NOTHING", async () => {
    const report = await consumer().sweepTenant(tenant);
    expect(report).toEqual({ claimed: 0, sent: 0, retried: 0, failed: 0 });
    expect(mail.sent).toHaveLength(1);
  });

  it("retries with backoff on send failure, then succeeds when due", async () => {
    const eventId = await insertRedeliveredConfirmEvent();
    mail.failuresRemaining = 1;
    const c = consumer({ backoffBaseMs: 60_000 });

    const first = await c.sweepTenant(tenant);
    expect(first.claimed).toBe(1);
    expect(first.retried).toBe(1);
    expect(first.sent).toBe(0);

    const db = await resolver.getTenantDb(tenant);
    const [row] = await db
      .select()
      .from(documentDeliveries)
      .where(eq(documentDeliveries.bookingEventId, eventId));
    expect(row?.state).toBe("pending");
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toContain("smtp unavailable");
    expect(row?.nextAttemptAt?.getTime()).toBe(clock.getTime() + 60_000);

    // Not due yet: nothing happens.
    expect((await c.sweepTenant(tenant)).sent).toBe(0);

    // Past the backoff: the retry delivers.
    clock = new Date(clock.getTime() + 61_000);
    const second = await c.sweepTenant(tenant);
    expect(second.sent).toBe(1);
    expect(mail.sent).toHaveLength(2);
  });

  it("terminal failure flips the row to failed AND escalates into the manual queue", async () => {
    const eventId = await insertRedeliveredConfirmEvent();
    mail.failuresRemaining = 99;
    const report = await consumer({ maxAttempts: 1 }).sweepTenant(tenant);
    mail.failuresRemaining = 0;
    expect(report.failed).toBe(1);

    const db = await resolver.getTenantDb(tenant);
    const [row] = await db
      .select()
      .from(documentDeliveries)
      .where(eq(documentDeliveries.bookingEventId, eventId));
    expect(row?.state).toBe("failed");
    expect(row?.nextAttemptAt).toBeNull();

    // The booking item surfaces in the manual-intervention queue.
    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, bookingItemId));
    expect(item?.escalatedAt).not.toBeNull();
    expect(item?.escalationReason).toContain("voucher delivery failed terminally");
    const [escalations] = await db
      .select({ n: count() })
      .from(bookingEvents)
      .where(
        and(
          eq(bookingEvents.bookingItemId, bookingItemId),
          eq(bookingEvents.eventType, "booking_item.escalated"),
        ),
      );
    expect(escalations?.n).toBe(1);
  });

  it("an event whose item has no guests snapshot is recorded failed, never silently dropped", async () => {
    const db = await resolver.getTenantDb(tenant);
    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, bookingItemId));
    const guests = item?.guests ?? null;
    await db.update(bookingItems).set({ guests: null }).where(eq(bookingItems.id, bookingItemId));
    try {
      const eventId = await insertRedeliveredConfirmEvent();
      const report = await consumer().sweepTenant(tenant);
      expect(report.sent).toBe(0);
      const [row] = await db
        .select()
        .from(documentDeliveries)
        .where(eq(documentDeliveries.bookingEventId, eventId));
      expect(row?.state).toBe("failed");
      expect(row?.recipient).toBe("");
      expect(row?.lastError).toContain("no recipient");
    } finally {
      await db.update(bookingItems).set({ guests }).where(eq(bookingItems.id, bookingItemId));
    }
  });
});
