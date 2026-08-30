/**
 * Single-database migration engine. Every database (control-plane and each
 * tenant) records its own applied migrations in `_jenova_migrations` — that
 * per-database state is what makes the fan-out runner resumable: re-running
 * simply skips what a database already has.
 */

import type { Sql } from "postgres";
import { MigrationChecksumError } from "../errors";
import type { MigrationFile } from "./loader";

const STATE_TABLE = "_jenova_migrations";

async function readApplied(sql: Sql): Promise<Map<string, string>> {
  // to_regclass instead of CREATE TABLE IF NOT EXISTS so that a dry-run
  // performs zero writes.
  const reg = await sql<{ t: string | null }[]>`select to_regclass(${`public.${STATE_TABLE}`}) as t`;
  if (reg[0]?.t == null) {
    return new Map();
  }
  const rows = await sql<{ name: string; checksum: string }[]>`
    select name, checksum from ${sql(STATE_TABLE)} order by name
  `;
  return new Map(rows.map((r) => [r.name, r.checksum]));
}

export interface MigrationStatusResult {
  /** Names already recorded as applied in this database. */
  applied: string[];
  /** Files not yet applied, in apply order. */
  pending: MigrationFile[];
}

/**
 * Read-only status: which of `files` this database still needs. Throws
 * `MigrationChecksumError` if an applied file's content changed on disk.
 * Migrations recorded in the DB but absent from `files` are tolerated — that
 * is the expand-contract N−1 case (older code against a newer schema).
 */
export async function migrationStatus(sql: Sql, files: readonly MigrationFile[]): Promise<MigrationStatusResult> {
  const applied = await readApplied(sql);
  for (const file of files) {
    const recorded = applied.get(file.name);
    if (recorded !== undefined && recorded !== file.checksum) {
      throw new MigrationChecksumError(file.name);
    }
  }
  return {
    applied: [...applied.keys()],
    pending: files.filter((f) => !applied.has(f.name)),
  };
}

/**
 * Applies every pending file, each in its own transaction under an advisory
 * lock (safe against a concurrently running migrator), recording state as it
 * goes — a failure mid-sequence leaves earlier migrations applied and
 * recorded, so the next run resumes at the failed file.
 */
export async function applyMigrations(sql: Sql, files: readonly MigrationFile[]): Promise<string[]> {
  const { pending } = await migrationStatus(sql, files);
  const applied: string[] = [];
  for (const file of pending) {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('jenova_migrations'))`;
      await tx.unsafe(
        `create table if not exists ${STATE_TABLE} (
           name text primary key,
           checksum text not null,
           applied_at timestamptz not null default now()
         )`,
      );
      // Re-check inside the lock: a concurrent runner may have applied it.
      const rows = await tx<{ checksum: string }[]>`
        select checksum from ${tx(STATE_TABLE)} where name = ${file.name}
      `;
      const row = rows[0];
      if (row !== undefined) {
        if (row.checksum !== file.checksum) {
          throw new MigrationChecksumError(file.name);
        }
        return;
      }
      await tx.unsafe(file.sql);
      await tx`insert into ${tx(STATE_TABLE)} (name, checksum) values (${file.name}, ${file.checksum})`;
    });
    applied.push(file.name);
  }
  return applied;
}
