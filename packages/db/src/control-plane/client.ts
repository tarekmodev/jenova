import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { connectPg, kServerUrl } from "../internal/pg";
import * as controlPlaneSchema from "./schema";

/** Drizzle client typed over the control-plane schema ONLY. */
export type ControlPlaneDb = PostgresJsDatabase<typeof controlPlaneSchema>;

export interface ControlPlaneClient {
  readonly db: ControlPlaneDb;
  close(): Promise<void>;
}

export interface ConnectControlPlaneOptions {
  /** postgres:// URL of the control-plane database. */
  url: string;
  /** Pool size (default 4; keep small — PgBouncer-friendly). */
  maxConnections?: number;
}

interface InternalControlPlaneClient extends ControlPlaneClient {
  [kServerUrl]: string;
}

/**
 * The only door to control-plane data. The returned client is typed over the
 * control-plane schema exclusively — tenant tables cannot be addressed
 * through it, and the underlying pool is never exposed.
 */
export function connectControlPlane(options: ConnectControlPlaneOptions): ControlPlaneClient {
  const sql = connectPg(options.url, undefined, options.maxConnections === undefined ? {} : { max: options.maxConnections });
  const client: InternalControlPlaneClient = {
    db: drizzle(sql, { schema: controlPlaneSchema }),
    close: () => sql.end({ timeout: 5 }),
    [kServerUrl]: options.url,
  };
  return client;
}

/**
 * INTERNAL (not exported from the package index): the server URL behind a
 * control-plane client, used by provisioning/resolver/fan-out to reach other
 * databases on the same server.
 */
export function serverUrlOf(client: ControlPlaneClient): string {
  const url = (client as Partial<InternalControlPlaneClient>)[kServerUrl];
  if (url === undefined) {
    throw new Error("not a ControlPlaneClient created by connectControlPlane()");
  }
  return url;
}
