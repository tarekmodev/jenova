/**
 * Agent Portal e2e (M2 issues #95–#98): the FULL flow — login → streaming
 * search → offer → check → book → bookings → cancel with fee preview —
 * through the REAL api in replay mode over the committed TBO recordings
 * (CLAUDE.md rule 5: replayed real traffic, zero fabricated supplier data),
 * against throwaway per-run tenant databases.
 *
 * Two projects, two TENANTS, two locales: the `ar` project runs against the
 * tenant bound to host `localhost`, the `en` project against the tenant
 * bound to `127.0.0.1` — each books and cancels the recorded lifecycle
 * independently, Arabic first (rule 9).
 *
 * Requires local Postgres (docker compose up -d postgres) and Redis.
 */

import { defineConfig } from "@playwright/test";
import { PORTAL_PORT } from "./src/harness/constants";

/** Mid-range phone viewport — the 90-second benchmark's target device class. */
const PHONE_VIEWPORT = { width: 390, height: 844 };

export default defineConfig({
  testDir: "./src",
  globalSetup: "./src/harness/global-setup.ts",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  // One worker: a single shared api/portal process pair, and honest timing.
  workers: 1,
  reporter: [["list"]],
  use: {
    viewport: PHONE_VIEWPORT,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "ar",
      use: { baseURL: `http://localhost:${String(PORTAL_PORT)}` },
    },
    {
      name: "en",
      use: { baseURL: `http://127.0.0.1:${String(PORTAL_PORT)}` },
    },
  ],
});
