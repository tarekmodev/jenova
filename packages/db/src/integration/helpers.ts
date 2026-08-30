/**
 * Integration-test harness: throwaway databases per test run against the
 * local docker-compose Postgres (or the CI service container). Everything a
 * test creates carries a random suffix and is force-dropped afterwards.
 *
 * NO fabricated business data lives here or in any test — schema-level tests
 * insert only the minimal structural rows needed to prove constraints.
 */

import { randomBytes } from "node:crypto";
import type { Sql } from "postgres";
import { connectControlPlane, type ControlPlaneClient } from "../control-plane/client";
import { assertPgIdentifier, connectPg } from "../internal/pg";
import { applyMigrations } from "../migrations/apply";
import { CONTROL_PLANE_MIGRATIONS_DIR } from "../migrations/dirs";
import { loadMigrationDir } from "../migrations/loader";

export const TEST_PG_URL =
  process.env.JENOVA_TEST_PG_URL ?? "postgres://jenova:jenova@localhost:5432/jenova_control_plane";

/** Probe once per file; integration suites skip (loudly) when Postgres is down. */
export async function pgAvailable(): Promise<boolean> {
  const sql = connectPg(TEST_PG_URL, undefined, { max: 1 });
  try {
    await sql`select 1`;
    return true;
  } catch {
    console.warn(
      `[@jenova/db] Postgres unreachable at ${TEST_PG_URL} — integration tests SKIPPED. Run: docker compose up -d postgres`,
    );
    return false;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/**
 * Asserts a database operation rejects for the RIGHT reason: drizzle wraps
 * driver errors ("Failed query: ..."), so we match against the whole error
 * cause chain, not just the top message.
 */
export async function expectDbRejection(operation: Promise<unknown>, pattern: RegExp): Promise<void> {
  let error: unknown;
  try {
    await operation;
  } catch (caught) {
    error = caught;
  }
  if (error === undefined) {
    throw new Error(`expected rejection matching ${String(pattern)}, but the operation succeeded`);
  }
  const messages: string[] = [];
  let cursor: unknown = error;
  while (cursor instanceof Error) {
    messages.push(cursor.message);
    cursor = cursor.cause;
  }
  const chain = messages.join("\n");
  if (!pattern.test(chain)) {
    throw new Error(`operation rejected, but not with ${String(pattern)}:\n${chain}`);
  }
}

export interface TestPlatform {
  readonly controlPlane: ControlPlaneClient;
  readonly controlPlaneUrl: string;
  /** Random per-run suffix — use it in every slug/db name a test creates. */
  readonly suffix: string;
  /** Creates an empty database and returns a connection to it (tracked for teardown). */
  createBareDb(name: string): Promise<Sql>;
  /** Track a database created elsewhere (e.g. by provisioning) for teardown. */
  registerDb(name: string): void;
  /** Run before databases are dropped (close resolvers/pools here). */
  registerCleanup(fn: () => Promise<void>): void;
  destroy(): Promise<void>;
}

export async function createTestPlatform(): Promise<TestPlatform> {
  const suffix = randomBytes(4).toString("hex");
  const admin = connectPg(TEST_PG_URL, undefined, { max: 1 });
  const cpName = `jenova_test_cp_${suffix}`;
  assertPgIdentifier(cpName);
  await admin.unsafe(`create database "${cpName}"`);
  const dbNames = [cpName];
  const cleanups: Array<() => Promise<void>> = [];
  const openSql: Sql[] = [];

  const url = new URL(TEST_PG_URL);
  url.pathname = `/${cpName}`;
  const controlPlaneUrl = url.toString();

  const cpSql = connectPg(controlPlaneUrl, undefined, { max: 1 });
  try {
    await applyMigrations(cpSql, await loadMigrationDir(CONTROL_PLANE_MIGRATIONS_DIR));
  } finally {
    await cpSql.end({ timeout: 5 });
  }

  const controlPlane = connectControlPlane({ url: controlPlaneUrl, maxConnections: 2 });

  return {
    controlPlane,
    controlPlaneUrl,
    suffix,
    async createBareDb(name: string): Promise<Sql> {
      assertPgIdentifier(name);
      await admin.unsafe(`create database "${name}"`);
      dbNames.push(name);
      const dbUrl = new URL(TEST_PG_URL);
      dbUrl.pathname = `/${name}`;
      const sql = connectPg(dbUrl.toString(), undefined, { max: 1 });
      openSql.push(sql);
      return sql;
    },
    registerDb(name: string): void {
      dbNames.push(name);
    },
    registerCleanup(fn: () => Promise<void>): void {
      cleanups.push(fn);
    },
    async destroy(): Promise<void> {
      for (const fn of cleanups.reverse()) {
        try {
          await fn();
        } catch {
          // teardown is best-effort
        }
      }
      for (const sql of openSql) {
        try {
          await sql.end({ timeout: 1 });
        } catch {
          // teardown is best-effort
        }
      }
      await controlPlane.close();
      for (const name of [...dbNames].reverse()) {
        try {
          await admin.unsafe(`drop database if exists "${name}" with (force)`);
        } catch (error) {
          console.warn(`[@jenova/db tests] failed to drop ${name}:`, error);
        }
      }
      await admin.end({ timeout: 1 });
    },
  };
}
