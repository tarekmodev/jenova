/**
 * Pending-poll worker logic (issue #68) on REAL per-tenant Postgres with the
 * REAL TBO adapter in replay mode over the committed live recordings —
 * transitions run through the runner ONLY (the poller has no other path).
 *
 * The confirmation-number literals are request DATA that must byte-match the
 * committed recordings (adapter recorded-scenarios); the reservations behind
 * them were booked AND cancelled on the live sandbox.
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { money, tenantId as brandTenantId, type TenantId } from "@jenova/domain";
import {
  auditEvents,
  bookingItems,
  createTenantDatabase,
  createTenantDbResolver,
  tenants,
  type TenantDbResolver,
} from "@jenova/db";
import { createTestPlatform, pgAvailable, type TestPlatform } from "@jenova/db/testing";
import {
  accountBalance,
  assertLedgerBalanced,
  BookingTransitionRunner,
  PendingConfirmationPoller,
  type AuditActor,
  type PendingBackoffPolicy,
} from "@jenova/booking-engine";
import {
  createSupplierRegistry,
  type SupplierCredentialsSource,
} from "@jenova/supplier-registry";
import { createPendingSweep, makeRetrieveFn } from "./pending-sweep";

/**
 * The recorded certification booking (lifecycle recording, 2026-08-30):
 * BookingDetail on it replays BookingStatus=CancellationInProgress → the
 * canonical "cancellation not yet settled" answer.
 */
const RECORDED_IN_PROGRESS_REF = "LVFXI5";

/**
 * The second recorded M1 live-proof booking (2026-08-30, booked and its
 * cancellation requested immediately): BookingDetail on it replays
 * BookingStatus=Confirmed — the canonical "async confirmation settled"
 * answer (captured before the cancel; the cancel hops ran unrecorded so
 * this fingerprint keeps the confirmed state for replay).
 */
const RECORDED_CONFIRMED_REF = "SNAO7U";

/**
 * The first recorded M1 live-proof booking, retrieved AFTER its live
 * cancellation settled: BookingDetail replays BookingStatus=Cancelled —
 * the canonical "requested cancellation settled" answer.
 */
const RECORDED_CANCELLED_REF = "PCUGMH";

const ACTOR: AuditActor = { actorType: "system", actorId: "worker-test" };
const POLICY = {
  refundable: true,
  rules: [{ fromUtc: "2020-01-01T00:00:00.000Z", penalty: money(0, "USD") }],
};

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

