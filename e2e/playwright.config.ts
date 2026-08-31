/**
 * Browser e2e for the Internal Dashboard (M2 #89–#92) — replay-backed and
 * REAL end to end (docs/09-testing.md idiom): a throwaway control plane +
 * provisioned tenant database, the real api process with the TBO adapter
 * in replay mode over committed recordings, the real Next.js dashboard,
 * and a browser. Both locales run as projects: `ar` (RTL, the default)
 * and `en` (LTR) — Arabic AND English verified per the definition of done.
 *
 * Requires local Postgres (docker-compose) like every integration suite;
 * global setup provisions and tears everything down.
 */

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  // One worker + serial specs: the flows build on one shared tenant.
  // Provision/teardown are the run.mjs orchestrator's job (`pnpm test:e2e`)
  // — Playwright's own globalSetup races webServer startup.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3800",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
  },
  projects: [{ name: "ar" }, { name: "en" }],
  webServer: [
    {
      command: "node scripts/start-api.mjs",
      url: "http://127.0.0.1:3801/health",
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      command: "node scripts/start-dashboard.mjs",
      url: "http://127.0.0.1:3800/login",
      timeout: 240_000,
      reuseExistingServer: false,
    },
  ],
});
