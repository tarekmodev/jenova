import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests only — screenshots/*.spec.ts belongs to the Playwright
    // harness (pnpm test:screenshots), not Vitest.
    include: ["src/**/*.test.ts"],
  },
});
