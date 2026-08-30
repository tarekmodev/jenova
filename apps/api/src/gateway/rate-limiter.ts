/**
 * Rate-limit hook seam (issue #31, stage 4). No-op at M0 — per-realm and
 * per-key limits (docs/08-security.md) land with real limits in redis; the
 * stage position in the chain and this contract are final.
 */

import type { RequestContext } from "./request-context";

export interface RateLimiter {
  /** Resolves to admit the request; throws (429 ApiHttpError) to refuse it. */
  check(context: RequestContext): Promise<void>;
}

/** Nest injection token for the process-wide {@link RateLimiter}. */
export const RATE_LIMITER = Symbol("jenova.api.rateLimiter");

export class NoopRateLimiter implements RateLimiter {
  check(): Promise<void> {
    return Promise.resolve();
  }
}
