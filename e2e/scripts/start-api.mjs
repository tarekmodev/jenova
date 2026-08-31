/**
 * Launch the REAL api process against the provisioned e2e platform.
 * NODE_ENV=test pins the supplier transport to replay (recordings only) —
 * CI and e2e never touch live sandboxes (look-to-book, CLAUDE.md rule 5).
 */

import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Playwright launches web servers BEFORE global setup; wait for the
// provisioning state to appear (the webServer url-check tolerates this).
const stateUrl = new URL("../.tmp/state.json", import.meta.url);
for (let waited = 0; !existsSync(stateUrl); waited += 1) {
  if (waited > 150) throw new Error("timed out waiting for e2e provisioning state");
  await sleep(1_000);
}
const state = JSON.parse(readFileSync(stateUrl, "utf8"));

const child = spawn("pnpm", ["--filter", "@jenova/api", "exec", "tsx", "src/main.ts"], {
  cwd: fileURLToPath(new URL("../..", import.meta.url)),
  shell: true,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "test",
    API_PORT: String(state.apiPort),
    CONTROL_PLANE_DATABASE_URL: state.controlPlaneUrl,
    JENOVA_TENANT_RUNTIME_DSN: state.runtimeDsn,
    REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
    OFFER_SIGNING_KEY: "e2e-only-offer-signing-key-change-me-00",
    JENOVA_DATA_KEY: state.dataKey,
    JENOVA_DATA_KEY_ID: "e2e-v1",
  },
});

child.on("exit", (code) => process.exit(code ?? 1));
