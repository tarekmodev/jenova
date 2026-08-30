/**
 * Fan-out migration runner: applies pending migrations to the control-plane
 * database AND every provisioned tenant database (CLAUDE.md rule 1 — every
 * migration goes through this, from migration #1).
 *
 * - dry-run: read-only; reports what each database would apply.
 * - apply: per-database failure isolation — tenant N failing never stops
 *   tenant N+1; each migration commits (and is recorded) individually, so a
 *   re-run resumes exactly at the first unapplied file per database.
 */

import type { TenantId } from "@jenova/domain";
import { serverUrlOf, type ControlPlaneClient } from "./control-plane/client";
import { tenants } from "./control-plane/schema";
import { connectPg } from "./internal/pg";
import { applyMigrations, migrationStatus } from "./migrations/apply";
import { CONTROL_PLANE_MIGRATIONS_DIR, TENANT_MIGRATIONS_DIR } from "./migrations/dirs";
import { loadMigrationDir, type MigrationFile } from "./migrations/loader";

export type FanoutMode = "dry-run" | "apply";

export interface FanoutOptions {
  mode: FanoutMode;
  /** Overrides for tests only — production always fans out the packaged migrations. */
  controlPlaneMigrationsDir?: string;
  tenantMigrationsDir?: string;
}

export interface DatabaseFanoutStatus {
  status: "ok" | "failed";
  /** Migrations applied during THIS run ([] in dry-run). */
  applied: string[];
  /** Migrations still pending after this run. */
  pending: string[];
  error?: string;
}

export interface TenantFanoutStatus extends DatabaseFanoutStatus {
  tenantId: TenantId;
  slug: string;
  /** null = tenant exists but was never provisioned (status stays "ok"; nothing to migrate). */
  dbName: string | null;
}

export interface FanoutReport {
  mode: FanoutMode;
  controlPlane: DatabaseFanoutStatus;
  tenants: TenantFanoutStatus[];
  /** True iff the control plane and every tenant finished without error. */
  ok: boolean;
}

export async function runFanout(controlPlane: ControlPlaneClient, options: FanoutOptions): Promise<FanoutReport> {
  const controlPlaneFiles = await loadMigrationDir(options.controlPlaneMigrationsDir ?? CONTROL_PLANE_MIGRATIONS_DIR);
  const tenantFiles = await loadMigrationDir(options.tenantMigrationsDir ?? TENANT_MIGRATIONS_DIR);
  const serverUrl = serverUrlOf(controlPlane);

  const controlPlaneStatus = await migrateOneDatabase(serverUrl, undefined, controlPlaneFiles, options.mode);

  let tenantRows: { id: TenantId; slug: string; dbName: string | null }[] = [];
  let listError: string | undefined;
  try {
    tenantRows = await controlPlane.db
      .select({ id: tenants.id, slug: tenants.slug, dbName: tenants.dbName })
      .from(tenants)
      .orderBy(tenants.slug);
  } catch (error) {
    if (controlPlaneStatus.pending.length > 0 || controlPlaneStatus.status === "failed") {
      // Fresh install (dry-run before the first apply) or a failed control
      // plane: there is no tenant table to read yet.
      tenantRows = [];
    } else {
      listError = messageOf(error);
    }
  }

  const tenantStatuses: TenantFanoutStatus[] = [];
  for (const tenant of tenantRows) {
    const identity = { tenantId: tenant.id, slug: tenant.slug, dbName: tenant.dbName };
    if (tenant.dbName === null) {
      tenantStatuses.push({ ...identity, status: "ok", applied: [], pending: [] });
      continue;
    }
    const status = await migrateOneDatabase(serverUrl, tenant.dbName, tenantFiles, options.mode);
    tenantStatuses.push({ ...identity, ...status });
  }

  const ok =
    listError === undefined &&
    controlPlaneStatus.status === "ok" &&
    tenantStatuses.every((t) => t.status === "ok");

  if (listError !== undefined) {
    controlPlaneStatus.status = "failed";
    controlPlaneStatus.error = `failed to list tenants: ${listError}`;
  }

  return { mode: options.mode, controlPlane: controlPlaneStatus, tenants: tenantStatuses, ok };
}

async function migrateOneDatabase(
  serverUrl: string,
  dbName: string | undefined,
  files: readonly MigrationFile[],
  mode: FanoutMode,
): Promise<DatabaseFanoutStatus> {
  const sql = connectPg(serverUrl, dbName, { max: 1 });
  try {
    if (mode === "dry-run") {
      const { pending } = await migrationStatus(sql, files);
      return { status: "ok", applied: [], pending: pending.map((f) => f.name) };
    }
    const before = await migrationStatus(sql, files);
    try {
      const applied = await applyMigrations(sql, files);
      return { status: "ok", applied, pending: [] };
    } catch (error) {
      // Partial progress is real progress: report what DID land, and what is
      // still pending — the next run resumes there.
      let applied: string[] = [];
      let pending = files.map((f) => f.name);
      try {
        const after = await migrationStatus(sql, files);
        applied = after.applied.filter((name) => !before.applied.includes(name));
        pending = after.pending.map((f) => f.name);
      } catch {
        // keep the pessimistic defaults
      }
      return { status: "failed", applied, pending, error: messageOf(error) };
    }
  } catch (error) {
    return { status: "failed", applied: [], pending: files.map((f) => f.name), error: messageOf(error) };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
