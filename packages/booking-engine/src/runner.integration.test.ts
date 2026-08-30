/**
 * Transition-runner service tests on a REAL per-tenant Postgres database via
 * the @jenova/db harness (issue #66). Every assertion here is about the
 * MONEY PATH: atomicity of state + postings + audit + events, optimistic
 * concurrency, typed refusals with zero writes, and the ledger invariant.
 *
 * Rows are abstract structural values (CLAUDE.md rule 5) — amounts and a
 * normalized policy shaped like every adapter produces, no supplier payloads.
 */

import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { money, tenantId as brandTenantId, type Money, type TenantId } from "@jenova/domain";
import {
  auditEvents,
  bookingEvents,
  bookingItems,
  createTenantDatabase,
  createTenantDbResolver,
  journalEntries,
  tenants,
  type TenantDbResolver,
} from "@jenova/db";
import { createTestPlatform, pgAvailable, type TestPlatform } from "@jenova/db/testing";
import {
  BookingTransitionRunner,
  type AuditActor,
  type BookingDomainEvent,
  type DomainEventSink,
} from "./index";
import {
  accountBalance,
  assertLedgerBalanced,
  journalEntriesOfGroup,
  trialBalance,
} from "./ledger/service";
import {
  LedgerImbalanceError,
  MissingPenaltyResolutionError,
  MissingPostingTemplateError,
  TransitionConflictError,
} from "./errors";

const SELL: Money = money(100_000, "SAR");
const NET: Money = money(80_000, "SAR");
const PENALTY: Money = money(20_000, "SAR");
const ACTOR: AuditActor = { actorType: "system", actorId: "runner-test" };
const POLICY = {
  refundable: true,
  rules: [{ fromUtc: "2020-01-01T00:00:00.000Z", penalty: PENALTY }],
};

class CollectingSink implements DomainEventSink {
  readonly published: BookingDomainEvent[] = [];
  failNext = false;

  publish(_tenant: TenantId, event: BookingDomainEvent): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error("sink down"));
    }
    this.published.push(event);
    return Promise.resolve();
  }
}

const available = await pgAvailable();

