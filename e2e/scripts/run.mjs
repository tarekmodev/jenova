/**
 * e2e orchestrator (`pnpm --filter @jenova/e2e test:e2e`):
 * provision (throwaway platform + tenant + seeds + dashboard build) →
 * playwright test (which launches api + dashboard as web servers) →
 * teardown ALWAYS (drop databases + role). Exit code is Playwright's.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const E2E_DIR = fileURLToPath(new URL("..", import.meta.url));

function run(label, command, args) {
  console.log(`\n=== e2e: ${label} ===`);
  const result = spawnSync(command, args, { cwd: E2E_DIR, stdio: "inherit", shell: true });
  return result.status ?? 1;
}

const provisioned = run("provision", "pnpm", ["exec", "tsx", "setup/provision.ts"]);
let testStatus = 1;
if (provisioned === 0) {
  testStatus = run("playwright", "pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)]);
} else {
  console.error("e2e provisioning failed — skipping tests");
}
run("teardown", "pnpm", ["exec", "tsx", "setup/teardown.ts"]);
process.exit(provisioned === 0 ? testStatus : provisioned);
