/**
 * Pending-poll worker logic (issue #68) on REAL per-tenant Postgres with the
 * REAL TBO adapter in replay mode over the committed live recordings —
 * transitions run through the runner ONLY (the poller has no other path).
 *
 * The confirmation-number literals are request DATA that must byte-match the
 * committed recordings (adapter recorded-scenarios); the reservations behind
 * them were booked AND cancelled on the live sandbox. Item rows are built
 * FROM the recordings (net fare + normalized cancellation policy come from
 * the replayed BookingDetail, through the real adapter) — no fabricated
 * policies or amounts (CLAUDE.md rule 5; review round 2, #5).
 */

import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  resolvePenaltyAt,
  tenantId as brandTenantId,
  type CancellationPolicy,
  type Money,
  type TenantId,
} from "@jenova/domain";
import {
  auditEvents,
  bookingItems,
  createTenantDatabase,
  createTenantDbResolver,
  journalEntries,
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
import type { HotelBookingRecord } from "@jenova/supplier-sdk";
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

/** First instant at which the policy's penalty matches `predicate` — probes
 * just-before-the-first-rule plus each rule boundary; throws when the
 * recorded policy has no such window (fail loudly, never guess). */
function instantWhere(
  policy: CancellationPolicy,
  predicate: (penalty: Money | undefined) => boolean,
  what: string,
): Date {
  const candidates: Date[] = [];
  const first = policy.rules[0];
  if (first !== undefined) {
    candidates.push(new Date(Date.parse(first.fromUtc) - 1_000));
  }
  for (const rule of policy.rules) {
    candidates.push(new Date(Date.parse(rule.fromUtc) + 1_000));
  }
  for (const candidate of candidates) {
    if (predicate(resolvePenaltyAt(policy, candidate))) {
      return candidate;
    }
  }
  throw new Error(`recorded policy offers no ${what} window: ${JSON.stringify(policy)}`);
}

const freeWindowInstant = (policy: CancellationPolicy): Date =>
  instantWhere(policy, (p) => p === undefined || p.amount === 0, "free-cancellation");

const fullPenaltyInstant = (policy: CancellationPolicy, full: Money): Date =>
  instantWhere(policy, (p) => p !== undefined && p.amount === full.amount, "full-penalty");

const available = await pgAvailable();

describe.skipIf(!available)("pending-confirmation worker over recorded TBO traffic", () => {
  let platform: TestPlatform;
  let resolver: TenantDbResolver;
  let tenant: TenantId;
  let runner: BookingTransitionRunner;
  let poller: PendingConfirmationPoller;
  const registry = createSupplierRegistry({ mode: "replay" });
  const credentials = new ReplayCredentialsSource();
  const retrieveReplay = makeRetrieveFn(registry, credentials);
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
    poller = new PendingConfirmationPoller(resolver, runner, retrieveReplay);
  }, 60_000);

  afterAll(async () => {
    await platform.destroy();
  });

  /**
   * Poller pinned to a deterministic clock: the recorded policies anchor
   * every instant (free window, 100% deadline), so tests pin "now" near the
   * relevant policy instant instead of depending on the wall clock.
   */
  function pollerAt(at: Date, policy?: PendingBackoffPolicy): PendingConfirmationPoller {
    return new PendingConfirmationPoller(resolver, runner, retrieveReplay, policy, () => at);
  }

  /** The REAL recorded booking behind `ref`, through the replay adapter. */
  async function recordedBooking(ref: string): Promise<HotelBookingRecord> {
    return retrieveReplay(tenant, {
      supplierCode: "tbo",
      supplierBookingReference: ref,
      currency: "USD",
    });
  }

  /** A booking + item carrying the RECORDED fare and normalized policy. */
  async function recordedItem(record: HotelBookingRecord): Promise<string> {
    sequence += 1;
    const created = await runner.createHotelBooking(tenant, {
      clientReference: `WORKER-${platform.suffix}-${String(sequence)}`,
      channel: "b2b",
      agencyId: null,
      supplierCode: "tbo",
      vertical: "hotel",
      offerId: null,
      net: record.net,
      sell: record.net,
      policySnapshot: record.cancellationPolicy,
      // sell === net in this harness, so the sell-side policy is identical.
      sellPolicySnapshot: record.cancellationPolicy,
      actor: ACTOR,
    });
    return created.item.id;
  }

  /** A confirmed item with an async cancellation in flight at `requestedAt`. */
  async function pendingCancelItem(ref: string, requestedAt?: Date): Promise<{
    itemId: string;
    record: HotelBookingRecord;
  }> {
    const record = await recordedBooking(ref);
    const itemId = await recordedItem(record);
    await runner.transition(tenant, itemId, "reserved", { expectedFrom: "quoted", actor: ACTOR, reason: "r" });
    await runner.transition(tenant, itemId, "confirmed", {
      expectedFrom: "reserved",
      actor: ACTOR,
      reason: "c",
      patch: { supplierReference: record.supplierBookingReference },
    });
    await runner.markCancellationRequested(
      tenant,
      itemId,
      ACTOR,
      requestedAt ?? freeWindowInstant(record.cancellationPolicy),
    );
    return { itemId, record };
  }

  it("pending_confirmation → confirmed via the runner when retrieve reports Confirmed", async () => {
    const record = await recordedBooking(RECORDED_CONFIRMED_REF);
    const itemId = await recordedItem(record);
    const fare = BigInt(record.net.amount);
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
    expect(await accountBalance(db, "agency_receivable", "USD")).toBe(fare);
    expect(await accountBalance(db, "supplier_payable", "USD")).toBe(-fare);
    await assertLedgerBalanced(db);
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.entityId, itemId));
    expect(audits.filter((a) => a.action === "booking_item.transition")).toHaveLength(3);
    expect(audits.at(-1)?.actorId).toBe("worker:pending-confirmation");
  });

  it("a cancellation requested on a PENDING item survives its confirmation with a FRESH backoff", async () => {
    // Review round 2, #3: the cancel wait armed at confirm time must start
    // its backoff at the base, not at the previous wait's accumulated cap.
    const record = await recordedBooking(RECORDED_CONFIRMED_REF);
    const itemId = await recordedItem(record);
    await runner.transition(tenant, itemId, "reserved", { expectedFrom: "quoted", actor: ACTOR, reason: "r" });
    await runner.transition(tenant, itemId, "pending_confirmation", {
      expectedFrom: "reserved",
      actor: ACTOR,
      reason: "pending at book time",
      patch: { supplierReference: RECORDED_CONFIRMED_REF, pendingSince: new Date(), nextPollAt: new Date() },
    });
    // Buyer cancels while still pending; the confirmation wait has already
    // burned many attempts (arranged directly — scheduling state only).
    const requestedAt = freeWindowInstant(record.cancellationPolicy);
    const clock = new Date(requestedAt.getTime() + 60_000); // just after the request
    await runner.markCancellationRequested(tenant, itemId, ACTOR, requestedAt);
    const db = await resolver.getTenantDb(tenant);
    await db
      .update(bookingItems)
      .set({ pollAttempts: 7, nextPollAt: clock })
      .where(eq(bookingItems.id, itemId));

    // Poll 1: retrieve replays Confirmed → confirm settles, the pending
    // cancel SURVIVES as an armed wait with backoff reset.
    const pinned = pollerAt(clock);
    const first = await pinned.pollTenant(tenant);
    expect(first.outcomes.find((o) => o.bookingItemId === itemId)?.outcome).toBe(
      "transitioned_confirmed",
    );
    const [afterConfirm] = await db.select().from(bookingItems).where(eq(bookingItems.id, itemId));
    expect(afterConfirm?.state).toBe("confirmed");
    expect(afterConfirm?.cancellationRequestedAt).not.toBeNull();
    expect(afterConfirm?.pollAttempts).toBe(0); // per-WAIT reset, not per state name
    expect(afterConfirm?.nextPollAt).not.toBeNull();

    // Poll 2: the cancellation wait polls (retrieve still replays Confirmed
    // → not settled) and defers by the BASE backoff, nowhere near the cap.
    const second = await pinned.pollTenant(tenant);
    expect(second.outcomes.find((o) => o.bookingItemId === itemId)?.outcome).toBe("still_pending");
    const [afterDefer] = await db.select().from(bookingItems).where(eq(bookingItems.id, itemId));
    const deferMs = (afterDefer?.nextPollAt?.getTime() ?? 0) - clock.getTime();
    expect(deferMs).toBeGreaterThan(0);
    expect(deferMs).toBeLessThanOrEqual(60_000); // ~30s base — NOT the 600s cap
  });

  it("a not-yet-settled cancellation stays pending with exponential backoff", async () => {
    const { itemId, record } = await pendingCancelItem(RECORDED_IN_PROGRESS_REF);
    // Pin the clock just after the (recorded free-window) request instant so
    // the wait's age is fresh regardless of the wall clock.
    const requestedAt = freeWindowInstant(record.cancellationPolicy);
    const pinned = pollerAt(new Date(requestedAt.getTime() + 60_000));
    const db = await resolver.getTenantDb(tenant);

    const due = await pinned.duePendingItems(tenant);
    expect(due.map((i) => i.id)).toContain(itemId);

    const report = await pinned.pollTenant(tenant);
    const outcome = report.outcomes.find((o) => o.bookingItemId === itemId);
    // The recording replays BookingStatus=CancellationInProgress → pending.
    expect(outcome?.kind).toBe("cancellation");
    expect(outcome?.outcome).toBe("still_pending");

    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, itemId));
    expect(item?.state).toBe("confirmed"); // runner untouched — no transition happened
    expect(item?.pollAttempts).toBe(1);
    expect(item?.nextPollAt && item.nextPollAt.getTime()).toBeGreaterThan(
      requestedAt.getTime() + 60_000,
    );

    // Backed off: not due again until nextPollAt passes.
    const dueAfter = await pinned.duePendingItems(tenant);
    expect(dueAfter.map((i) => i.id)).not.toContain(itemId);
  });

  it("a settled free-window cancellation posts the pure reversal", async () => {
    // Requested inside the recorded policy's free window → penalty zero.
    const { itemId, record } = await pendingCancelItem(RECORDED_CANCELLED_REF);
    const pinned = pollerAt(
      new Date(freeWindowInstant(record.cancellationPolicy).getTime() + 60_000),
    );
    const db = await resolver.getTenantDb(tenant);
    const before = await accountBalance(db, "agency_receivable", "USD");

    const report = await pinned.pollTenant(tenant);
    const outcome = report.outcomes.find((o) => o.bookingItemId === itemId);
    // The recording replays BookingStatus=Cancelled → the poller settles the
    // wait through the runner at the penalty quoted at REQUEST time.
    expect(outcome?.kind).toBe("cancellation");
    expect(outcome?.outcome).toBe("transitioned_cancelled");

    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, itemId));
    expect(item?.state).toBe("cancelled");
    const after = await accountBalance(db, "agency_receivable", "USD");
    expect(before - after).toBe(BigInt(record.net.amount)); // full receivable reversed
    await assertLedgerBalanced(db);
  });

  it("a settlement past the recorded 100% deadline re-charges the FULL penalty", async () => {
    // Review round 2, #5: the recorded policy's real penalty schedule drives
    // the ledger — requested after the final deadline, the buyer owes the
    // whole fare: reversal + full penalty re-charge nets to zero movement.
    const probe = await recordedBooking(RECORDED_CANCELLED_REF);
    const requestedAt = fullPenaltyInstant(probe.cancellationPolicy, probe.net);
    const quoted = resolvePenaltyAt(probe.cancellationPolicy, requestedAt);
    expect(quoted).toEqual(probe.net); // the recorded schedule really says 100%

    const { itemId } = await pendingCancelItem(RECORDED_CANCELLED_REF, requestedAt);
    const pinned = pollerAt(new Date(requestedAt.getTime() + 60_000));
    const db = await resolver.getTenantDb(tenant);
    const before = await accountBalance(db, "agency_receivable", "USD");

    const report = await pinned.pollTenant(tenant);
    expect(report.outcomes.find((o) => o.bookingItemId === itemId)?.outcome).toBe(
      "transitioned_cancelled",
    );

    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, itemId));
    expect(item?.state).toBe("cancelled");
    // −fare (reversal) + fare (penalty) — the buyer still owes everything.
    const after = await accountBalance(db, "agency_receivable", "USD");
    expect(after).toBe(before);
    // And it is the 8-line cancel group (4 reversal + 4 penalty), balanced.
    const rows = await db
      .select({ n: count() })
      .from(journalEntries)
      .where(eq(journalEntries.bookingItemId, itemId));
    expect(Number(rows[0]?.n ?? 0)).toBe(12); // 4 confirm + 8 cancel
    await assertLedgerBalanced(db);
  });

  it("a wait past max age ESCALATES: polling stops, the manual queue surfaces it", async () => {
    const { itemId } = await pendingCancelItem(RECORDED_IN_PROGRESS_REF);
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
    const fusePoller = new PendingConfirmationPoller(resolver, runner, retrieveReplay, shortFuse);
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

  it("an item stranded in QUOTED past max age escalates — crash window before reserve", async () => {
    // Review round 2, #2: crash between createHotelBooking and the reserve
    // transition — offer claimed, clientReference burned, no supplier call.
    const record = await recordedBooking(RECORDED_CONFIRMED_REF);
    const itemId = await recordedItem(record); // stays quoted
    const db = await resolver.getTenantDb(tenant);
    await db
      .update(bookingItems)
      .set({ updatedAt: new Date(Date.now() - 2 * 3_600_000) })
      .where(eq(bookingItems.id, itemId));

    const shortFuse: PendingBackoffPolicy = {
      baseMs: 30_000,
      factor: 2,
      capMs: 600_000,
      maxPendingAgeMs: 3_600_000,
    };
    const fusePoller = new PendingConfirmationPoller(resolver, runner, retrieveReplay, shortFuse);
    const report = await fusePoller.pollTenant(tenant);
    const outcome = report.outcomes.find((o) => o.bookingItemId === itemId);
    expect(outcome?.kind).toBe("reservation");
    expect(outcome?.outcome).toBe("escalated");

    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, itemId));
    expect(item?.state).toBe("quoted"); // escalation never invents a state
    expect(item?.escalationReason).toMatch(/quoted/);
    expect(item?.escalationReason).toMatch(/clientReference/);
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
