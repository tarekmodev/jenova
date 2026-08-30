/** Shared drizzle transaction/database typing over the tenant schema. */

import type { TenantDb } from "@jenova/db";

/** The transaction handle inside `TenantDb.transaction(async (tx) => ...)`. */
export type TenantTx = Parameters<Parameters<TenantDb["transaction"]>[0]>[0];

/** Query surface accepted by helpers that run either standalone or in a tx. */
export type TenantDbOrTx = TenantDb | TenantTx;
