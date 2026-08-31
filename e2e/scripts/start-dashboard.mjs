/**
 * Launch the production-built dashboard (provision.ts ran `next build`)
 * pointed at the e2e api, presenting the provisioned tenant host.
 */

import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Playwright launches web servers BEFORE global setup; wait for the
// provisioning state (which also runs `next build`) to appear.
const stateUrl = new URL("../.tmp/state.json", import.meta.url);
for (let waited = 0; !existsSync(stateUrl); waited += 1) {
  if (waited > 220) throw new Error("timed out waiting for e2e provisioning state");
  await sleep(1_000);
}
const state = JSON.parse(readFileSync(stateUrl, "utf8"));

const child = spawn(
  "pnpm",
  ["--filter", "@jenova/dashboard", "exec", "next", "start", "-p", String(state.dashboardPort)],
  {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    shell: true,
    stdio: "inherit",
    env: {
      ...process.env,
      JENOVA_API_URL: `http://127.0.0.1:${String(state.apiPort)}`,
      JENOVA_TENANT_HOST: state.tenantHost,
    },
  },
);

child.on("exit", (code) => process.exit(code ?? 1));
