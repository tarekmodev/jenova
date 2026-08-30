import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests create/drop real databases; CREATE DATABASE serializes
    // on the template lock, so files must not race each other.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
