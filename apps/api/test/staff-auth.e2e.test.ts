/**
 * Tenant-staff auth endpoints through the REAL gateway chain (M2 #89):
 * tenant resolution → realm auth → controller → StaffAuthService on the M0
 * primitives (argon2id, TOTP + replay lockout, opaque realm-bound
 * sessions). The staff store is the in-memory port implementation — the
 * Drizzle store is proven against real tenant Postgres by the tenant-schema
 * integration suite; nothing here fabricates supplier data.
 */

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { tenantId, type TenantId } from "@jenova/domain";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.factory";
import { ENTITLEMENT_READER } from "../src/auth/me.controller";
import { hashPassword } from "../src/auth/password";
import { SESSION_SERVICE, type SessionService } from "../src/auth/session-service";
import { InMemoryStaffUserStore, STAFF_USER_STORE } from "../src/auth/staff-users";
import { totpCodeAt } from "../src/auth/totp";
import { API_CONFIG, type ApiConfig } from "../src/config/config";
import { TENANT_DIRECTORY, type TenantDirectory } from "../src/gateway/tenant-directory";

const testConfig: ApiConfig = Object.freeze({
  nodeEnv: "test",
  port: 0,
  controlPlaneDatabaseUrl: "postgres://jenova:jenova@localhost:5432/jenova_control_plane",
  redisUrl: "redis://localhost:6379",
  tenantRuntimeDsn: "postgres://jenova_app:jenova_app@localhost:5432/postgres",
  offerSigningKey: "dev-only-offer-signing-key-change-me-0000",
  hotelSearchBudgetMs: 8_000,
  dataKey: Buffer.alloc(32, 7).toString("base64"),
  dataKeyId: "test-v1",
});

const KNOWN_HOST = "tenant-one.example.test";
const KNOWN_TENANT: TenantId = tenantId("tenant-one");

const testDirectory: TenantDirectory = {
  resolveByHost: (host) =>
    Promise.resolve(
      host === KNOWN_HOST ? { tenantId: KNOWN_TENANT, dbName: "tenant_one_db" } : null,
    ),
};

const PASSWORD = "correct-horse-battery-staple";

