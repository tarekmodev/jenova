/**
 * Provision the e2e platform (run under tsx by global-setup):
 *
 *  1. throwaway control plane + runtime role (@jenova/db/testing — the same
 *     harness every api integration suite uses)
 *  2. tenant + tenant_host + app entitlements (b2b ONLY — the nav test
 *     proves uninstalled apps are absent) + supplier catalog (tbo)
 *  3. provisioned tenant database (full migration chain)
 *  4. first staff admin through the api's own bootstrap tool (the real
 *     argon2id primitive — never a duplicate hasher)
 *  5. workspace seed through the api's replay-backed seed tool (recorded
 *     SNAO7U fare/policy through the real adapter + runner — rule 5)
 *  6. a production build of the dashboard
 *  7. .tmp/state.json for the server launchers, tests and teardown
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appInstallations, createTenantDatabase, supplierCatalogEntries, tenantHosts, tenants } from "@jenova/db";
import { createTestPlatform } from "@jenova/db/testing";

const E2E_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TENANT_HOST = "e2e-tenant.local";
const ADMIN_EMAIL = "admin@e2e-tenant.local";
const ADMIN_PASSWORD = "e2e-admin-password-1";

function run(command: string, args: readonly string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, [...args], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (exit ${String(result.status)})`);
  }
}

async function main(): Promise<void> {
  const platform = await createTestPlatform();
  const slug = `e2e_${platform.suffix}`;

  const inserted = await platform.controlPlane.db
    .insert(tenants)
    .values({ slug, name: "Jenova E2E Tenant", baseCurrency: "SAR" })
    .returning({ id: tenants.id });
  const tenant = inserted[0];
  if (tenant === undefined) throw new Error("tenant insert returned no row");

  await platform.controlPlane.db
    .insert(tenantHosts)
    .values({ host: TENANT_HOST, tenantId: tenant.id });
  // b2b ONLY: the nav must show b2b and hide the other seven.
  await platform.controlPlane.db
    .insert(appInstallations)
    .values({ tenantId: tenant.id, appKey: "b2b" });
  await platform.controlPlane.db.insert(supplierCatalogEntries).values({
    supplierCode: "tbo",
    name: "TBO Holidays",
    vertical: "hotel",
    certificationSandbox: "certified",
  });

  const provisioned = await createTenantDatabase(platform.controlPlane, slug);

  const toolEnv: NodeJS.ProcessEnv = {
    CONTROL_PLANE_DATABASE_URL: platform.controlPlaneUrl,
    JENOVA_TENANT_RUNTIME_DSN: platform.runtimeDsn,
    NODE_ENV: "test",
  };
  run(
    "pnpm",
    [
      "--filter", "@jenova/api", "exec", "tsx", "tools/create-staff-user.ts",
      "--tenant-slug", slug,
      "--email", ADMIN_EMAIL,
      "--password", ADMIN_PASSWORD,
      "--name", "Amal Admin",
      "--role", "admin",
    ],
    toolEnv,
  );
  run(
    "pnpm",
    [
      "--filter", "@jenova/api", "exec", "tsx", "tools/seed-workspace-booking.ts",
      "--tenant-slug", slug,
      "--escalations", "2",
    ],
    toolEnv,
  );

  run("pnpm", ["--filter", "@jenova/dashboard", "build"], {});

  mkdirSync(new URL("../.tmp", import.meta.url), { recursive: true });
  writeFileSync(
    new URL("../.tmp/state.json", import.meta.url),
    JSON.stringify(
      {
        controlPlaneUrl: platform.controlPlaneUrl,
        runtimeDsn: platform.runtimeDsn,
        suffix: platform.suffix,
        tenantId: tenant.id,
        tenantSlug: slug,
        tenantDbName: provisioned.dbName,
        tenantHost: TENANT_HOST,
        adminEmail: ADMIN_EMAIL,
        adminPassword: ADMIN_PASSWORD,
        dataKey: randomBytes(32).toString("base64"),
        apiPort: 3801,
        dashboardPort: 3800,
      },
      null,
      2,
    ),
  );

  // Deliberately NOT destroyed here — the api process needs it; teardown
  // drops both databases and the runtime role by name.
  await platform.controlPlane.close();
  console.log(`e2e platform ready: ${slug} on ${TENANT_HOST} (cwd ${E2E_DIR})`);
  // The harness keeps an admin connection for its own destroy(); we exit
  // instead of destroying (the databases must outlive this process).
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
