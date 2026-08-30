/**
 * Fan-out runner proofs: dry-run is read-only, a failing tenant is isolated
 * (N failing never stops N+1), and a re-run resumes from recorded state.
 * The "second wave" migration used here is pure schema (a probe table) —
 * no fabricated business data.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Sql } from "postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tenants } from "../control-plane/schema";
import { MigrationChecksumError } from "../errors";
import { runFanout } from "../fanout";
import { connectPg } from "../internal/pg";
import { applyMigrations } from "../migrations/apply";
import { TENANT_MIGRATIONS_DIR } from "../migrations/dirs";
import { loadMigrationDir } from "../migrations/loader";
import { createTenantDatabase } from "../provisioning";
import { createTestPlatform, pgAvailable, type TestPlatform } from "./helpers";

const available = await pgAvailable();

describe.skipIf(!available)("fan-out migration runner", () => {
  let platform: TestPlatform;
  let migrationsDir: string;
  let probeName: string;
  const slugs: string[] = [];
  const dbNames: string[] = [];

  beforeAll(async () => {
    platform = await createTestPlatform();

    // A copy of the packaged tenant migrations we can extend with a second wave.
    migrationsDir = await mkdtemp(path.join(tmpdir(), "jenova-db-fanout-"));
    const packaged = await loadMigrationDir(TENANT_MIGRATIONS_DIR);
    for (const file of packaged) {
      await writeFile(path.join(migrationsDir, file.name), file.sql);
    }
    // The probe takes the next free number, so newly packaged tenant
    // migrations never collide with it.
    const highest = Math.max(...packaged.map((file) => Number(file.name.slice(0, 4))));
    probeName = `${String(highest + 1).padStart(4, "0")}_fanout_probe.sql`;

    for (const prefix of ["fa", "fb", "fc"]) {
      const slug = `${prefix}_${platform.suffix}`;
      await platform.controlPlane.db.insert(tenants).values({ slug, name: slug, baseCurrency: "SAR" });
      const result = await createTenantDatabase(platform.controlPlane, slug, { migrationsDir });
      platform.registerDb(result.dbName);
      slugs.push(slug);
      dbNames.push(result.dbName);
    }
  });

  afterAll(async () => {
    await platform.destroy();
    await rm(migrationsDir, { recursive: true, force: true });
  });

  function connectTenant(dbName: string): Sql {
    const url = new URL(platform.controlPlaneUrl);
    url.pathname = `/${dbName}`;
    return connectPg(url.toString(), undefined, { max: 1 });
  }

  it("isolates a failing tenant, reports per-tenant status, and resumes on re-run", async () => {
    // Second wave: pure schema, applies everywhere.
    await writeFile(path.join(migrationsDir, probeName), "create table fanout_probe (id int primary key);\n");

    // Sabotage tenant fb only: a conflicting object makes 0002 fail there.
    const brokenDb = dbNames[1];
    if (brokenDb === undefined) throw new Error("setup did not provision 3 tenants");
    const broken = connectTenant(brokenDb);
    await broken.unsafe("create table fanout_probe (clash text)");

    // Dry-run: everyone reports 0002 pending, nothing is written.
    const dry = await runFanout(platform.controlPlane, { mode: "dry-run", tenantMigrationsDir: migrationsDir });
    expect(dry.ok).toBe(true);
    expect(dry.controlPlane.pending).toEqual([]);
    expect(dry.tenants).toHaveLength(3);
    for (const tenant of dry.tenants) {
      expect(tenant.pending).toEqual([probeName]);
      expect(tenant.applied).toEqual([]);
    }

    // Apply: fa and fc succeed although fb (between them) fails.
    const apply = await runFanout(platform.controlPlane, { mode: "apply", tenantMigrationsDir: migrationsDir });
    expect(apply.ok).toBe(false);
    const bySlug = new Map(apply.tenants.map((t) => [t.slug, t]));
    expect(bySlug.get(slugs[0] ?? "")?.status).toBe("ok");
    expect(bySlug.get(slugs[0] ?? "")?.applied).toEqual([probeName]);
    expect(bySlug.get(slugs[2] ?? "")?.status).toBe("ok");
    const failed = bySlug.get(slugs[1] ?? "");
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toMatch(/fanout_probe/);
    expect(failed?.pending).toEqual([probeName]);

    // Fix fb and re-run: only fb has work left; the others are recorded as done.
    await broken.unsafe("drop table fanout_probe");
    await broken.end({ timeout: 1 });
    const resume = await runFanout(platform.controlPlane, { mode: "apply", tenantMigrationsDir: migrationsDir });
    expect(resume.ok).toBe(true);
    const resumed = new Map(resume.tenants.map((t) => [t.slug, t]));
    expect(resumed.get(slugs[1] ?? "")?.applied).toEqual([probeName]);
    expect(resumed.get(slugs[0] ?? "")?.applied).toEqual([]);
    expect(resumed.get(slugs[2] ?? "")?.applied).toEqual([]);

    // The probe table exists in every tenant database now.
    for (const dbName of dbNames) {
      const sql = connectTenant(dbName);
      const rows = await sql`select to_regclass('public.fanout_probe') as t`;
      expect(rows[0]?.t).toBe("fanout_probe");
      await sql.end({ timeout: 1 });
    }
  });

  it("unprovisioned tenants are reported, not failed", async () => {
    const slug = `fu_${platform.suffix}`;
    await platform.controlPlane.db.insert(tenants).values({ slug, name: slug, baseCurrency: "SAR" });
    const report = await runFanout(platform.controlPlane, { mode: "dry-run", tenantMigrationsDir: migrationsDir });
    expect(report.ok).toBe(true);
    const row = report.tenants.find((t) => t.slug === slug);
    expect(row?.dbName).toBeNull();
    expect(row?.status).toBe("ok");
  });

  it("refuses edited (checksum-changed) applied migrations", async () => {
    const dbName = dbNames[0];
    if (dbName === undefined) throw new Error("setup did not provision tenants");
    await writeFile(path.join(migrationsDir, probeName), "-- edited after apply\nselect 1;\n");
    const sql = connectTenant(dbName);
    try {
      await expect(applyMigrations(sql, await loadMigrationDir(migrationsDir))).rejects.toThrow(
        MigrationChecksumError,
      );
    } finally {
      await sql.end({ timeout: 1 });
      // restore so later fan-outs in this file (if any) see consistent content
      await writeFile(path.join(migrationsDir, probeName), "create table fanout_probe (id int primary key);\n");
    }
  });
});
