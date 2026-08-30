/**
 * Static supplier-content cache (issue #61): long-TTL memoization for the
 * slow-moving content class of supplier data — country lists, city lists,
 * hotel details (TBO: CountryList / CityList / HotelDetails; every supplier
 * has an equivalent).
 *
 * Generic by design: at M1 no engine surface serves supplier content yet
 * (the M3 mapping service and content surfaces are its consumers); this is
 * the designated read-through so those loaders never hammer supplier
 * content endpoints — look-to-book budgets are commercial obligations
 * (docs/05). Values are the loader's own JSON-serializable canonical
 * shapes, validated by the caller's schema on the way OUT of the cache; an
 * unreadable entry falls through to the loader.
 */

import type { z } from "zod";
import type { TenantId } from "@jenova/domain";
import { staticContentCacheKey } from "./cache-keys";
import type { SearchCache } from "./cache";

/** Nest injection token for the process-wide {@link StaticContentCache}. */
export const STATIC_CONTENT_CACHE = Symbol("jenova.api.staticContentCache");

/** Long by design: static content moves in days, not seconds. */
export const DEFAULT_STATIC_TTL_SECONDS = 24 * 60 * 60;
export const MIN_STATIC_TTL_SECONDS = 60;
export const MAX_STATIC_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface StaticContentLookup {
  readonly tenant: TenantId;
  readonly supplierCode: string;
  /** Content resource name, e.g. "country-list", "city-list", "hotel-details". */
  readonly resource: string;
  /** Discriminating parameters, e.g. a country code or hotel code. */
  readonly params: readonly string[];
}

export class StaticContentCache {
  private readonly ttlSeconds: number;

  constructor(private readonly cache: SearchCache, ttlSeconds: number = DEFAULT_STATIC_TTL_SECONDS) {
    this.ttlSeconds = Math.min(
      MAX_STATIC_TTL_SECONDS,
      Math.max(MIN_STATIC_TTL_SECONDS, Math.trunc(ttlSeconds)),
    );
  }

  /**
   * Read-through: cached value when present and valid per `schema`,
   * otherwise `loader()` — whose result is cached best-effort and returned.
   */
  async getOrLoad<T>(
    lookup: StaticContentLookup,
    schema: z.ZodType<T>,
    loader: () => Promise<T>,
  ): Promise<T> {
    const key = staticContentCacheKey(
      lookup.tenant,
      lookup.supplierCode,
      lookup.resource,
      lookup.params,
    );
    try {
      const raw = await this.cache.get(key);
      if (raw !== null) {
        const validated = schema.safeParse(JSON.parse(raw));
        if (validated.success) {
          return validated.data;
        }
      }
    } catch {
      // Cache trouble is a miss — fall through to the loader.
    }
    const loaded = await loader();
    try {
      await this.cache.set(key, JSON.stringify(loaded), this.ttlSeconds);
    } catch {
      // Losing the write only costs a reload later.
    }
    return loaded;
  }
}
