/**
 * Settings v1 end to end on REAL infrastructure (issue #91): a throwaway
 * control plane + provisioned tenant database (@jenova/db/testing), the
 * real gateway chain resolving the tenant from a control-plane tenant_host
 * row, Drizzle-backed staff users / supplier accounts / branding, sealed
 * credentials, and test-connection through the REAL TBO adapter in replay
 * mode against the committed CountryList recording (CLAUDE.md rule 5 —
 * recorded live-sandbox traffic, nothing fabricated).
 */

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { TenantId } from "@jenova/domain";
import {
  createTenantDatabase,
  createTenantDbResolver,
  supplierAccounts,
  supplierCatalogEntries,
  tenantHosts,
  tenants,
  type TenantDbResolver,
} from "@jenova/db";
import { createTestPlatform, pgAvailable, type TestPlatform } from "@jenova/db/testing";
import { InMemoryObjectStore } from "@jenova/connectors";
import { createSupplierRegistry, SUPPLIER_REGISTRY } from "@jenova/supplier-registry";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/app.factory";
import { hashPassword } from "../src/auth/password";
import { DrizzleStaffUserStore } from "../src/auth/staff-users";
import { API_CONFIG, type ApiConfig } from "../src/config/config";
import { OBJECT_STORE } from "../src/staff/branding.controller";

const HOST = "settings-e2e.jenova.test";
const PASSWORD = "first-admin-password-1";
/** The committed CountryList recording's base URL — fingerprints must line up. */
const RECORDED_TBO_URL = "https://api.tbotechnology.in/TBOHolidays_HotelAPI";

const available = await pgAvailable();

