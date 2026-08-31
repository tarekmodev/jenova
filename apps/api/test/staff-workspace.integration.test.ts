/**
 * Core workspace endpoints (issue #92) on REAL per-tenant Postgres with the
 * REAL TBO adapter in replay mode: bookings list/detail (audit trail +
 * ledger read), the manual-intervention queue, retry-poll settling through
 * the state-machine runner, and resolution — all through the real gateway
 * chain under a tenant_staff session.
 *
 * Booking rows are built FROM the committed recordings (net fare and
 * normalized policy come from the replayed BookingDetail through the real
 * adapter — no fabricated supplier data, CLAUDE.md rule 5). SNAO7U is the
 * recorded M1 live-proof booking whose BookingDetail replays Confirmed.
 */

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { tenantId as brandTenantId, type TenantId } from "@jenova/domain";
import {
  createTenantDatabase,
  createTenantDbResolver,
  tenantHosts,
  tenants,
  type TenantDbResolver,
} from "@jenova/db";
import { createTestPlatform, pgAvailable, type TestPlatform } from "@jenova/db/testing";
import {
  BookingTransitionRunner,
  type AuditActor,
  type RetrieveBookingFn,
} from "@jenova/booking-engine";
import type { AdapterCallContext, HotelBookingRecord } from "@jenova/supplier-sdk";
import {
  createSupplierRegistry,
  SUPPLIER_CREDENTIALS_SOURCE,
  SUPPLIER_REGISTRY,
  type SupplierCredentialsSource,
  type SupplierRegistry,
} from "@jenova/supplier-registry";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.factory";
import { hashPassword } from "../src/auth/password";
import { DrizzleStaffUserStore } from "../src/auth/staff-users";
import { API_CONFIG, type ApiConfig } from "../src/config/config";

const HOST = "workspace-e2e.jenova.test";
const PASSWORD = "workspace-admin-password-1";
/** Recorded M1 live-proof booking — BookingDetail replays Confirmed. */
const RECORDED_CONFIRMED_REF = "SNAO7U";

const SYSTEM: AuditActor = { actorType: "system", actorId: "workspace-test" };

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

function makeRetrieve(
  registry: SupplierRegistry,
  credentials: SupplierCredentialsSource,
): RetrieveBookingFn {
  return async (tenant, target) => {
    const adapter = registry.hotelAdapter(target.supplierCode);
    if (adapter === null) throw new Error("tbo adapter missing");
    const ctx: AdapterCallContext = {
      credentials: await credentials.credentialsFor(tenant, target.supplierCode),
      deadline: new Date(Date.now() + 25_000),
      nationality: "SA",
      currency: target.currency,
      locale: "en",
    };
    return adapter.retrieve(ctx, target.supplierBookingReference);
  };
}

const available = await pgAvailable();

