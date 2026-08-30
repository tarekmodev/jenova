/**
 * Hotel book/cancel service tests (issue #67) on REAL per-tenant Postgres
 * (@jenova/db harness) driving the REAL TBO adapter in replay mode over the
 * committed recordings of the live certification lifecycle (booking LVFXI5,
 * booked and cancelled on the real sandbox on 2026-08-30) — real recorded
 * traffic, zero fabricated supplier data (CLAUDE.md rule 5).
 *
 * The holder/guest/clientReference literals below MUST byte-match the
 * recorded Book request (packages/adapters/hotel/tbo/src/
 * recorded-scenarios.ts — apps must not import adapter packages, so the
 * request DATA is duplicated here verbatim); replay fails loudly on drift.
 */

import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  resolvePenaltyAt,
  tenantId as brandTenantId,
  zero,
  type TenantId,
} from "@jenova/domain";
import {
  auditEvents,
  bookings,
  bookingItems,
  createTenantDatabase,
  createTenantDbResolver,
  journalEntries,
  offers as offerRows,
  tenants,
  type TenantDbResolver,
} from "@jenova/db";
import { createTestPlatform, pgAvailable, type TestPlatform } from "@jenova/db/testing";
import {
  accountBalance,
  assertLedgerBalanced,
  BookingTransitionRunner,
} from "@jenova/booking-engine";
import {
  createSupplierRegistry,
  type SupplierCredentialsSource,
  type SupplierRegistry,
} from "@jenova/supplier-registry";
import type { AdapterCallContext, HotelOffer } from "@jenova/supplier-sdk";
import { assemblePricedOffer } from "../pricing/offer";
import { resolvePrice } from "../pricing/resolve";
import type { PricingContext } from "../pricing/rules";
import { DrizzleOfferStore } from "../offers/offer-store";
import { FixedOfferTtlSource, OffersService } from "../offers/offers.service";
import { HotelBookingService } from "./booking.service";

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
const RECORDED_ROOMS = [
  { guests: [{ firstName: "Jenova", lastName: "Certification" }] },
];
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

/**
 * Replay resolves recordings by URL + body fingerprint, never by
 * credentials — structural placeholders, same as the adapter's own tests.
 */
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

const available = await pgAvailable();

