/**
 * Screenshot harness config: serves the STATIC Storybook build (built
 * once — CI budget) and snapshots every story in BOTH directions.
 */

import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.SB_PORT ?? 6106);

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? [["list"]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: "node serve.mjs",
    port: PORT,
    reuseExistingServer: true,
  },
});
