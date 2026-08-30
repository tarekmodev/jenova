/**
 * INTERNAL connection plumbing. Nothing in this module is exported from the
 * package index: the ONLY doors to a database are `connectControlPlane`
 * (control-plane schema) and the tenant resolver (tenant schema) — raw
 * pools/factories never leave the package (CLAUDE.md rule 1).
 */

import postgres, { type Sql } from "postgres";

/**
 * Hidden key linking a ControlPlaneClient to the server URL it was opened
 * against. The symbol is never exported from the package index, so consumers
 * cannot reach the raw URL through the public surface.
 */
export const kServerUrl = Symbol("jenova.db.serverUrl");

const IDENTIFIER_RE = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Database names are interpolated into `CREATE DATABASE` (which cannot be
 * parameterized), so they must be provably safe identifiers first.
 */
export function assertPgIdentifier(name: string): void {
  if (!IDENTIFIER_RE.test(name)) {
    throw new Error(`not a safe postgres identifier: ${JSON.stringify(name)}`);
  }
}

export interface ConnectPgOptions {
  max?: number;
}

/**
 * Opens a postgres.js pool against `serverUrl`, optionally switching the
 * database. `prepare: false` keeps every connection PgBouncer
 * (transaction-pooling) compatible.
 */
export function connectPg(serverUrl: string, dbName: string | undefined, options: ConnectPgOptions = {}): Sql {
  const url = new URL(serverUrl);
  if (dbName !== undefined) {
    assertPgIdentifier(dbName);
    url.pathname = `/${dbName}`;
  }
  return postgres(url.toString(), {
    max: options.max ?? 4,
    prepare: false,
    onnotice: () => {},
  });
}
