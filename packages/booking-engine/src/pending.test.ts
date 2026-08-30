/** Pure backoff math for the pending poller (issue #68). */

import { describe, expect, it } from "vitest";
import { backoffDelayMs, DEFAULT_PENDING_BACKOFF } from "./pending";

describe("pending poll backoff", () => {
  it("grows exponentially from the base", () => {
    expect(backoffDelayMs(DEFAULT_PENDING_BACKOFF, 0)).toBe(30_000);
    expect(backoffDelayMs(DEFAULT_PENDING_BACKOFF, 1)).toBe(60_000);
    expect(backoffDelayMs(DEFAULT_PENDING_BACKOFF, 2)).toBe(120_000);
  });

  it("caps at the ceiling", () => {
    expect(backoffDelayMs(DEFAULT_PENDING_BACKOFF, 10)).toBe(600_000);
    expect(backoffDelayMs(DEFAULT_PENDING_BACKOFF, 50)).toBe(600_000);
  });

  it("treats negative attempt counts as the first attempt", () => {
    expect(backoffDelayMs(DEFAULT_PENDING_BACKOFF, -3)).toBe(30_000);
  });
});
