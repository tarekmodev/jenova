/**
 * Availability cache (issue #61): short-TTL memoization of one supplier's
 * CANONICAL search answer per (tenant, supplier, target, dates, occupancy,
 * nationality) — the key shape docs/02 mandates, nationality included
 * because GCC rates vary by it (CLAUDE.md rule 9).
 *
 * What is cached is the adapter's normalized HotelOffer[] — the supplier
 * NET side of the answer, never a price a client could book:
 *
 * - CACHED ENTRIES ARE STILL RE-PRICED AND RE-ISSUED. Markup rules, offer
 *   TTLs and pricing scope may change between two searches that share an
 *   availability window, so the orchestrator runs every hit through the
 *   pricing engine and OffersService again — a cache hit saves the supplier
 *   round-trip (look-to-book, docs/05), never the server-pricing step, and
 *   each requester gets fresh signed offers (CLAUDE.md rule 8).
 * - TTL is deliberately SHORT (seconds to low minutes, clamped): rates and
 *   allotments move; the mandatory `check` before booking re-validates
 *   against the supplier regardless.
 * - Best-effort by contract: a cache failure (Redis down, corrupt entry)
 *   reads as a miss and never fails a search lane.
 */

import { z } from "zod";
import type { TenantId } from "@jenova/domain";
import { BOARD_BASES, type HotelOffer, type HotelSearchQuery } from "@jenova/supplier-sdk";
import { availabilityCacheKey } from "./cache-keys";
import type { SearchCache } from "./cache";

/** Nest injection token for the process-wide {@link AvailabilityCache}. */
export const AVAILABILITY_CACHE = Symbol("jenova.api.availabilityCache");
/** Nest injection token for the {@link SearchCacheTtlSource}. */
export const SEARCH_CACHE_TTL_SOURCE = Symbol("jenova.api.searchCacheTtlSource");

/** Short by design: seconds to low minutes, hard-clamped. */
export const DEFAULT_AVAILABILITY_TTL_SECONDS = 90;
export const MIN_AVAILABILITY_TTL_SECONDS = 5;
export const MAX_AVAILABILITY_TTL_SECONDS = 300;

/**
 * Where a tenant's availability TTL comes from. Per-tenant commercial
 * settings bind here when the tenant-settings surface lands; values are
 * clamped regardless of source — no configuration can mint a stale-rate
 * window beyond the platform bound.
 */
export interface SearchCacheTtlSource {
  availabilityTtlSeconds(tenant: TenantId): Promise<number>;
}

export class FixedSearchCacheTtlSource implements SearchCacheTtlSource {
  constructor(private readonly seconds: number = DEFAULT_AVAILABILITY_TTL_SECONDS) {}

  availabilityTtlSeconds(): Promise<number> {
    return Promise.resolve(this.seconds);
  }
}

// Serialization schema for the CANONICAL HotelOffer shape (rule 5: these
// are round-trips of real recorded/live supplier answers already normalized
// by an adapter — nothing here fabricates supplier data). A cached blob
// that fails validation is discarded as a miss.
const moneySchema = z.object({
  amount: z.number().int(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
const cancellationRuleSchema = z.object({
  fromUtc: z.string(),
  penalty: moneySchema,
});
const cancellationPolicySchema = z.object({
  refundable: z.boolean(),
  rules: z.array(cancellationRuleSchema),
});
const hotelOfferSchema = z.object({
  supplierOfferToken: z.string().min(1),
  canonicalPropertyId: z.string().min(1),
  supplierRoomName: z.string(),
  boardBasis: z.enum(BOARD_BASES),
  net: moneySchema,
  cancellationPolicy: cancellationPolicySchema,
  nationalityApplied: z.string().regex(/^[A-Z]{2}$/),
});
const cachedAvailabilitySchema = z.object({
  v: z.literal(1),
  offers: z.array(hotelOfferSchema),
});

export interface AvailabilityLookup {
  readonly supplierCode: string;
  readonly query: HotelSearchQuery;
  readonly nationality: string;
}

export class AvailabilityCache {
  constructor(
    private readonly cache: SearchCache,
    private readonly ttlSource: SearchCacheTtlSource,
  ) {}

  private keyFor(tenant: TenantId, lookup: AvailabilityLookup): string {
    return availabilityCacheKey({
      tenant,
      supplierCode: lookup.supplierCode,
      target: lookup.query.target,
      checkIn: lookup.query.checkIn,
      checkOut: lookup.query.checkOut,
      rooms: lookup.query.rooms,
      nationality: lookup.nationality,
    });
  }

  /** null = miss (absent, expired, unreadable, or structurally invalid). */
  async get(tenant: TenantId, lookup: AvailabilityLookup): Promise<readonly HotelOffer[] | null> {
    let raw: string | null;
    try {
      raw = await this.cache.get(this.keyFor(tenant, lookup));
    } catch {
      return null; // best-effort: cache trouble is a miss, never a failure
    }
    if (raw === null) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const validated = cachedAvailabilitySchema.safeParse(parsed);
    return validated.success ? validated.data.offers : null;
  }

  /** Best-effort write; never throws into a search lane. */
  async put(
    tenant: TenantId,
    lookup: AvailabilityLookup,
    offers: readonly HotelOffer[],
  ): Promise<void> {
    try {
      const configured = await this.ttlSource.availabilityTtlSeconds(tenant);
      const ttl = Math.min(
        MAX_AVAILABILITY_TTL_SECONDS,
        Math.max(MIN_AVAILABILITY_TTL_SECONDS, Math.trunc(configured)),
      );
      await this.cache.set(
        this.keyFor(tenant, lookup),
        JSON.stringify({ v: 1, offers }),
        ttl,
      );
    } catch {
      // Losing a cache write costs one extra supplier call later — nothing else.
    }
  }
}
