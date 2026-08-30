/**
 * The tenant connection resolver — THE ONLY DOOR to tenant data
 * (CLAUDE.md rule 1). Misuse is impossible by construction:
 *
 * - `getTenantDb` accepts only a branded TenantId — a raw string is a
 *   compile error.
 * - The returned client is a Drizzle instance typed over the tenant schema
 *   exclusively, physically connected to that tenant's own database:
 *   cross-tenant reads have no address to go to.
 * - No raw pool, connection, or factory is ever exported; the control-plane
 *   client is a separate export typed only over control-plane tables.
 *
 * Pools are lazy (opened on first use per tenant), small (PgBouncer-friendly,
 * `prepare: false`), and capped: beyond `maxPools` distinct tenants the
 * least-recently-used pool is closed.
 */

import type { TenantId } from "@jenova/domain";
import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import { serverUrlOf, type ControlPlaneClient } from "./control-plane/client";
import { tenants } from "./control-plane/schema";
import { TenantNotFoundError, TenantNotProvisionedError } from "./errors";
import { connectPg } from "./internal/pg";
import * as tenantSchema from "./tenant/schema";

/** Drizzle client typed over the tenant schema ONLY. */
export type TenantDb = PostgresJsDatabase<typeof tenantSchema>;

export interface TenantDbResolverOptions {
  /** Max distinct tenant pools held open; LRU-evicted beyond this (default 50). */
  maxPools?: number;
  /** Max connections per tenant pool (default 4 — keep small, PgBouncer-friendly). */
  connectionsPerTenant?: number;
}

export interface TenantDbResolver {
  getTenantDb(tenantId: TenantId): Promise<TenantDb>;
  close(): Promise<void>;
}

interface PoolEntry {
  sql: Sql;
  db: TenantDb;
  lastUsed: number;
}

export function createTenantDbResolver(
  controlPlane: ControlPlaneClient,
  options: TenantDbResolverOptions = {},
): TenantDbResolver {
  const maxPools = options.maxPools ?? 50;
  const connectionsPerTenant = options.connectionsPerTenant ?? 4;
  const serverUrl = serverUrlOf(controlPlane);
  const pools = new Map<TenantId, PoolEntry>();
  const inflight = new Map<TenantId, Promise<TenantDb>>();
  let closed = false;

  async function open(tenantId: TenantId): Promise<PoolEntry> {
    const [tenant] = await controlPlane.db
      .select({ dbName: tenants.dbName })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (tenant === undefined) {
      throw new TenantNotFoundError(tenantId);
    }
    if (tenant.dbName === null) {
      throw new TenantNotProvisionedError(tenantId);
    }
    const sql = connectPg(serverUrl, tenant.dbName, { max: connectionsPerTenant });
    return { sql, db: drizzle(sql, { schema: tenantSchema }), lastUsed: Date.now() };
  }

  async function evictOverflow(): Promise<void> {
    while (pools.size > maxPools) {
      let lru: [TenantId, PoolEntry] | undefined;
      for (const entry of pools) {
        if (lru === undefined || entry[1].lastUsed < lru[1].lastUsed) {
          lru = entry;
        }
      }
      if (lru === undefined) {
        return;
      }
      pools.delete(lru[0]);
      await lru[1].sql.end({ timeout: 5 });
    }
  }

  return {
    async getTenantDb(tenantId: TenantId): Promise<TenantDb> {
      if (closed) {
        throw new Error("tenant resolver is closed");
      }
      const hit = pools.get(tenantId);
      if (hit !== undefined) {
        hit.lastUsed = Date.now();
        return hit.db;
      }
      const pending = inflight.get(tenantId);
      if (pending !== undefined) {
        return pending;
      }
      const opening = (async () => {
        const entry = await open(tenantId);
        pools.set(tenantId, entry);
        await evictOverflow();
        return entry.db;
      })().finally(() => inflight.delete(tenantId));
      inflight.set(tenantId, opening);
      return opening;
    },

    async close(): Promise<void> {
      closed = true;
      await Promise.allSettled([...inflight.values()]);
      const entries = [...pools.values()];
      pools.clear();
      await Promise.all(entries.map((entry) => entry.sql.end({ timeout: 5 })));
    },
  };
}
