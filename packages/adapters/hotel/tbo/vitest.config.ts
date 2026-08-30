import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Replay tests are instant; the LIVE pre-certification run (search fans
    // out, Book/Cancel mutate supplier state) needs a real network budget —
    // vitest's 5s default aborted a live Book mid-flight once, which the
    // supplier then completed anyway (orphaned reservation).
    testTimeout: 60_000,
  },
});