describe("tenant-staff auth e2e", () => {
  let app: INestApplication;
  let store: InMemoryStaffUserStore;
  let adminEmail: string;

  beforeAll(async () => {
    store = new InMemoryStaffUserStore();
    adminEmail = "amal@tenant-one.example";
    await store.create(KNOWN_TENANT, {
      email: adminEmail,
      displayName: "Amal",
      role: "admin",
      passwordHash: await hashPassword(PASSWORD),
    });

    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_CONFIG)
      .useValue(testConfig)
      .overrideProvider(TENANT_DIRECTORY)
      .useValue(testDirectory)
      .overrideProvider(STAFF_USER_STORE)
      .useValue(store)
      .overrideProvider(ENTITLEMENT_READER)
      .useValue({
        installedApps: () => Promise.resolve(["b2b", "finance"]),
        isInstalled: () => Promise.resolve(true),
      })
      .compile();
    app = testingModule.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function login(body: Record<string, unknown>): request.Test {
    return request(app.getHttpServer())
      .post("/staff/auth/login")
      .set("Host", KNOWN_HOST)
      .send(body);
  }

  it("logs a staff user in and issues a tenant_staff realm-tagged session", async () => {
    const res = await login({ email: adminEmail, password: PASSWORD }).expect(200);
    const body = res.body as {
      token: string;
      expiresAt: string;
      user: { email: string; role: string; totpEnrolled: boolean };
      totpEnrollmentRequired: boolean;
    };
    expect(body.token.startsWith("tenant_staff.")).toBe(true);
    expect(body.user.email).toBe(adminEmail);
    expect(body.user.totpEnrolled).toBe(false);
    expect(body.totpEnrollmentRequired).toBe(false);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const me = await request(app.getHttpServer())
      .get("/staff/auth/me")
      .set("Host", KNOWN_HOST)
      .set("Authorization", `Bearer ${body.token}`)
      .expect(200);
    expect((me.body as { user: { email: string } }).user.email).toBe(adminEmail);
  });

  it("refuses wrong password and unknown email with the SAME generic 401", async () => {
    const wrong = await login({ email: adminEmail, password: "nope" }).expect(401);
    const unknown = await login({ email: "ghost@tenant-one.example", password: "nope" }).expect(401);
    expect((wrong.body as { error: { code: string } }).error.code).toBe("unauthorized");
    expect((unknown.body as { error: { code: string } }).error.code).toBe("unauthorized");
  });

  it("refuses a disabled account with the generic 401", async () => {
    const user = await store.create(KNOWN_TENANT, {
      email: "disabled@tenant-one.example",
      displayName: "Disabled",
      role: "viewer",
      passwordHash: await hashPassword(PASSWORD),
    });
    await store.setStatus(KNOWN_TENANT, user.id, "disabled");
    const res = await login({ email: user.email, password: PASSWORD }).expect(401);
    expect((res.body as { error: { code: string } }).error.code).toBe("unauthorized");
  });

  it("logout revokes exactly the presented session", async () => {
    const res = await login({ email: adminEmail, password: PASSWORD }).expect(200);
    const token = (res.body as { token: string }).token;
    await request(app.getHttpServer())
      .post("/staff/auth/logout")
      .set("Host", KNOWN_HOST)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
    await request(app.getHttpServer())
      .get("/staff/auth/me")
      .set("Host", KNOWN_HOST)
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });

  it("refuses cross-realm sessions on staff routes (realm-bound tokens)", async () => {
    const sessions = app.get<SessionService>(SESSION_SERVICE);
    const agency = await sessions.issue({
      realm: "agency",
      userId: "agent-1",
      tenantId: KNOWN_TENANT,
      subTenantId: null,
    });
    await request(app.getHttpServer())
      .get("/staff/auth/me")
      .set("Host", KNOWN_HOST)
      .set("Authorization", `Bearer ${agency.token}`)
      .expect(401);
  });

  it("enrolls TOTP, then demands and verifies the second factor at login", async () => {
    const user = await store.create(KNOWN_TENANT, {
      email: "totp@tenant-one.example",
      displayName: "Totp",
      role: "operations",
      passwordHash: await hashPassword(PASSWORD),
    });
    const first = await login({ email: user.email, password: PASSWORD }).expect(200);
    const token = (first.body as { token: string }).token;

    const enroll = await request(app.getHttpServer())
      .post("/staff/auth/totp/enroll")
      .set("Host", KNOWN_HOST)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    const { secret, otpauthUri } = enroll.body as { secret: string; otpauthUri: string };
    expect(otpauthUri.startsWith("otpauth://totp/")).toBe(true);

    // A wrong code never activates.
    await request(app.getHttpServer())
      .post("/staff/auth/totp/activate")
      .set("Host", KNOWN_HOST)
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "000000" })
      .expect(400);

    const activationCode = totpCodeAt(secret, Date.now());
    await request(app.getHttpServer())
      .post("/staff/auth/totp/activate")
      .set("Host", KNOWN_HOST)
      .set("Authorization", `Bearer ${token}`)
      .send({ code: activationCode })
      .expect(200);

    // Enrolled now: password alone is no longer enough…
    const missing = await login({ email: user.email, password: PASSWORD }).expect(401);
    expect((missing.body as { error: { code: string } }).error.code).toBe("totp_required");

    // …the activation code replayed at login is refused (step burned)…
    const replayed = await login({
      email: user.email,
      password: PASSWORD,
      totpCode: activationCode,
    }).expect(401);
    expect((replayed.body as { error: { code: string } }).error.code).toBe("totp_invalid");

    // …and the NEXT step's code (within RFC drift) logs in.
    const next = await login({
      email: user.email,
      password: PASSWORD,
      totpCode: totpCodeAt(secret, Date.now() + 30_000),
    }).expect(200);
    expect((next.body as { user: { totpEnrolled: boolean } }).user.totpEnrolled).toBe(true);
  });

  it("flags enrollment as required when tenant policy enforces TOTP", async () => {
    await store.setPolicy(KNOWN_TENANT, { enforceTotp: true });
    try {
      const res = await login({ email: adminEmail, password: PASSWORD }).expect(200);
      expect((res.body as { totpEnrollmentRequired: boolean }).totpEnrollmentRequired).toBe(true);
    } finally {
      await store.setPolicy(KNOWN_TENANT, { enforceTotp: false });
    }
  });

  it("serves the tenant's installed apps to staff sessions only", async () => {
    const res = await login({ email: adminEmail, password: PASSWORD }).expect(200);
    const token = (res.body as { token: string }).token;
    const entitlements = await request(app.getHttpServer())
      .get("/me/entitlements")
      .set("Host", KNOWN_HOST)
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(entitlements.body).toEqual({ installed: ["b2b", "finance"] });

    await request(app.getHttpServer())
      .get("/me/entitlements")
      .set("Host", KNOWN_HOST)
      .expect(401);
  });

  it("refuses login on an unknown host (tenant resolution first)", async () => {
    await request(app.getHttpServer())
      .post("/staff/auth/login")
      .set("Host", "nobody.example.test")
      .send({ email: adminEmail, password: PASSWORD })
      .expect(404);
  });
});
