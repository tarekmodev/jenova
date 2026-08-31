import { defineConfig } from "vitest/config";

// Playwright owns tests/ (dashboard.spec.ts runs via `pnpm test:e2e`);
// vitest must not pick the .spec.ts up under the workspace `test` task.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
