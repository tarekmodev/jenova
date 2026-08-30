import { randomUUID } from "node:crypto";
import { tenantId, type TenantId } from "@jenova/domain";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tenants } from "../control-plane/schema";
import {
  InvalidTenantSlugError,
  TenantAlreadyProvisionedError,
  TenantNotFoundError,
  TenantNotProvisionedError,
} from "../errors";
import { createTenantDatabase } from "../provisioning";
import { createTenantDbResolver, type TenantDbResolver } from "../resolver";
import { ledgerAccounts } from "../tenant/schema";
import { createTestPlatform, pgAvailable, type TestPlatform } from "./helpers";

const available = await pgAvailable();

describe.skipIf(!available)("provisioning + tenant resolver", () => {
  let platform: TestPlatform;
  let resolver: TenantDbResolver;

  async function newTenant(slugPrefix: string): Promise<{ id: TenantId; slug: string }> {
    const slug = `${slugPrefix}_${platform.suffix}`;
    const [row] = await platform.controlPlane.db
      .insert(tenants)
      .values({ slug, name: slug, baseCurrency: "SAR" })
      .returning({ id: tenants.id });
    if (row === undefined) throw new Error("insert returned no row");
    return { id: row.id, slug };
  }

  beforeAll(async () => {
    platform = await createTestPlatform();
    resolver = createTenantDbResolver(platform.controlPlane, {
      runtimeDsn: platform.runtimeDsn,
      connectionsPerTenant: 2,
    });
    platform.registerCleanup(() => resolver.close());
  });

  afterAll(async () => {
    await platform.destroy();
  });

  it("provisions a working tenant database that the resolver reaches", async () => {
    const tenant = await newTenant("ta");
    const result = await createTenantDatabase(platform.controlPlane, tenant.slug);
    platform.registerDb(result.dbName);

    expect(result.tenantId).toBe(tenant.id);
    expect(result.dbName).toBe(`jenova_t_${tenant.slug}`);
    expect(result.migrationsApplied).toContain("0001_tenant_v1.sql");

    const db = await resolver.getTenantDb(tenant.id);
    await db.insert(ledgerAccounts).values({ code: "1000", name: "a1", type: "asset", currency: "SAR" });
    const rows = await db.select().from(ledgerAccounts);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("1000");
  });

  it("cross-tenant isolation: tenant B's client never sees tenant A's rows", async () => {
    const a = await newTenant("tb_a");
    const b = await newTenant("tb_b");
    platform.registerDb((await createTenantDatabase(platform.controlPlane, a.slug)).dbName);
    platform.registerDb((await createTenantDatabase(platform.controlPlane, b.slug)).dbName);

    const dbA = await resolver.getTenantDb(a.id);
    const dbB = await resolver.getTenantDb(b.id);
    await dbA.insert(ledgerAccounts).values({ code: "2000", name: "a1", type: "liability", currency: "SAR" });

    expect(await dbA.select().from(ledgerAccounts)).toHaveLength(1);
    expect(await dbB.select().from(ledgerAccounts)).toHaveLength(0);
  });

  it("refuses to start without a runtime DSN — owner credentials are never a fallback", () => {
    const saved = process.env.JENOVA_TENANT_RUNTIME_DSN;
    delete process.env.JENOVA_TENANT_RUNTIME_DSN;
    try {
      expect(() => createTenantDbResolver(platform.controlPlane)).toThrow(/runtime DSN required/);
    } finally {
      if (saved !== undefined) process.env.JENOVA_TENANT_RUNTIME_DSN = saved;
    }
  });

  it("type-level: only branded TenantIds enter the resolver", () => {
    const neverRun = (): unknown =>
      // @ts-expect-error — a raw string is not a TenantId; the brand is the door key
      resolver.getTenantDb(randomUUID());
    expect(typeof neverRun).toBe("function");
  });

  it("returns the same pooled client for the same tenant (lazy, cached)", async () => {
    const tenant = await newTenant("tc");
    platform.registerDb((await createTenantDatabase(platform.controlPlane, tenant.slug)).dbName);
    const [db1, db2] = await Promise.all([resolver.getTenantDb(tenant.id), resolver.getTenantDb(tenant.id)]);
    expect(db1).toBe(db2);
  });

  it("refuses unknown tenants", async () => {
    await expect(resolver.getTenantDb(tenantId(randomUUID()))).rejects.toThrow(TenantNotFoundError);
  });

  it("refuses tenants that exist but are not provisioned", async () => {
    const tenant = await newTenant("td");
    await expect(resolver.getTenantDb(tenant.id)).rejects.toThrow(TenantNotProvisionedError);
  });

  it("refuses provisioning an unknown slug", async () => {
    await expect(createTenantDatabase(platform.controlPlane, `ghost_${platform.suffix}`)).rejects.toThrow(
      TenantNotFoundError,
    );
  });

  it("refuses double provisioning", async () => {
    const tenant = await newTenant("te");
    platform.registerDb((await createTenantDatabase(platform.controlPlane, tenant.slug)).dbName);
    await expect(createTenantDatabase(platform.controlPlane, tenant.slug)).rejects.toThrow(
      TenantAlreadyProvisionedError,
    );
  });

  it("refuses slugs that cannot form a safe database identifier", async () => {
    await expect(createTenantDatabase(platform.controlPlane, "Tenant-1")).rejects.toThrow(InvalidTenantSlugError);
    await expect(createTenantDatabase(platform.controlPlane, 'x"; drop database jenova')).rejects.toThrow(
      InvalidTenantSlugError,
    );
  });
});
