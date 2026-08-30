/**
 * Thin cache port for the search layer (issue #61).
 *
 * Correctness NEVER lives here: everything cached is re-derivable (supplier
 * availability, static content), every entry has a TTL, and every consumer
 * treats a cache failure as a miss. Redis (REDIS_URL, docker-compose) backs
 * production; the in-memory implementation backs unit tests with a clock
 * seam.
 */

import { Redis } from "ioredis";

/** Nest injection token for the process-wide {@link SearchCache}. */
export const SEARCH_CACHE = Symbol("jenova.api.searchCache");

export interface SearchCache {
  /** null = miss. Implementations may reject; consumers treat that as a miss. */
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

interface InMemoryEntry {
  readonly value: string;
  readonly expiresAtMs: number;
}

/** Per-process cache for tests and pre-Redis boot; TTL via the clock seam. */
export class InMemorySearchCache implements SearchCache {
  private readonly entries = new Map<string, InMemoryEntry>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return Promise.resolve(null);
    }
    if (this.now().getTime() >= entry.expiresAtMs) {
      this.entries.delete(key);
      return Promise.resolve(null);
    }
    return Promise.resolve(entry.value);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) {
      return Promise.reject(new Error("cache ttlSeconds must be positive"));
    }
    this.entries.set(key, {
      value,
      expiresAtMs: this.now().getTime() + ttlSeconds * 1_000,
    });
    return Promise.resolve();
  }

  /** Test hook. */
  size(): number {
    return this.entries.size;
  }
}

/**
 * Redis-backed cache. Deliberately failure-eager: no offline queue and
 * bounded retries, so a down Redis rejects fast and consumers fall through
 * to the supplier instead of hanging inside the search budget.
 */
export class RedisSearchCache implements SearchCache {
  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 200, 2_000),
    });
    // Connection errors surface per-call as rejections; without a listener
    // ioredis would treat them as unhandled 'error' events.
    this.redis.on("error", () => {});
  }

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) {
      throw new Error("cache ttlSeconds must be positive");
    }
    await this.redis.set(key, value, "EX", Math.trunc(ttlSeconds));
  }

  async close(): Promise<void> {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
