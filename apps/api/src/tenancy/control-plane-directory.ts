/**
 * Control-plane-backed gateway sources (the "#42 wiring" the M0 stubs
 * promised): Host → tenant out of `tenant_host`, and app entitlements out
 * of `app_installation` (apps are entitlement flags — CLAUDE.md rule 3).
 *
 * Fail-closed inheritance: an unknown host, an unprovisioned tenant
 * (db_name still null) and an uninstalled app all resolve to "no" exactly
 * as the Unbound/DenyAll defaults did — these implementations only open
 * what the control plane explicitly grants.
 */

import { and, eq } from "drizzle-orm";
import type { AppKey, TenantId } from "@jenova/domain";
import { appInstallations, tenantHosts, tenants, type ControlPlaneClient } from "@jenova/db";
import type { EntitlementSource } from "../gateway/entitlement-source";
import type { TenantDirectory, TenantDirectoryEntry } from "../gateway/tenant-directory";

export class ControlPlaneTenantDirectory implements TenantDirectory {
  constructor(private readonly controlPlane: ControlPlaneClient) {}

  async resolveByHost(host: string): Promise<TenantDirectoryEntry | null> {
    const rows = await this.controlPlane.db
      .select({ tenantId: tenants.id, dbName: tenants.dbName })
      .from(tenantHosts)
      .innerJoin(tenants, eq(tenantHosts.tenantId, tenants.id))
      .where(eq(tenantHosts.host, host))
      .limit(1);
    const row = rows[0];
    if (row === undefined || row.dbName === null) {
      // Unprovisioned tenants are unroutable, not half-up.
      return null;
    }
    return { tenantId: row.tenantId, dbName: row.dbName };
  }
}

export class ControlPlaneEntitlementSource implements EntitlementSource {
  constructor(private readonly controlPlane: ControlPlaneClient) {}

  async isInstalled(tenantId: TenantId, appKey: AppKey): Promise<boolean> {
    const rows = await this.controlPlane.db
      .select({ id: appInstallations.id })
      .from(appInstallations)
      .where(and(eq(appInstallations.tenantId, tenantId), eq(appInstallations.appKey, appKey)))
      .limit(1);
    return rows.length > 0;
  }

  /** The dashboard's nav filter wants the whole set in one read. */
  async installedApps(tenantId: TenantId): Promise<readonly AppKey[]> {
    const rows = await this.controlPlane.db
      .select({ appKey: appInstallations.appKey })
      .from(appInstallations)
      .where(eq(appInstallations.tenantId, tenantId));
    return rows.map((row) => row.appKey);
  }
}
