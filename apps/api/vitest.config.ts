import { defineConfig } from "vitest/config";

// NestJS uses legacy (experimental) decorators; vitest's transformer honors
// experimentalDecorators from this package's tsconfig but can NEVER emit
// decorator metadata. The api therefore relies on explicit @Inject(token)
// everywhere and never on emitDecoratorMetadata — keep it that way (tsx dev
// runs share the same constraint).
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["reflect-metadata"],
  },
});
