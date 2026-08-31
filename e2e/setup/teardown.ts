/**
 * Drop everything provision.ts created (run under tsx by global-teardown):
 * the throwaway control-plane database, the tenant database, and the
 * per-run runtime login role — by the names recorded in .tmp/state.json.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { TEST_PG_URL } from "@jenova/db/testing";

interface State {
  readonly suffix: string;
  readonly tenantDbName: string;
}

async function main(): Promise<void> {
  const statePath = fileURLToPath(new URL("../.tmp/state.json", import.meta.url));
  if (!existsSync(statePath)) {
    console.log("no e2e state to tear down");
    return;
  }
  const state = JSON.parse(readFileSync(statePath, "utf8")) as State;
  const sql = postgres(TEST_PG_URL, { max: 1, onnotice: () => undefined });
  try {
    for (const db of [state.tenantDbName, `jenova_test_cp_${state.suffix}`]) {
      await sql.unsafe(`drop database if exists "${db}" with (force)`);
    }
    await sql.unsafe(`drop role if exists "jenova_test_rt_${state.suffix}"`);
    console.log(`dropped e2e databases + role for suffix ${state.suffix}`);
  } finally {
    await sql.end();
    rmSync(statePath, { force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