describe.skipIf(!available)("staff settings integration (real db + replay)", () => {
  let app: INestApplication;
  let platform: TestPlatform;
  let resolver: TenantDbResolver;
  let tenant: TenantId;
  let adminToken: string;
  const objectStore = new InMemoryObjectStore();

  beforeAll(async () => {
    platform = await createTestPlatform();
    const slug = `settings_${platform.suffix}`;
    const inserted = await platform.controlPlane.db
      .insert(tenants)
      .values({ slug, name: "Settings Tenant", baseCurrency: "SAR" })
      .returning({ id: tenants.id });
    const row = inserted[0];
    if (row === undefined) throw new Error("tenant insert returned no row");
    tenant = row.id;
    await platform.controlPlane.db.insert(tenantHosts).values({ host: HOST, tenantId: tenant });
    await platform.controlPlane.db.insert(supplierCatalogEntries).values({
      supplierCode: "tbo",
      name: "TBO Holidays",
      vertical: "hotel",
      certificationSandbox: "certified",
    });
    const provisioned = await createTenantDatabase(platform.controlPlane, slug);
    platform.registerDb(provisioned.dbName);

    resolver = createTenantDbResolver(platform.controlPlane, {
      runtimeDsn: platform.runtimeDsn,
      connectionsPerTenant: 2,
    });
    platform.registerCleanup(() => resolver.close());
    const store = new DrizzleStaffUserStore(resolver);
    await store.create(tenant, {
      email: "admin@settings.test",
      displayName: "Admin",
      role: "admin",
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
      dataKey: Buffer.alloc(32, 5).toString("base64"),
      dataKeyId: "test-v1",
    });
    const testingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(API_CONFIG)
      .useValue(config)
      .overrideProvider(SUPPLIER_REGISTRY)
      .useValue(createSupplierRegistry({ mode: "replay" }))
      .overrideProvider(OBJECT_STORE)
      .useValue(objectStore)
      .compile();
    app = testingModule.createNestApplication();
    configureApp(app);
    await app.init();

    const login = await request(app.getHttpServer())
      .post("/staff/auth/login")
      .set("Host", HOST)
      .send({ email: "admin@settings.test", password: PASSWORD })
      .expect(200);
    adminToken = (login.body as { token: string }).token;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await platform?.destroy();
  });

  function authed(method: "get" | "post" | "put" | "patch", path: string): request.Test {
    const server = request(app.getHttpServer());
    return server[method](path).set("Host", HOST).set("Authorization", `Bearer ${adminToken}`);
  }

  it("resolves the tenant from the control-plane tenant_host row", async () => {
    const me = await authed("get", "/staff/auth/me").expect(200);
    expect((me.body as { user: { email: string } }).user.email).toBe("admin@settings.test");
  });

  describe("users & roles", () => {
    let invitedId: string;
    let initialPassword: string;

    it("invites a user, returning the initial password exactly once", async () => {
      const res = await authed("post", "/staff/users")
        .send({ email: "ops@settings.test", displayName: "Ops", role: "operations" })
        .expect(201);
      const body = res.body as { user: { id: string; role: string }; initialPassword: string };
      invitedId = body.user.id;
      initialPassword = body.initialPassword;
      expect(body.user.role).toBe("operations");
      expect(initialPassword.length).toBeGreaterThanOrEqual(10);

      const list = await authed("get", "/staff/users").expect(200);
      const users = (list.body as { users: { email: string }[] }).users;
      expect(users.map((user) => user.email)).toContain("ops@settings.test");
      expect(JSON.stringify(list.body)).not.toContain("passwordHash");
    });

    it("the invitee signs in with the initial password", async () => {
      await request(app.getHttpServer())
        .post("/staff/auth/login")
        .set("Host", HOST)
        .send({ email: "ops@settings.test", password: initialPassword })
        .expect(200);
    });

    it("reassigns the role", async () => {
      const res = await authed("patch", `/staff/users/${invitedId}`)
        .send({ role: "finance" })
        .expect(200);
      expect((res.body as { user: { role: string } }).user.role).toBe("finance");
    });

    it("deactivation revokes the user's live sessions", async () => {
      const login = await request(app.getHttpServer())
        .post("/staff/auth/login")
        .set("Host", HOST)
        .send({ email: "ops@settings.test", password: initialPassword })
        .expect(200);
      const opsToken = (login.body as { token: string }).token;

      await authed("post", `/staff/users/${invitedId}/deactivate`).expect(200);
      await request(app.getHttpServer())
        .get("/staff/auth/me")
        .set("Host", HOST)
        .set("Authorization", `Bearer ${opsToken}`)
        .expect(401);
      // And the login path refuses the disabled account.
      await request(app.getHttpServer())
        .post("/staff/auth/login")
        .set("Host", HOST)
        .send({ email: "ops@settings.test", password: initialPassword })
        .expect(401);
    });

    it("refuses self-deactivation", async () => {
      const me = await authed("get", "/staff/auth/me").expect(200);
      const myId = (me.body as { user: { id: string } }).user.id;
      const res = await authed("post", `/staff/users/${myId}/deactivate`).expect(409);
      expect((res.body as { error: { code: string } }).error.code).toBe("cannot_deactivate_self");
    });

    it("round-trips the enforce-TOTP policy", async () => {
      await authed("put", "/staff/policy").send({ enforceTotp: true }).expect(200);
      const res = await authed("get", "/staff/policy").expect(200);
      expect((res.body as { policy: { enforceTotp: boolean } }).policy.enforceTotp).toBe(true);
      await authed("put", "/staff/policy").send({ enforceTotp: false }).expect(200);
    });
  });

  describe("supplier accounts", () => {
    it("lists the catalog with unconfigured environments first", async () => {
      const res = await authed("get", "/staff/supplier-accounts").expect(200);
      const suppliers = (res.body as { suppliers: Record<string, unknown>[] }).suppliers;
      expect(suppliers).toHaveLength(1);
      expect(suppliers[0]).toMatchObject({
        supplierCode: "tbo",
        testable: true,
        environments: { sandbox: { configured: false }, production: { configured: false } },
      });
    });

    it("saves credentials write-only — nothing secret ever echoes back", async () => {
      const res = await authed("put", "/staff/supplier-accounts/tbo/sandbox")
        .send({
          secrets: { apiUrl: RECORDED_TBO_URL, username: "replay", password: "replay" },
          enabled: true,
        })
        .expect(200);
      expect(res.body).toEqual({ ok: true, created: true });

      const list = await authed("get", "/staff/supplier-accounts").expect(200);
      const serialized = JSON.stringify(list.body);
      expect(serialized).not.toContain("replay");
      expect(serialized).not.toContain(RECORDED_TBO_URL);
      const suppliers = (list.body as { suppliers: Record<string, unknown>[] }).suppliers;
      expect(suppliers[0]).toMatchObject({
        environments: { sandbox: { configured: true, enabled: true } },
      });
    });

    it("stores ONLY sealed bytes in the tenant database", async () => {
      const db = await resolver.getTenantDb(tenant);
      const rows = await db.select().from(supplierAccounts);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      if (row === undefined) throw new Error("no supplier_account row");
      const asText = Buffer.from(row.secretsEncrypted).toString("utf8");
      expect(asText).not.toContain("replay");
      expect(asText).not.toContain("apiUrl");
      expect(row.secretsKeyId).toBe("test-v1");
    });

    it("test-connection proves the stored credentials through the real adapter (replay)", async () => {
      const res = await authed("post", "/staff/supplier-accounts/tbo/sandbox/test-connection")
        .expect(200);
      expect(res.body).toEqual({ ok: true });
    });

    it("refuses unknown suppliers and unconfigured accounts", async () => {
      await authed("put", "/staff/supplier-accounts/nobody/sandbox")
        .send({ secrets: { x: "y" } })
        .expect(404);
      const res = await authed(
        "post",
        "/staff/supplier-accounts/tbo/production/test-connection",
      ).expect(409);
      expect((res.body as { error: { code: string } }).error.code).toBe("account_not_configured");
    });
  });

  describe("branding", () => {
    it("defaults legal name to the tenant name", async () => {
      const res = await authed("get", "/staff/branding").expect(200);
      expect(res.body).toEqual({
        branding: { legalName: "Settings Tenant", brandColor: null, hasLogo: false },
      });
    });

    it("saves legal name + brand color", async () => {
      const res = await authed("put", "/staff/branding")
        .send({ legalName: "شركة الإعدادات للسفر", brandColor: "#0a7cff" })
        .expect(200);
      expect(res.body).toEqual({
        branding: { legalName: "شركة الإعدادات للسفر", brandColor: "#0a7cff", hasLogo: false },
      });
    });

    it("uploads and serves the logo through the object store", async () => {
      // 1x1 PNG, generated here — an asset we author, not supplier data.
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      );
      await authed("put", "/staff/branding/logo")
        .send({ contentType: "image/png", dataBase64: png.toString("base64") })
        .expect(200);

      const logo = await authed("get", "/staff/branding/logo").expect(200);
      expect(logo.headers["content-type"]).toContain("image/png");

      const res = await authed("get", "/staff/branding").expect(200);
      expect((res.body as { branding: { hasLogo: boolean } }).branding.hasLogo).toBe(true);
    });
  });
});
