/**
 * Provision one tenant-staff user from the command line (M2 #89) — the
 * bootstrap path for a fresh tenant's first dashboard admin (self-service
 * invites live in Settings once someone can log in) and for the e2e
 * harness, which must never hash passwords with anything but the real
 * primitive.
 *
 *   pnpm --filter @jenova/api exec tsx tools/create-staff-user.ts \
 *     --tenant-slug <slug> --email <email> --password <password> \
 *     --name "<display name>" [--role admin]
 *
 * Reads CONTROL_PLANE_DATABASE_URL and JENOVA_TENANT_RUNTIME_DSN from the
 * environment (repo-root .env in local dev). Idempotent per email: an
 * existing user is left untouched and reported.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { connectControlPlane, createTenantDbResolver, staffUsers, tenants } from "@jenova/db";
import { hashPassword } from "../src/auth/password";
import { isStaffRole, STAFF_ROLES } from "../src/auth/staff-users";

const REPO_ROOT_ENV = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(REPO_ROOT_ENV)) process.loadEnvFile(REPO_ROOT_ENV);

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const slug = arg("tenant-slug");
  const email = arg("email")?.toLowerCase();
  const password = arg("password");
  const displayName = arg("name");
  const role = arg("role") ?? "admin";
  const controlPlaneUrl = process.env["CONTROL_PLANE_DATABASE_URL"];

  if (slug === undefined || email === undefined || password === undefined || displayName === undefined) {
    throw new Error(
      "usage: create-staff-user --tenant-slug <slug> --email <email> --password <password> --name <name> [--role admin]",
    );
  }
  if (!isStaffRole(role)) {
    throw new Error(`--role must be one of: ${STAFF_ROLES.join(", ")}`);
  }
  if (controlPlaneUrl === undefined) {
    throw new Error("CONTROL_PLANE_DATABASE_URL is required");
  }

  const controlPlane = connectControlPlane({ url: controlPlaneUrl });
  const resolver = createTenantDbResolver(controlPlane);
  try {
    const tenantRows = await controlPlane.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);
    const tenant = tenantRows[0];
    if (tenant === undefined) {
      throw new Error(`no tenant with slug '${slug}'`);
    }
    const db = await resolver.getTenantDb(tenant.id);
    const existing = await db
      .select({ id: staffUsers.id })
      .from(staffUsers)
      .where(eq(staffUsers.email, email))
      .limit(1);
    if (existing.length > 0) {
      console.log(`staff user ${email} already exists for tenant ${slug} — left untouched`);
      return;
    }
    const passwordHash = await hashPassword(password);
    const inserted = await db
      .insert(staffUsers)
      .values({ email, displayName, role, passwordHash })
      .returning({ id: staffUsers.id });
    console.log(`created staff user ${email} (${inserted[0]?.id ?? "?"}) for tenant ${slug}`);
  } finally {
    await resolver.close();
    await controlPlane.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
