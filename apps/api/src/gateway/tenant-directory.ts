/**
 * TenantDirectory — how the gateway maps a request Host to a tenant.
 *
 * DELIBERATELY a local interface, not an @jenova/db import: the db package
 * (PR #42, control-plane Tenant table + tenant connection resolver) had not
 * merged when this landed. A follow-up wiring task binds a control-plane-
 * backed implementation to TENANT_DIRECTORY once #42 merges; the gateway
 * chain, context shape, and this contract do not change.
 */

import type { TenantId } from "@jenova/domain";

export interface TenantDirectoryEntry {
  readonly tenantId: TenantId;
  /** Name of the tenant's dedicated database (db-per-tenant, CLAUDE.md rule 1). */
  readonly dbName: string;
}

export interface TenantDirectory {
  /** @param host normalized: lowercase, no port. null = unknown host. */
  resolveByHost(host: string): Promise<TenantDirectoryEntry | null>;
}

/** Nest injection token for the process-wide {@link TenantDirectory}. */
export const TENANT_DIRECTORY = Symbol("jenova.api.tenantDirectory");

/**
 * M0 default: resolves NOTHING, so every tenant-scoped request is a 404
 * until the control-plane-backed directory is wired (post-#42). Safe-by-
 * default beats accidentally serving an unknown host.
 */
export class UnboundTenantDirectory implements TenantDirectory {
  resolveByHost(): Promise<null> {
    return Promise.resolve(null);
  }
}
