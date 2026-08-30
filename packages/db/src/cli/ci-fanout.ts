/**
 * CI migration gate (issue #22): against a disposable Postgres, build a
 * FRESH control-plane plus 3 synthetic tenant databases — schema only, NO
 * fabricated business data; empty tables are the point — then prove the
 * fan-out: dry-run, apply, provision, dry-run (clean), apply (no-op).
 * Fails (non-zero exit) on any error.
 *
 *   JENOVA_CI_PG_URL=postgres://user:pass@localhost:5432/postgres \
 *     pnpm --filter @jenova/db migrate:ci
 */

import process from "node:process";
import { connectControlPlane } from "../control-plane/client";
import { tenants } from "../control-plane/schema";
import { runFanout } from "../fanout";
import { connectPg } from "../internal/pg";
import { createTenantDatabase } from "../provisioning";

const CONTROL_PLANE_DB = "jenova_ci_control_plane";
const TENANT_SLUGS = ["ci_tenant_1", "ci_tenant_2", "ci_tenant_3"];

function step(name: string): void {
  console.log(`\n== ${name}`);
}

function fail(message: string): never {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}

function assertOk(condition: boolean, message: string): void {
  if (!condition) fail(message);
}

const serverUrl = process.env.JENOVA_CI_PG_URL;
if (serverUrl === undefined || serverUrl === "") {
  fail("JENOVA_CI_PG_URL is required (any database on the CI Postgres server)");
}

step("fresh databases");
const admin = connectPg(serverUrl, undefined, { max: 1 });
for (const name of [CONTROL_PLANE_DB, ...TENANT_SLUGS.map((s) => `jenova_t_${s}`)]) {
  await admin.unsafe(`drop database if exists "${name}" with (force)`);
}
await admin.unsafe(`create database "${CONTROL_PLANE_DB}"`);
await admin.end({ timeout: 5 });

const cpUrl = new URL(serverUrl);
cpUrl.pathname = `/${CONTROL_PLANE_DB}`;
const controlPlane = connectControlPlane({ url: cpUrl.toString(), maxConnections: 2 });

try {
  step("fan-out dry-run on the fresh server (control-plane migrations pending)");
  const dryFresh = await runFanout(controlPlane, { mode: "dry-run" });
  assertOk(dryFresh.ok, "dry-run reported failures on a fresh server");
  assertOk(dryFresh.controlPlane.pending.length > 0, "expected pending control-plane migrations on a fresh server");

  step("fan-out apply (control-plane)");
  const applyCp = await runFanout(controlPlane, { mode: "apply" });
  assertOk(applyCp.ok, `apply failed: ${applyCp.controlPlane.error ?? "see report"}`);
  assertOk(applyCp.controlPlane.pending.length === 0, "control-plane still has pending migrations after apply");

  step("provision 3 synthetic tenant databases (schema only)");
  for (const slug of TENANT_SLUGS) {
    await controlPlane.db.insert(tenants).values({ slug, name: slug, baseCurrency: "SAR" });
    const result = await createTenantDatabase(controlPlane, slug);
    console.log(`  ${slug} -> ${result.dbName} (${result.migrationsApplied.length} migrations)`);
  }

  step("fan-out dry-run across control-plane + 3 tenant databases");
  const dry = await runFanout(controlPlane, { mode: "dry-run" });
  assertOk(dry.ok, "dry-run reported failures");
  assertOk(dry.tenants.length === TENANT_SLUGS.length, `expected ${TENANT_SLUGS.length} tenants in the report`);
  for (const tenant of dry.tenants) {
    assertOk(tenant.status === "ok", `tenant ${tenant.slug} failed: ${tenant.error ?? "unknown"}`);
    assertOk(tenant.pending.length === 0, `tenant ${tenant.slug} has pending migrations after provisioning`);
  }

  step("fan-out apply across the fleet (must be a clean no-op)");
  const apply = await runFanout(controlPlane, { mode: "apply" });
  assertOk(apply.ok, "apply reported failures");
  for (const tenant of apply.tenants) {
    assertOk(tenant.applied.length === 0, `tenant ${tenant.slug} unexpectedly applied ${tenant.applied.join(", ")}`);
  }

  step("verify tenant databases are schema-only (no business data — the point)");
  for (const tenant of apply.tenants) {
    if (tenant.dbName === null) fail(`tenant ${tenant.slug} has no database`);
    const tenantUrl = new URL(serverUrl);
    tenantUrl.pathname = `/${tenant.dbName}`;
    const sql = connectPg(tenantUrl.toString(), undefined, { max: 1 });
    const [counts] = await sql<{ total: string }[]>`
      select (select count(*) from booking)
           + (select count(*) from booking_item)
           + (select count(*) from journal_entry)
           + (select count(*) from audit_event)
           + (select count(*) from supplier_account)
           + (select count(*) from offer) as total
    `;
    await sql.end({ timeout: 5 });
    assertOk(counts?.total === "0", `tenant ${tenant.slug} contains data — synthetic tenant DBs must be schema-only`);
  }

  console.log("\nmigration CI gate: OK");
} finally {
  await controlPlane.close();
}