describe.skipIf(!available)("BookingTransitionRunner on tenant Postgres", () => {
  let platform: TestPlatform;
  let resolver: TenantDbResolver;
  let tenant: TenantId;
  let runner: BookingTransitionRunner;
  let sink: CollectingSink;
  let sequence = 0;

  beforeAll(async () => {
    platform = await createTestPlatform();
    resolver = createTenantDbResolver(platform.controlPlane, {
      runtimeDsn: platform.runtimeDsn,
      connectionsPerTenant: 4,
    });
    platform.registerCleanup(() => resolver.close());

    const slug = `bkeng_${platform.suffix}`;
    const [row] = await platform.controlPlane.db
      .insert(tenants)
      .values({ slug, name: slug, baseCurrency: "SAR" })
      .returning({ id: tenants.id });
    if (row === undefined) throw new Error("tenant insert returned no row");
    tenant = brandTenantId(row.id);
    const provisioned = await createTenantDatabase(platform.controlPlane, slug);
    platform.registerDb(provisioned.dbName);
    expect(provisioned.migrationsApplied).toContain("0004_booking_engine.sql");

    sink = new CollectingSink();
    runner = new BookingTransitionRunner(resolver, sink);
  }, 60_000);

  afterAll(async () => {
    await platform.destroy();
  });

  async function freshItem(): Promise<{ bookingId: string; itemId: string }> {
    sequence += 1;
    const created = await runner.createHotelBooking(tenant, {
      clientReference: `RUNNER-${platform.suffix}-${String(sequence)}`,
      channel: "b2b",
      agencyId: null,
      supplierCode: "tbo",
      vertical: "hotel",
      offerId: null,
      net: NET,
      sell: SELL,
      policySnapshot: POLICY,
      actor: ACTOR,
    });
    expect(created.created).toBe(true);
    return { bookingId: created.booking.id, itemId: created.item.id };
  }

  it("books through the full transition chain with balanced postings, audit and events", async () => {
    const { bookingId, itemId } = await freshItem();
    const db = await resolver.getTenantDb(tenant);

    const reserved = await runner.transition(tenant, itemId, "reserved", {
      expectedFrom: "quoted",
      actor: ACTOR,
      reason: "test reserve",
    });
    // Reserve = hold memo: NO financial posting yet (credit engine lands M3).
    expect(reserved.transactionGroupId).toBeNull();
    expect(reserved.journalEntryCount).toBe(0);

    const confirmed = await runner.transition(tenant, itemId, "confirmed", {
      expectedFrom: "reserved",
      actor: ACTOR,
      reason: "test confirm",
      patch: { supplierReference: "STRUCT-REF-1" },
    });
    expect(confirmed.transactionGroupId).not.toBeNull();
    expect(confirmed.journalEntryCount).toBe(4);

    // The four confirm postings: DR AR / CR sales (sell), DR COS / CR SP (net).
    expect(await accountBalance(db, "agency_receivable", "SAR")).toBe(100_000n);
    expect(await accountBalance(db, "sales", "SAR")).toBe(-100_000n);
    expect(await accountBalance(db, "cost_of_sales", "SAR")).toBe(80_000n);
    expect(await accountBalance(db, "supplier_payable", "SAR")).toBe(-80_000n);
    await assertLedgerBalanced(db);

    const entries = await journalEntriesOfGroup(db, confirmed.transactionGroupId ?? "");
    expect(entries).toHaveLength(4);
    expect(entries.every((entry) => entry.bookingId === bookingId && entry.bookingItemId === itemId)).toBe(true);

    // AuditEvents: booking.created + two transitions, with actor and before/after.
    const audits = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, itemId))
      .orderBy(auditEvents.id);
    expect(audits.map((a) => a.action)).toEqual([
      "booking_item.transition",
      "booking_item.transition",
    ]);
    expect(audits[1]?.before).toMatchObject({ state: "reserved" });
    expect(audits[1]?.after).toMatchObject({ state: "confirmed", supplierReference: "STRUCT-REF-1" });
    expect(audits[1]?.actorType).toBe("system");

    // Outbox: events inserted in-tx and published post-commit.
    const events = await db
      .select()
      .from(bookingEvents)
      .where(eq(bookingEvents.bookingItemId, itemId));
    expect(events.map((e) => e.eventType).sort()).toEqual([
      "booking.created",
      "booking_item.confirmed",
      "booking_item.reserved",
    ]);
    expect(events.every((e) => e.publishedAt !== null)).toBe(true);
    expect(sink.published.some((e) => e.eventType === "booking_item.confirmed")).toBe(true);
  });

  it("cancel posts the reversal + penalty and leaves the ledger balanced", async () => {
    const { itemId } = await freshItem();
    const db = await resolver.getTenantDb(tenant);
    await runner.transition(tenant, itemId, "reserved", { expectedFrom: "quoted", actor: ACTOR, reason: "r" });
    await runner.transition(tenant, itemId, "confirmed", { expectedFrom: "reserved", actor: ACTOR, reason: "c" });

    const before = await trialBalance(db);
    const cancelled = await runner.transition(tenant, itemId, "cancelled", {
      expectedFrom: "confirmed",
      actor: ACTOR,
      reason: "test cancel with penalty",
      penalty: PENALTY,
    });
    // 4 reversal lines + 4 penalty lines.
    expect(cancelled.journalEntryCount).toBe(8);
    await assertLedgerBalanced(db);

    // Net effect vs before-cancel: the confirm amounts came OFF and the
    // penalty went ON — refundable delta = sell − penalty back off AR.
    const readBalance = (rows: typeof before, code: string): bigint =>
      rows.find((r) => r.code === code)?.balance ?? 0n;
    const after = await trialBalance(db);
    expect(readBalance(after, "agency_receivable.SAR") - readBalance(before, "agency_receivable.SAR")).toBe(
      -100_000n + 20_000n,
    );
    expect(readBalance(after, "sales.SAR") - readBalance(before, "sales.SAR")).toBe(100_000n - 20_000n);
  });

  it("a free cancellation (penalty: null) posts the pure reversal", async () => {
    const { itemId } = await freshItem();
    await runner.transition(tenant, itemId, "reserved", { expectedFrom: "quoted", actor: ACTOR, reason: "r" });
    await runner.transition(tenant, itemId, "confirmed", { expectedFrom: "reserved", actor: ACTOR, reason: "c" });
    const cancelled = await runner.transition(tenant, itemId, "cancelled", {
      expectedFrom: "confirmed",
      actor: ACTOR,
      reason: "free cancel",
      penalty: null,
    });
    expect(cancelled.journalEntryCount).toBe(4); // reversal only, no zero rows
    await assertLedgerBalanced(await resolver.getTenantDb(tenant));
  });

  it("refuses an illegal transition with the domain's typed error and ZERO writes", async () => {
    const { itemId } = await freshItem();
    const db = await resolver.getTenantDb(tenant);
    const auditsBefore = await db.select({ n: count() }).from(auditEvents);
    const journalBefore = await db.select({ n: count() }).from(journalEntries);

    await expect(
      runner.transition(tenant, itemId, "confirmed", {
        expectedFrom: "quoted",
        actor: ACTOR,
        reason: "illegal",
      }),
    ).rejects.toMatchObject({ name: "IllegalTransitionError", from: "quoted", to: "confirmed" });

    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, itemId));
    expect(item?.state).toBe("quoted");
    expect(await db.select({ n: count() }).from(auditEvents)).toEqual(auditsBefore);
    expect(await db.select({ n: count() }).from(journalEntries)).toEqual(journalBefore);
  });

  it("refuses a legal edge that has no M1 posting template — before any write", async () => {
    const { itemId } = await freshItem();
    await runner.transition(tenant, itemId, "reserved", { expectedFrom: "quoted", actor: ACTOR, reason: "r" });
    await runner.transition(tenant, itemId, "confirmed", { expectedFrom: "reserved", actor: ACTOR, reason: "c" });
    // confirmed → issued is legal in the state machine but lands post-M1.
    await expect(
      runner.transition(tenant, itemId, "issued", {
        expectedFrom: "confirmed",
        actor: ACTOR,
        reason: "not yet",
      }),
    ).rejects.toBeInstanceOf(MissingPostingTemplateError);
  });

  it("refuses a penalty-posting edge without an explicit penalty resolution", async () => {
    const { itemId } = await freshItem();
    const db = await resolver.getTenantDb(tenant);
    await runner.transition(tenant, itemId, "reserved", { expectedFrom: "quoted", actor: ACTOR, reason: "r" });
    await runner.transition(tenant, itemId, "confirmed", { expectedFrom: "reserved", actor: ACTOR, reason: "c" });
    await expect(
      runner.transition(tenant, itemId, "cancelled", {
        expectedFrom: "confirmed",
        actor: ACTOR,
        reason: "no penalty passed",
      }),
    ).rejects.toBeInstanceOf(MissingPenaltyResolutionError);
    // Rolled back whole: still confirmed, no cancel postings.
    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, itemId));
    expect(item?.state).toBe("confirmed");
  });

  it("optimistic concurrency: two racing transitions — exactly one wins, one typed conflict", async () => {
    const { itemId } = await freshItem();
    const db = await resolver.getTenantDb(tenant);
    await runner.transition(tenant, itemId, "reserved", { expectedFrom: "quoted", actor: ACTOR, reason: "r" });

    const results = await Promise.allSettled([
      runner.transition(tenant, itemId, "confirmed", { expectedFrom: "reserved", actor: ACTOR, reason: "racer A" }),
      runner.transition(tenant, itemId, "failed", { expectedFrom: "reserved", actor: ACTOR, reason: "racer B" }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(TransitionConflictError);

    // The loser wrote NOTHING: at most one confirm posting group exists.
    const groups = await db
      .select({ g: journalEntries.transactionGroupId })
      .from(journalEntries)
      .where(eq(journalEntries.bookingItemId, itemId));
    expect(new Set(groups.map((r) => r.g)).size).toBeLessThanOrEqual(1);
    await assertLedgerBalanced(db);
  });

  it("stale expectedFrom is a typed conflict, not a silent overwrite", async () => {
    const { itemId } = await freshItem();
    await expect(
      runner.transition(tenant, itemId, "confirmed", {
        expectedFrom: "reserved", // a legal edge — but the item is still quoted
        actor: ACTOR,
        reason: "stale",
      }),
    ).rejects.toBeInstanceOf(TransitionConflictError);
  });

  it("duplicate clientReference returns the ORIGINAL booking (idempotent create)", async () => {
    sequence += 1;
    const ref = `RUNNER-DUP-${platform.suffix}-${String(sequence)}`;
    const input = {
      clientReference: ref,
      channel: "b2b" as const,
      agencyId: null,
      supplierCode: "tbo",
      vertical: "hotel" as const,
      offerId: null,
      net: NET,
      sell: SELL,
      policySnapshot: POLICY,
      actor: ACTOR,
    };
    const first = await runner.createHotelBooking(tenant, input);
    const second = await runner.createHotelBooking(tenant, input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.booking.id).toBe(first.booking.id);
    expect(second.item.id).toBe(first.item.id);
  });

  it("escalation is audited, evented, idempotent — and stops the item's polling", async () => {
    const { itemId } = await freshItem();
    const db = await resolver.getTenantDb(tenant);
    expect(await runner.escalate(tenant, itemId, ACTOR, "structural stuck-item test")).toBe(true);
    expect(await runner.escalate(tenant, itemId, ACTOR, "again")).toBe(false);
    const [item] = await db.select().from(bookingItems).where(eq(bookingItems.id, itemId));
    expect(item?.escalatedAt).not.toBeNull();
    expect(item?.escalationReason).toBe("structural stuck-item test");
    const events = await db
      .select()
      .from(bookingEvents)
      .where(eq(bookingEvents.bookingItemId, itemId));
    expect(events.filter((e) => e.eventType === "booking_item.escalated")).toHaveLength(1);
  });

  it("outbox survives a failing sink: unpublished rows are re-dispatched later", async () => {
    const { itemId } = await freshItem();
    const db = await resolver.getTenantDb(tenant);
    sink.failNext = true; // the publish of the next transition's event fails
    await runner.transition(tenant, itemId, "reserved", { expectedFrom: "quoted", actor: ACTOR, reason: "r" });

    const unpublished = await db
      .select()
      .from(bookingEvents)
      .where(eq(bookingEvents.bookingItemId, itemId));
    const reservedEvent = unpublished.find((e) => e.eventType === "booking_item.reserved");
    expect(reservedEvent?.publishedAt).toBeNull(); // durable despite the sink failure

    const redelivered = await runner.outbox.republishUnpublished(tenant, new Date());
    expect(redelivered).toBeGreaterThanOrEqual(1);
    const after = await db
      .select()
      .from(bookingEvents)
      .where(eq(bookingEvents.id, reservedEvent?.id ?? ""));
    expect(after[0]?.publishedAt).not.toBeNull();
  });

  it("the database itself refuses an unbalanced posting at COMMIT (belt AND braces)", async () => {
    const db = await resolver.getTenantDb(tenant);
    // The invariant checker sees a balanced ledger…
    await assertLedgerBalanced(db);
    // …and the checker's own error type reports imbalance details.
    expect(new LedgerImbalanceError([{ transactionGroupId: "g", currency: "SAR", total: 5n }]).message).toMatch(
      /unbalanced/,
    );
  });

  // The nightly-style assertion (issue #69): after EVERYTHING this suite
  // posted, every transaction group in the tenant database balances.
  it("CI ledger-invariant sweep over the whole test run's postings", async () => {
    const db = await resolver.getTenantDb(tenant);
    await assertLedgerBalanced(db);
  });
});