describe.skipIf(!available)("HotelBookingService — book/cancel over recorded TBO traffic", () => {
  let platform: TestPlatform;
  let resolver: TenantDbResolver;
  let tenant: TenantId;
  let offers: OffersService;
  let registry: SupplierRegistry;
  let runner: BookingTransitionRunner;
  let service: HotelBookingService;
  const credentials = new ReplayCredentialsSource();

  beforeAll(async () => {
    platform = await createTestPlatform();
    resolver = createTenantDbResolver(platform.controlPlane, {
      runtimeDsn: platform.runtimeDsn,
      connectionsPerTenant: 4,
    });
    platform.registerCleanup(() => resolver.close());

    const slug = `booking_${platform.suffix}`;
    const [row] = await platform.controlPlane.db
      .insert(tenants)
      .values({ slug, name: slug, baseCurrency: "SAR" })
      .returning({ id: tenants.id });
    if (row === undefined) throw new Error("tenant insert returned no row");
    tenant = brandTenantId(row.id);
    const provisioned = await createTenantDatabase(platform.controlPlane, slug);
    platform.registerDb(provisioned.dbName);

    offers = new OffersService(new DrizzleOfferStore(resolver), new FixedOfferTtlSource(), SIGNING_KEY);
    registry = createSupplierRegistry({ mode: "replay" });
    runner = new BookingTransitionRunner(resolver);
    service = new HotelBookingService(resolver, offers, registry, credentials, runner);
  }, 60_000);

  afterAll(async () => {
    await platform.destroy();
  });

  function adapterContext(): AdapterCallContext {
    return {
      credentials: {
        tenantId: tenant,
        supplierCode: "tbo",
        environment: "sandbox",
        secrets: {
          apiUrl: "https://api.tbotechnology.in/TBOHolidays_HotelAPI",
          username: "replay",
          password: "replay",
        },
      },
      deadline: new Date(Date.now() + 40_000),
      nationality: "SA",
      currency: "SAR",
      locale: "en",
    };
  }

  /** search → pick the recorded lifecycle rate → check → issue + mark checked. */
  async function issueCheckedOffer(): Promise<{ offerToken: string; offerId: string; checked: HotelOffer }> {
    const adapter = registry.hotelAdapter("tbo");
    if (adapter === null) throw new Error("tbo adapter missing from registry");
    const results = await adapter.search(adapterContext(), RECORDED_SEARCH_QUERY);
    // The recorded lifecycle rate: cheapest refundable offer with a zero
    // penalty at the recorded instant (same selection the recording made).
    const at = new Date(RECORDED_SEARCH_INSTANT);
    const candidates = results.filter((offer) => {
      if (!offer.cancellationPolicy.refundable) return false;
      const penalty = resolvePenaltyAt(offer.cancellationPolicy, at);
      return penalty === undefined || penalty.amount === 0;
    });
    const picked = [...candidates].sort((a, b) => a.net.amount - b.net.amount)[0];
    if (picked === undefined) throw new Error("no refundable zero-penalty offer in the recording");

    const checked = await adapter.check(adapterContext(), picked.supplierOfferToken);
    const resolution = resolvePrice(checked.net, CONTEXT, []);
    const priced = assemblePricedOffer(
      {
        supplierCode: "tbo",
        vertical: "hotel",
        policySnapshot: checked.cancellationPolicy,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
      resolution,
    );
    const issued = await offers.issueOffer(tenant, {
      offer: priced,
      supplierOfferToken: checked.supplierOfferToken,
      canonicalPropertyId: checked.canonicalPropertyId,
      nationality: "SA",
      occupancy: [{ adults: 1, childAges: [] }],
      pricingContext: CONTEXT,
    });
    await offers.markChecked(tenant, issued.offerId);
    return { offerToken: issued.offerToken, offerId: issued.offerId, checked };
  }

  let bookingId = "";
  let bookingItemId = "";
  let bookedOfferToken = "";

  it("books through the offer gate: quoted → reserved → confirmed, postings balanced", async () => {
    const { offerToken } = await issueCheckedOffer();
    bookedOfferToken = offerToken;
    const db = await resolver.getTenantDb(tenant);

    const result = await service.bookHotel(tenant, {
      offerToken,
      clientReference: RECORDED_CLIENT_REFERENCE,
      holder: RECORDED_HOLDER,
      rooms: RECORDED_ROOMS,
      channel: "b2b",
      subTenantId: null,
      actor: ACTOR,
    });
    bookingId = result.bookingId;
    bookingItemId = result.bookingItemId;

    expect(result.state).toBe("confirmed");
    expect(result.idempotentReplay).toBe(false);
    expect(result.supplierReference).toBe(RECORDED_CONFIRMATION_NUMBER);
    // The recorded rate: 139.73 USD → 13973 minor units, sell = net (no rule).
    expect(result.sell).toEqual({ amount: 13_973, currency: "USD" });

    // Confirm postings: DR AR / CR sales (sell) + DR COS / CR SP (net).
    expect(await accountBalance(db, "agency_receivable", "USD")).toBe(13_973n);
    expect(await accountBalance(db, "sales", "USD")).toBe(-13_973n);
    expect(await accountBalance(db, "cost_of_sales", "USD")).toBe(13_973n);
    expect(await accountBalance(db, "supplier_payable", "USD")).toBe(-13_973n);
    await assertLedgerBalanced(db);

    // Audit trail: booking.created + quoted→reserved + reserved→confirmed.
    const itemAudits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, bookingItemId))
      .orderBy(auditEvents.id);
    expect(itemAudits.map((a) => a.action)).toEqual([
      "booking_item.transition",
      "booking_item.transition",
    ]);
    expect(itemAudits[0]?.before).toMatchObject({ state: "quoted" });
    expect(itemAudits[1]?.after).toMatchObject({
      state: "confirmed",
      supplierReference: RECORDED_CONFIRMATION_NUMBER,
    });
    expect(itemAudits.every((a) => a.actorId === ACTOR.actorId)).toBe(true);
  });

  it("consumed the offer: it is invalidated and can never book again", async () => {
    // The booked offer was invalidated on success — no second reservation
    // can ever be minted from it, under any clientReference.
    const db = await resolver.getTenantDb(tenant);
    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, bookingItemId));
    expect(item?.offerId).toBeTruthy();
    const [offerRow] = await db
      .select({ invalidatedAt: offerRows.invalidatedAt })
      .from(offerRows)
      .where(eq(offerRows.id, item?.offerId ?? ""));
    expect(offerRow?.invalidatedAt).not.toBeNull();
  });

  it("idempotent double-book: the SAME clientReference + SAME offer replays the original booking", async () => {
    const before = await (await resolver.getTenantDb(tenant))
      .select({ n: count() })
      .from(bookings);

    const replay = await service.bookHotel(tenant, {
      offerToken: bookedOfferToken, // the ORIGINAL token — equivalence holds
      clientReference: RECORDED_CLIENT_REFERENCE,
      holder: RECORDED_HOLDER,
      rooms: RECORDED_ROOMS,
      channel: "b2b",
      subTenantId: null,
      actor: ACTOR,
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.bookingId).toBe(bookingId);
    expect(replay.state).toBe("confirmed");
    expect(replay.supplierReference).toBe(RECORDED_CONFIRMATION_NUMBER);

    const after = await (await resolver.getTenantDb(tenant)).select({ n: count() }).from(bookings);
    expect(after).toEqual(before); // no second booking row, no supplier call
  });

  it("clientReference reuse with a DIFFERENT offer is REFUSED — never the wrong booking", async () => {
    // Review round 2, #1 (Stripe-style idempotency contract): key reuse with
    // different parameters must refuse, or a partner bug reusing keys hears
    // "201 confirmed" for a hotel it never asked for.
    const { offerToken: differentOffer } = await issueCheckedOffer();
    for (const token of [differentOffer, "of1.00000000-0000-0000-0000-000000000000.garbage"]) {
      await expect(
        service.bookHotel(tenant, {
          offerToken: token,
          clientReference: RECORDED_CLIENT_REFERENCE,
          holder: RECORDED_HOLDER,
          rooms: RECORDED_ROOMS,
          channel: "b2b",
          subTenantId: null,
          actor: ACTOR,
        }),
      ).rejects.toMatchObject({ kind: "client_reference_conflict" });
    }
  });

  it("one offer admits exactly ONE booking attempt — the racing claim loses cleanly", async () => {
    const { offerToken, offerId } = await issueCheckedOffer();
    // First claim wins (simulating the concurrent booking that got there
    // first — the row-level arbitration is identical under true parallelism,
    // proven by the offer-store's racing-supersede suite).
    await expect(offers.claimOfferForBooking(tenant, offerId)).resolves.toBe(true);

    const db = await resolver.getTenantDb(tenant);
    const before = await db.select({ n: count() }).from(bookings);
    await expect(
      service.bookHotel(tenant, {
        offerToken,
        clientReference: `STRUCT-RACER-${platform.suffix}`,
        holder: RECORDED_HOLDER,
        rooms: RECORDED_ROOMS,
        channel: "b2b",
        subTenantId: null,
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({ kind: "offer_invalidated" });
    // The loser wrote NOTHING and never reached the supplier.
    expect(await db.select({ n: count() }).from(bookings)).toEqual(before);
  });

  it("rejects a guest list that does not match the priced occupancy", async () => {
    const { offerToken } = await issueCheckedOffer();
    await expect(
      service.bookHotel(tenant, {
        offerToken,
        clientReference: `STRUCT-MISMATCH-${platform.suffix}`,
        holder: RECORDED_HOLDER,
        rooms: [{ guests: [{ firstName: "Jenova", lastName: "Certification" }] }, { guests: [] }],
        channel: "b2b",
        subTenantId: null,
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({ kind: "booking_request_invalid" });
  });

  it("previews the cancellation fee from the STORED policy before any supplier call", async () => {
    const db = await resolver.getTenantDb(tenant);
    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, bookingItemId));
    if (item === undefined) throw new Error("booked item missing");
    const preview = await service.previewCancellation(tenant, bookingId, {
      subTenantId: null,
      actor: ACTOR,
    });
    const expected = resolvePenaltyAt(item.policySnapshot, preview.asOf) ?? zero(item.currency);
    expect(preview.penalty).toEqual(expected);
    expect(preview.refundable).toBe(true);
  });

  it("cancel: TBO answers CancellationInProgress → pending-cancel wait, NO postings yet", async () => {
    const db = await resolver.getTenantDb(tenant);
    const journalBefore = await db.select({ n: count() }).from(journalEntries);

    const result = await service.cancelBooking(tenant, bookingId, {
      subTenantId: null,
      actor: ACTOR,
    });
    expect(result.status).toBe("cancellation_pending");
    expect(result.state).toBe("confirmed"); // state unchanged until the supplier settles

    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, bookingItemId));
    expect(item?.cancellationRequestedAt).not.toBeNull();
    expect(item?.nextPollAt).not.toBeNull(); // the worker's wait is armed

    // Money moves when the cancellation SETTLES, not when it is requested.
    expect(await db.select({ n: count() }).from(journalEntries)).toEqual(journalBefore);

    // Idempotent: a second cancel call reports the pending wait, calls nothing.
    const again = await service.cancelBooking(tenant, bookingId, { subTenantId: null, actor: ACTOR });
    expect(again.status).toBe("cancellation_pending");
  });

  it("settlement (worker path) posts the reversal at the penalty quoted at request time", async () => {
    const db = await resolver.getTenantDb(tenant);
    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, bookingItemId));
    if (item === undefined) throw new Error("booked item missing");
    const requestedAt = item.cancellationRequestedAt ?? new Date();
    const penalty = resolvePenaltyAt(item.policySnapshot, requestedAt) ?? null;

    // Exactly what the worker's poller executes once the supplier reports
    // cancelled (driven deterministically here; the worker suite drives the
    // same transition from a replayed retrieve()).
    await runner.transition(tenant, bookingItemId, "cancelled", {
      expectedFrom: "confirmed",
      actor: { actorType: "system", actorId: "worker:pending-confirmation" },
      reason: "supplier retrieve reports the requested cancellation settled",
      penalty: penalty !== null && penalty.amount === 0 ? null : penalty,
    });

    const [settled] = await db.select().from(bookingItems).where(eq(bookingItems.id, bookingItemId));
    expect(settled?.state).toBe("cancelled");
    await assertLedgerBalanced(db);
    // Free-window cancellation: the reversal zeroes the item's postings.
    if (penalty === null || penalty.amount === 0) {
      expect(await accountBalance(db, "agency_receivable", "USD")).toBe(0n);
      expect(await accountBalance(db, "supplier_payable", "USD")).toBe(0n);
    }
  });

  // Nightly-style CI assertion (issue #69): after every flow in this suite,
  // EVERY transaction group in the tenant database balances per currency.
  it("ledger-invariant sweep over the whole test run's postings", async () => {
    await assertLedgerBalanced(await resolver.getTenantDb(tenant));
  });
});
