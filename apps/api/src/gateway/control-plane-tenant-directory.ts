/**
 * Control-plane-backed TenantDirectory (M2 issue #95) — the follow-up wiring
 * the M0 seam promised: Host → tenant via the control-plane `tenant_domain`
 * table (db migration 0002), replacing UnboundTenantDirectory.
 *
 * Reads are cached per host for a short TTL (positive AND negative — an
 * unknown host must not be a per-request control-plane query either), so the
 * hot request path costs one Map lookup. A domain re-binding propagates
 * within the TTL; that is an operator action measured in minutes, not a
 * request-path concern.
 */

import { eq } from "drizzle-orm";
import { tenantDomains, tenants, type ControlPlaneClient } from "@jenova/db";
import type { TenantDirectory, TenantDirectoryEntry } from "./tenant-directory";

const DEFAULT_TTL_MS = 30_000;

interface CacheSlot {
  readonly entry: TenantDirectoryEntry | null;
  readonly expiresAtMs: number;
}

export interface ControlPlaneTenantDirectoryOptions {
  readonly ttlMs?: number;
  /** Clock seam for tests. */
  readonly clock?: () => number;
}

export class ControlPlaneTenantDirectory implements TenantDirectory {
  private readonly ttlMs: number;
  private readonly clock: () => number;
  private readonly cache = new Map<string, CacheSlot>();

  constructor(
    private readonly controlPlane: ControlPlaneClient,
    options: ControlPlaneTenantDirectoryOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.clock = options.clock ?? Date.now;
  }

  async resolveByHost(host: string): Promise<TenantDirectoryEntry | null> {
    const now = this.clock();
    const cached = this.cache.get(host);
    if (cached !== undefined && cached.expiresAtMs > now) {
      return cached.entry;
    }

    const [row] = await this.controlPlane.db
      .select({ tenantId: tenantDomains.tenantId, dbName: tenants.dbName })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenantDomains.tenantId, tenants.id))
      .where(eq(tenantDomains.host, host))
      .limit(1);

    // A domain bound to an UNPROVISIONED tenant (dbName still null) does not
    // resolve: serving it would explode on the first tenant-data read with a
    // far less honest error than the gateway's tenant_not_found.
    const entry: TenantDirectoryEntry | null =
      row === undefined || row.dbName === null
        ? null
        : { tenantId: row.tenantId, dbName: row.dbName };
    this.cache.set(host, { entry, expiresAtMs: now + this.ttlMs });
    return entry;
  }
}
