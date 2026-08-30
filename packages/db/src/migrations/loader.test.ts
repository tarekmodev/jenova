import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MigrationSequenceError } from "../errors";
import { loadMigrationDir } from "./loader";

describe("loadMigrationDir", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "jenova-db-loader-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads .sql files in filename order with stable checksums", async () => {
    await writeFile(path.join(dir, "0002_second.sql"), "select 2;");
    await writeFile(path.join(dir, "0001_first.sql"), "select 1;");
    await writeFile(path.join(dir, "notes.txt"), "ignored");
    const files = await loadMigrationDir(dir);
    expect(files.map((f) => f.name)).toEqual(["0001_first.sql", "0002_second.sql"]);
    const again = await loadMigrationDir(dir);
    expect(again.map((f) => f.checksum)).toEqual(files.map((f) => f.checksum));
  });

  it("rejects names that do not match NNNN_name.sql", async () => {
    await writeFile(path.join(dir, "01_short.sql"), "select 1;");
    await expect(loadMigrationDir(dir)).rejects.toThrow(MigrationSequenceError);
  });

  it("rejects duplicate migration numbers", async () => {
    await writeFile(path.join(dir, "0001_a.sql"), "select 1;");
    await writeFile(path.join(dir, "0001_b.sql"), "select 1;");
    await expect(loadMigrationDir(dir)).rejects.toThrow(/duplicate migration number/);
  });
});
