import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { appInstallations, platformUsers, supplierCatalogEntries, tenants } from "../control-plane/schema";
import { connectPg } from "../internal/pg";
import { applyMigrations } from "../migrations/apply";
import { CONTROL_PLANE_MIGRATIONS_DIR } from "../migrations/dirs";
import { loadMigrationDir } from "../migrations/loader";
import { createTestPlatform, expectDbRejection, pgAvailable, type TestPlatform } from "./helpers";

const available = await pgAvailable();

describe.skipIf(!available)("control-plane schema v1", () => {
  let platform: TestPlatform;

  beforeAll(async () => {
    platform = await createTestPlatform();
  });

  afterAll(async () => {
    await platform.destroy();
  });

  it("stores a tenant with defaults (standard tier, unprovisioned)", async () => {
    const [row] = await platform.controlPlane.db
      .insert(tenants)
      .values({ slug: "t1", name: "t1", baseCurrency: "SAR" })
      .returning();
    expect(row).toBeDefined();
    expect(row?.hostingTier).toBe("standard");
    expect(row?.dbName).toBeNull();
    expect(row?.branding).toEqual({});
  });

  it("rejects a slug that cannot form a safe database identifier", async () => {
    await expectDbRejection(
      platform.controlPlane.db.insert(tenants).values({ slug: "T-1;drop", name: "x", baseCurrency: "SAR" }),
      /tenant_slug_check/,
    );
  });

  it("rejects a non-ISO base currency", async () => {
    await expectDbRejection(
      platform.controlPlane.db.insert(tenants).values({ slug: "t2", name: "t2", baseCurrency: "sr" }),
      /tenant_base_currency_check/,
    );
  });

  it("app installations are unique per tenant+app and app keys are constrained", async () => {
    const [tenant] = await platform.controlPlane.db
      .insert(tenants)
      .values({ slug: "t3", name: "t3", baseCurrency: "SAR" })
      .returning();
    if (tenant === undefined) throw new Error("insert returned no row");

    await platform.controlPlane.db.insert(appInstallations).values({ tenantId: tenant.id, appKey: "b2b" });
    await expectDbRejection(
      platform.controlPlane.db.insert(appInstallations).values({ tenantId: tenant.id, appKey: "b2b" }),
      /duplicate key/,
    );
    await expectDbRejection(
      platform.controlPlane.db
        .insert(appInstallations)
        // @ts-expect-error — unknown app keys are a type error too
        .values({ tenantId: tenant.id, appKey: "not_an_app" }),
      /app_installation_app_key_check/,
    );
  });

  it("platform user emails are unique", async () => {
    await platform.controlPlane.db.insert(platformUsers).values({ email: "u1@x", displayName: "u1", role: "admin" });
    await expectDbRejection(
      platform.controlPlane.db.insert(platformUsers).values({ email: "u1@x", displayName: "u2", role: "admin" }),
      /duplicate key/,
    );
  });

  it("supplier catalog entries default to not_started certification per environment", async () => {
    const [row] = await platform.controlPlane.db
      .insert(supplierCatalogEntries)
      .values({ supplierCode: "s1", name: "s1", vertical: "hotel" })
      .returning();
    expect(row?.certificationSandbox).toBe("not_started");
    expect(row?.certificationProduction).toBe("not_started");
    await expectDbRejection(
      platform.controlPlane.db
        .insert(supplierCatalogEntries)
        // @ts-expect-error — invalid certification status is a type error too
        .values({ supplierCode: "s2", name: "s2", vertical: "hotel", certificationSandbox: "done" }),
      /certification_sandbox_check/,
    );
  });

  it("re-applying control-plane migrations is a no-op (state is recorded)", async () => {
    const sql = connectPg(platform.controlPlaneUrl, undefined, { max: 1 });
    try {
      const files = await loadMigrationDir(CONTROL_PLANE_MIGRATIONS_DIR);
      await expect(applyMigrations(sql, files)).resolves.toEqual([]);
    } finally {
      await sql.end({ timeout: 1 });
    }
  });
});