describe.skipIf(!available)("pending-confirmation worker over recorded TBO traffic", () => {
  let platform: TestPlatform;
  let resolver: TenantDbResolver;
  let tenant: TenantId;
  let runner: BookingTransitionRunner;
  let poller: PendingConfirmationPoller;
  const registry = createSupplierRegistry({ mode: "replay" });
  const credentials = new ReplayCredentialsSource();
  let sequence = 0;

  beforeAll(async () => {
    platform = await createTestPlatform();
    resolver = createTenantDbResolver(platform.controlPlane, {
      runtimeDsn: platform.runtimeDsn,
      connectionsPerTenant: 4,
    });
    platform.registerCleanup(() => resolver.close());

    const slug = `worker_${platform.suffix}`;
    const [row] = await platform.controlPlane.db
      .insert(tenants)
      .values({ slug, name: slug, baseCurrency: "SAR" })
      .returning({ id: tenants.id });
    if (row === undefined) throw new Error("tenant insert returned no row");
    tenant = brandTenantId(row.id);
    const provisioned = await createTenantDatabase(platform.controlPlane, slug);
    platform.registerDb(provisioned.dbName);

    runner = new BookingTransitionRunner(resolver);
    poller = new PendingConfirmationPoller(
      resolver,
      runner,
      makeRetrieveFn(registry, credentials),
    );
  }, 60_000);

  afterAll(async () => {
    await platform.destroy();
  });

  /** A confirmed item with an async cancellation in flight at `requestedAt`. */
  async function pendingCancelItem(supplierReference: string): Promise<string> {
    sequence += 1;
    const created = await runner.createHotelBooking(tenant, {
      clientReference: `WORKER-${platform.suffix}-${String(sequence)}`,
      channel: "b2b",
      agencyId: null,
      supplierCode: "tbo",
      vertical: "hotel",
      offerId: null,
      net: money(13_973, "USD"),
      sell: money(13_973, "USD"),
      policySnapshot: POLICY,
      actor: ACTOR,
    });
    const itemId = created.item.id;
    await runner.transition(tenant, itemId, "reserved", { expectedFrom: "quoted", actor: ACTOR, reason: "r" });
    await runner.transition(tenant, itemId, "confirmed", {
      expectedFrom: "reserved",
      actor: ACTOR,
      reason: "c",
      patch: { supplierReference },
    });
    await runner.markCancellationRequested(tenant, itemId, ACTOR, new Date());
    return itemId;
  }

  it("pending_confirmation → confirmed via the runner when retrieve reports Confirmed", async () => {
    sequence += 1;
    const created = await runner.createHotelBooking(tenant, {
      clientReference: `WORKER-PEND-${platform.suffix}-${String(sequence)}`,
      channel: "b2b",
      agencyId: null,
      supplierCode: "tbo",
      vertical: "hotel",
      offerId: null,
      net: money(14_169, "USD"),
      sell: money(14_169, "USD"),
      policySnapshot: POLICY,
      actor: ACTOR,
    });
    const itemId = created.item.id;
    await runner.transition(tenant, itemId, "reserved", { expectedFrom: "quoted", actor: ACTOR, reason: "r" });
    // The supplier answered `pending` at book time: the wait the worker owns.
    await runner.transition(tenant, itemId, "pending_confirmation", {
      expectedFrom: "reserved",
      actor: ACTOR,
      reason: "supplier accepted pending confirmation",
      patch: { supplierReference: RECORDED_CONFIRMED_REF, pendingSince: new Date(), nextPollAt: new Date() },
    });
    const db = await resolver.getTenantDb(tenant);
    expect(await accountBalance(db, "agency_receivable", "USD")).toBe(0n); // nothing recognized yet

    const report = await poller.pollTenant(tenant);
    const outcome = report.outcomes.find((o) => o.bookingItemId === itemId);
    expect(outcome?.kind).toBe("confirmation");
    expect(outcome?.outcome).toBe("transitioned_confirmed");

    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, itemId));
    expect(item?.state).toBe("confirmed");
    // Confirmation settled THROUGH THE RUNNER: confirm postings + audit.
    expect(await accountBalance(db, "agency_receivable", "USD")).toBe(14_169n);
    expect(await accountBalance(db, "supplier_payable", "USD")).toBe(-14_169n);
    await assertLedgerBalanced(db);
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.entityId, itemId));
    expect(audits.filter((a) => a.action === "booking_item.transition")).toHaveLength(3);
    expect(audits.at(-1)?.actorId).toBe("worker:pending-confirmation");
  });

  it("a not-yet-settled cancellation stays pending with exponential backoff", async () => {
    const itemId = await pendingCancelItem(RECORDED_IN_PROGRESS_REF);
    const db = await resolver.getTenantDb(tenant);

    const due = await poller.duePendingItems(tenant);
    expect(due.map((i) => i.id)).toContain(itemId);

    const report = await poller.pollTenant(tenant);
    const outcome = report.outcomes.find((o) => o.bookingItemId === itemId);
    // The recording replays BookingStatus=CancellationInProgress → pending.
    expect(outcome?.kind).toBe("cancellation");
    expect(outcome?.outcome).toBe("still_pending");

    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, itemId));
    expect(item?.state).toBe("confirmed"); // runner untouched — no transition happened
    expect(item?.pollAttempts).toBe(1);
    expect(item?.nextPollAt && item.nextPollAt.getTime()).toBeGreaterThan(Date.now());

    // Backed off: not due again until nextPollAt passes.
    const dueAfter = await poller.duePendingItems(tenant);
    expect(dueAfter.map((i) => i.id)).not.toContain(itemId);
  });

  it("a settled cancellation transitions to cancelled with the reversal posted", async () => {
    const itemId = await pendingCancelItem(RECORDED_CANCELLED_REF);
    const db = await resolver.getTenantDb(tenant);
    // The item's confirm transition already posted the receivable; capture
    // the balance so the settlement's reversal is measurable below.
    const before = await accountBalance(db, "agency_receivable", "USD");

    const report = await poller.pollTenant(tenant);
    const outcome = report.outcomes.find((o) => o.bookingItemId === itemId);
    // The recording replays BookingStatus=Cancelled → the poller settles the
    // wait through the runner at the penalty quoted at request time (zero
    // here — the structural policy has no penalty rules).
    expect(outcome?.kind).toBe("cancellation");
    expect(outcome?.outcome).toBe("transitioned_cancelled");

    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, itemId));
    expect(item?.state).toBe("cancelled");
    const after = await accountBalance(db, "agency_receivable", "USD");
    expect(before - after).toBe(13_973n); // the item's confirm receivable reversed
    await assertLedgerBalanced(db);
  });

  it("a wait past max age ESCALATES: polling stops, the manual queue surfaces it", async () => {
    const itemId = await pendingCancelItem(RECORDED_IN_PROGRESS_REF);
    const db = await resolver.getTenantDb(tenant);
    // Arrange an old wait: the cancellation was requested two hours ago.
    await db
      .update(bookingItems)
      .set({ cancellationRequestedAt: new Date(Date.now() - 2 * 3_600_000), nextPollAt: new Date() })
      .where(eq(bookingItems.id, itemId));

    const shortFuse: PendingBackoffPolicy = {
      baseMs: 30_000,
      factor: 2,
      capMs: 600_000,
      maxPendingAgeMs: 3_600_000,
    };
    const fusePoller = new PendingConfirmationPoller(
      resolver,
      runner,
      makeRetrieveFn(registry, credentials),
      shortFuse,
    );
    const report = await fusePoller.pollTenant(tenant);
    const outcome = report.outcomes.find((o) => o.bookingItemId === itemId);
    expect(outcome?.outcome).toBe("escalated");

    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, itemId));
    expect(item?.escalatedAt).not.toBeNull();
    expect(item?.escalationReason).toMatch(/manual intervention/);
    expect(item?.state).toBe("confirmed"); // escalation never invents a state

    // Audited for the dispute trail; excluded from every future sweep.
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.entityId, itemId));
    expect(audits.some((a) => a.action === "booking_item.escalated")).toBe(true);
    const due = await fusePoller.duePendingItems(tenant);
    expect(due.map((i) => i.id)).not.toContain(itemId);
  });

  it("the sweep composes: every provisioned tenant polled, failures contained", async () => {
    const sweep = createPendingSweep({
      controlPlane: platform.controlPlane,
      resolver,
      registry,
      credentials,
      runner,
    });
    const report = await sweep();
    expect(report.tenants).toBe(1);
    expect(report.failures).toHaveLength(0);
  });
});
