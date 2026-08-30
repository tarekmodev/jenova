import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { MigrationSequenceError } from "../errors";

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
  readonly checksum: string;
}

const MIGRATION_NAME_RE = /^\d{4}_[a-z0-9_]+\.sql$/;

/**
 * Loads a migration directory: `NNNN_snake_case.sql`, applied in filename
 * order. Numbers must be unique — two migrations with the same prefix would
 * apply in an undefined order across tenant databases.
 */
export async function loadMigrationDir(dir: string): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
  const seen = new Set<string>();
  const out: MigrationFile[] = [];
  for (const name of names) {
    if (!MIGRATION_NAME_RE.test(name)) {
      throw new MigrationSequenceError(`migration file name must match NNNN_name.sql: ${name}`);
    }
    const prefix = name.slice(0, 4);
    if (seen.has(prefix)) {
      throw new MigrationSequenceError(`duplicate migration number ${prefix}: ${name}`);
    }
    seen.add(prefix);
    const sql = await readFile(path.join(dir, name), "utf8");
    out.push({ name, sql, checksum: createHash("sha256").update(sql).digest("hex") });
  }
  return out;
}