describe.skipIf(!available)("staff workspace integration (real db + replay)", () => {
  let app: INestApplication;
  let platform: TestPlatform;
  let resolver: TenantDbResolver;
  let tenant: TenantId;
  let runner: BookingTransitionRunner;
  let record: HotelBookingRecord;
  let adminToken: string;
  let sequence = 0;
  const registry = createSupplierRegistry({ mode: "replay" });
  const credentials = new ReplayCredentialsSource();

  beforeAll(async () => {
    platform = await createTestPlatform();
    const slug = `workspace_${platform.suffix}`;
    const inserted = await platform.controlPlane.db
      .insert(tenants)
      .values({ slug, name: slug, baseCurrency: "SAR" })
      .returning({ id: tenants.id });
    const row = inserted[0];
    if (row === undefined) throw new Error("tenant insert returned no row");
    tenant = brandTenantId(row.id);
    await platform.controlPlane.db.insert(tenantHosts).values({ host: HOST, tenantId: tenant });
    const provisioned = await createTenantDatabase(platform.controlPlane, slug);
    platform.registerDb(provisioned.dbName);

    resolver = createTenantDbResolver(platform.controlPlane, {
      runtimeDsn: platform.runtimeDsn,
      connectionsPerTenant: 4,
    });
    platform.registerCleanup(() => resolver.close());
    runner = new BookingTransitionRunner(resolver);
    record = await makeRetrieve(registry, credentials)(tenant, {
      supplierCode: "tbo",
      supplierBookingReference: RECORDED_CONFIRMED_REF,
      currency: "USD",
    });

    const store = new DrizzleStaffUserStore(resolver);
    await store.create(tenant, {
      email: "ops@workspace.test",
      displayName: "Ops",
      role: "operations",
      passwordHash: await hashPassword(PASSWORD),
    });

    const config: ApiConfig = Object.freeze({
      nodeEnv: "test",
      port: 0,
      controlPlaneDatabaseUrl: platform.controlPlaneUrl,
      redisUrl: "redis://localhost:6379",
      tenantRuntimeDsn: platform.runtimeDsn,
      offerSigningKey: "dev-only-offer-signing-key-change-me-0000",
      hotelSearchBudgetMs: 8_000,
      dataKey: Buffer.alloc(32, 9).toString("base64"),
      dataKeyId: "test-v1",
    });
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_CONFIG)
      .useValue(config)
      .overrideProvider(SUPPLIER_REGISTRY)
      .useValue(registry)
      .overrideProvider(SUPPLIER_CREDENTIALS_SOURCE)
      .useValue(credentials)
      .compile();
    app = testingModule.createNestApplication();
    configureApp(app);
    await app.init();

    const login = await request(app.getHttpServer())
      .post("/staff/auth/login")
      .set("Host", HOST)
      .send({ email: "ops@workspace.test", password: PASSWORD })
      .expect(200);
    adminToken = (login.body as { token: string }).token;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await platform?.destroy();
  });

  function authed(method: "get" | "post", path: string): request.Test {
    const server = request(app.getHttpServer());
    return server[method](path).set("Host", HOST).set("Authorization", `Bearer ${adminToken}`);
  }

  /** A booking carrying the RECORDED fare/policy, driven to `finalState`. */
  async function seededItem(
    finalState: "confirmed" | "pending_confirmation",
  ): Promise<{ bookingId: string; itemId: string }> {
    sequence += 1;
    const created = await runner.createHotelBooking(tenant, {
      clientReference: `WORKSPACE-${platform.suffix}-${String(sequence)}`,
      channel: "b2b",
      agencyId: null,
      supplierCode: "tbo",
      vertical: "hotel",
      offerId: null,
      net: record.net,
      sell: record.net,
      policySnapshot: record.cancellationPolicy,
      actor: SYSTEM,
    });
    const itemId = created.item.id;
    await runner.transition(tenant, itemId, "reserved", {
      expectedFrom: "quoted",
      actor: SYSTEM,
      reason: "test seed",
    });
    if (finalState === "confirmed") {
      await runner.transition(tenant, itemId, "confirmed", {
        expectedFrom: "reserved",
        actor: SYSTEM,
        reason: "test seed",
        patch: { supplierReference: RECORDED_CONFIRMED_REF },
      });
    } else {
      await runner.transition(tenant, itemId, "pending_confirmation", {
        expectedFrom: "reserved",
        actor: SYSTEM,
        reason: "test seed",
        patch: { supplierReference: RECORDED_CONFIRMED_REF, pendingSince: new Date() },
      });
    }
    return { bookingId: created.booking.id, itemId };
  }

  let confirmedBookingId = "";

  it("lists bookings with state/supplier filters", async () => {
    const seeded = await seededItem("confirmed");
    confirmedBookingId = seeded.bookingId;

    const all = await authed("get", "/staff/bookings").expect(200);
    const rows = (all.body as { bookings: { bookingId: string; state: string }[] }).bookings;
    expect(rows.some((row) => row.bookingId === confirmedBookingId)).toBe(true);

    const confirmed = await authed("get", "/staff/bookings?state=confirmed&supplier=tbo").expect(200);
    const confirmedRows = (confirmed.body as { bookings: { bookingId: string }[] }).bookings;
    expect(confirmedRows.some((row) => row.bookingId === confirmedBookingId)).toBe(true);

    const cancelled = await authed("get", "/staff/bookings?state=cancelled").expect(200);
    expect(
      (cancelled.body as { bookings: { bookingId: string }[] }).bookings.some(
        (row) => row.bookingId === confirmedBookingId,
      ),
    ).toBe(false);
  });

  it("serves the full detail: items, audit trail, ledger read, documents slot", async () => {
    const res = await authed("get", `/staff/bookings/${confirmedBookingId}`).expect(200);
    const body = res.body as {
      booking: { bookingId: string };
      items: { state: string; supplierReference: string | null }[];
      auditTrail: { action: string; entityType: string }[];
      ledger: { accountCode: string; amount: { amount: number; currency: string } }[];
      documents: unknown[];
    };
    expect(body.booking.bookingId).toBe(confirmedBookingId);
    expect(body.items[0]?.state).toBe("confirmed");
    expect(body.items[0]?.supplierReference).toBe(RECORDED_CONFIRMED_REF);

    const actions = body.auditTrail.map((event) => event.action);
    expect(actions).toContain("booking.created");
    expect(actions).toContain("booking_item.transition");

    // Ledger panel is a LEDGER READ: the confirm edge posted balanced lines.
    expect(body.ledger.length).toBeGreaterThan(0);
    const total = body.ledger.reduce((sum, line) => sum + line.amount.amount, 0);
    expect(total).toBe(0);
    expect(body.ledger.every((line) => line.accountCode.includes("."))).toBe(true);

    expect(body.documents).toEqual([]);

    await authed("get", "/staff/bookings/00000000-0000-0000-0000-000000000000").expect(404);
  });

  it("queues escalated items with reason, age and ONLY legal actions", async () => {
    const pending = await seededItem("pending_confirmation");
    const confirmed = await seededItem("confirmed");
    await runner.escalate(tenant, pending.itemId, SYSTEM, "confirmation wait exceeded max age");
    await runner.escalate(tenant, confirmed.itemId, SYSTEM, "cancel-fee conflict needs a decision");

    const res = await authed("get", "/staff/escalations").expect(200);
    const escalations = (res.body as {
      escalations: {
        bookingItemId: string;
        reason: string;
        escalatedAt: string;
        allowedActions: string[];
      }[];
    }).escalations;

    const pendingRow = escalations.find((row) => row.bookingItemId === pending.itemId);
    const confirmedRow = escalations.find((row) => row.bookingItemId === confirmed.itemId);
    expect(pendingRow?.reason).toBe("confirmation wait exceeded max age");
    expect(pendingRow?.allowedActions).toEqual(["retry_poll", "resolve"]);
    // No cancellation requested on a confirmed item ⇒ nothing to poll.
    expect(confirmedRow?.allowedActions).toEqual(["resolve"]);
    expect(Date.parse(pendingRow?.escalatedAt ?? "")).toBeGreaterThan(0);

    // The state machine refuses a poll the state does not allow.
    await authed("post", `/staff/escalations/${confirmed.itemId}/retry-poll`).expect(409);

    // Manual retry: replayed BookingDetail says Confirmed → the runner
    // settles pending_confirmation → confirmed and auto-resolves.
    const retry = await authed(
      "post",
      `/staff/escalations/${pending.itemId}/retry-poll`,
    ).expect(200);
    expect(retry.body).toMatchObject({ outcome: "transitioned_confirmed", resolved: true });

    const detail = await authed("get", `/staff/bookings/${pending.bookingId}`).expect(200);
    const detailBody = detail.body as {
      items: { state: string; escalated: boolean }[];
      auditTrail: { action: string; actorType: string }[];
    };
    expect(detailBody.items[0]?.state).toBe("confirmed");
    expect(detailBody.items[0]?.escalated).toBe(false);
    const resolvedEvent = detailBody.auditTrail.find(
      (event) => event.action === "booking_item.escalation_resolved",
    );
    expect(resolvedEvent?.actorType).toBe("staff_user");

    // Resolve the remaining one with a note; the queue then empties.
    await authed("post", `/staff/escalations/${confirmed.itemId}/resolve`)
      .send({ note: "verified with the supplier by phone" })
      .expect(200);
    const after = await authed("get", "/staff/escalations").expect(200);
    expect((after.body as { escalations: unknown[] }).escalations).toEqual([]);

    // Resolving twice is a conflict, not a silent success.
    await authed("post", `/staff/escalations/${confirmed.itemId}/resolve`)
      .send({ note: "again" })
      .expect(404);
  });

  it("streams the staff search console through the same SSE endpoint (internal channel)", async () => {
    // Covered end-to-end in the browser e2e; here we only prove the realm
    // gate opened for tenant_staff — a malformed body still envelopes.
    const res = await authed("post", "/hotel-search").send({}).expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("bad_request");
  });
});
