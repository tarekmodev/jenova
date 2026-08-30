/**
 * Per-tenant database provisioning: create the physical database, run every
 * tenant migration into it, record the database name on the Tenant row.
 * Called at tenant signup (M2 wires the UX; the mechanism lands in M0).
 */

import type { TenantId } from "@jenova/domain";
import { eq } from "drizzle-orm";
import { serverUrlOf, type ControlPlaneClient } from "./control-plane/client";
import { tenants } from "./control-plane/schema";
import {
  InvalidTenantSlugError,
  TenantAlreadyProvisionedError,
  TenantNotFoundError,
} from "./errors";
import { assertPgIdentifier, connectPg } from "./internal/pg";
import { applyMigrations } from "./migrations/apply";
import { TENANT_MIGRATIONS_DIR } from "./migrations/dirs";
import { loadMigrationDir } from "./migrations/loader";

/** Mirrors the tenant.slug check constraint — the slug becomes part of a database identifier. */
const SLUG_RE = /^[a-z][a-z0-9_]{1,45}$/;

export function tenantDbName(tenantSlug: string): string {
  if (!SLUG_RE.test(tenantSlug)) {
    throw new InvalidTenantSlugError(tenantSlug);
  }
  return `jenova_t_${tenantSlug}`;
}

export interface CreateTenantDatabaseOptions {
  /** Override the tenant migrations directory (tests only). */
  migrationsDir?: string;
}

export interface ProvisionResult {
  tenantId: TenantId;
  dbName: string;
  migrationsApplied: string[];
}

/**
 * Provisions the database for an existing (signed-up) tenant row. Resumable:
 * if a previous attempt crashed after CREATE DATABASE but before recording
 * `dbName`, re-running picks up where it stopped — migrations are
 * checksummed and idempotent, and the deterministic name means the orphan
 * database can only be ours (slugs are unique, `db_name` was still null).
 */
export async function createTenantDatabase(
  controlPlane: ControlPlaneClient,
  tenantSlug: string,
  options: CreateTenantDatabaseOptions = {},
): Promise<ProvisionResult> {
  const dbName = tenantDbName(tenantSlug);
  assertPgIdentifier(dbName);

  const [tenant] = await controlPlane.db
    .select({ id: tenants.id, dbName: tenants.dbName })
    .from(tenants)
    .where(eq(tenants.slug, tenantSlug))
    .limit(1);
  if (tenant === undefined) {
    throw new TenantNotFoundError(tenantSlug);
  }
  if (tenant.dbName !== null) {
    throw new TenantAlreadyProvisionedError(tenantSlug, tenant.dbName);
  }

  const serverUrl = serverUrlOf(controlPlane);
  const admin = connectPg(serverUrl, undefined, { max: 1 });
  try {
    // CREATE DATABASE cannot run inside a transaction or take parameters;
    // dbName is proven to be a safe identifier above.
    await admin.unsafe(`create database "${dbName}"`);
  } catch (error) {
    if (!isDuplicateDatabase(error)) {
      throw error;
    }
  } finally {
    await admin.end({ timeout: 5 });
  }

  const tenantSql = connectPg(serverUrl, dbName, { max: 1 });
  let migrationsApplied: string[];
  try {
    migrationsApplied = await applyMigrations(
      tenantSql,
      await loadMigrationDir(options.migrationsDir ?? TENANT_MIGRATIONS_DIR),
    );
  } finally {
    await tenantSql.end({ timeout: 5 });
  }

  await controlPlane.db.update(tenants).set({ dbName }).where(eq(tenants.id, tenant.id));

  return { tenantId: tenant.id, dbName, migrationsApplied };
}

function isDuplicateDatabase(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "42P04" // duplicate_database
  );
}
