import { defineConfig } from "vitest/config";

/**
 * The *.spec.ts files here are PLAYWRIGHT suites (run via `pnpm e2e`);
 * vitest must not collect them. Unit-testable harness helpers would live in
 * *.test.ts files, which vitest picks up as usual.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
