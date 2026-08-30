/**
 * Availability + static-content cache unit tests (issue #61) over the
 * in-memory cache port implementation.
 *
 * Cached values are STRUCTURAL canonical shapes the tests construct
 * (CLAUDE.md rule 5: this exercises the caching mechanism, not supplier
 * behavior — real supplier answers flow through the replay-backed SSE
 * integration and the recorded live run).
 */

import { z } from "zod";
import { money, tenantId, type TenantId } from "@jenova/domain";
import type { HotelOffer, HotelSearchQuery } from "@jenova/supplier-sdk";
import { describe, expect, it } from "vitest";
import {
  AvailabilityCache,
  FixedSearchCacheTtlSource,
  MAX_AVAILABILITY_TTL_SECONDS,
} from "./availability-cache";
import { InMemorySearchCache } from "./cache";
import { StaticContentCache } from "./static-content-cache";

const TENANT: TenantId = tenantId("tenant-cache");
const OTHER_TENANT: TenantId = tenantId("tenant-other");
const T0 = Date.parse("2026-08-30T10:00:00.000Z");

const QUERY: HotelSearchQuery = {
  target: { kind: "properties", canonicalPropertyIds: ["prop-1"] },
  checkIn: "2026-10-13",
  checkOut: "2026-10-14",
  rooms: [{ adults: 2, childAges: [4] }],
};

const OFFER: HotelOffer = {
  supplierOfferToken: "opaque-1",
  canonicalPropertyId: "prop-1",
  supplierRoomName: "room-1",
  boardBasis: "RO",
  net: money(50_000, "SAR"),
  cancellationPolicy: {
    refundable: true,
    rules: [{ fromUtc: "2026-10-01T00:00:00.000Z", penalty: money(10_000, "SAR") }],
  },
  nationalityApplied: "SA",
};

function makeCaches(ttlSeconds = 90) {
  const clock = { now: T0 };
  const store = new InMemorySearchCache(() => new Date(clock.now));
  const availability = new AvailabilityCache(store, new FixedSearchCacheTtlSource(ttlSeconds));
  return { clock, store, availability };
}

describe("AvailabilityCache", () => {
  it("round-trips a canonical availability answer within the TTL", async () => {
    const { availability } = makeCaches();
    const lookup = { supplierCode: "sup-a", query: QUERY, nationality: "SA" };
    expect(await availability.get(TENANT, lookup)).toBeNull();
    await availability.put(TENANT, lookup, [OFFER]);
    expect(await availability.get(TENANT, lookup)).toEqual([OFFER]);
  });

  it("expires after the configured short TTL", async () => {
    const { clock, availability } = makeCaches(60);
    const lookup = { supplierCode: "sup-a", query: QUERY, nationality: "SA" };
    await availability.put(TENANT, lookup, [OFFER]);
    clock.now = T0 + 59_000;
    expect(await availability.get(TENANT, lookup)).toEqual([OFFER]);
    clock.now = T0 + 61_000;
    expect(await availability.get(TENANT, lookup)).toBeNull();
  });

  it("clamps any configured TTL to the platform maximum (short by design)", async () => {
    const { clock, availability } = makeCaches(24 * 60 * 60);
    const lookup = { supplierCode: "sup-a", query: QUERY, nationality: "SA" };
    await availability.put(TENANT, lookup, [OFFER]);
    clock.now = T0 + (MAX_AVAILABILITY_TTL_SECONDS + 1) * 1_000;
    expect(await availability.get(TENANT, lookup)).toBeNull();
  });

  it("never serves across nationality or tenant (rule 9 + tenancy)", async () => {
    const { availability } = makeCaches();
    const saLookup = { supplierCode: "sup-a", query: QUERY, nationality: "SA" };
    await availability.put(TENANT, saLookup, [OFFER]);
    expect(
      await availability.get(TENANT, { ...saLookup, nationality: "AE" }),
    ).toBeNull();
    expect(await availability.get(OTHER_TENANT, saLookup)).toBeNull();
  });

  it("treats a corrupt or structurally invalid entry as a miss", async () => {
    const { store, availability } = makeCaches();
    const lookup = { supplierCode: "sup-a", query: QUERY, nationality: "SA" };
    await availability.put(TENANT, lookup, [OFFER]);
    // Overwrite the stored blob out of band (simulates at-rest corruption).
    let hit = false;
    const probe = new AvailabilityCache(
      {
        get: async (key) => {
          hit = true;
          await store.set(key, "{not json", 60);
          return store.get(key);
        },
        set: (key, value, ttl) => store.set(key, value, ttl),
      },
      new FixedSearchCacheTtlSource(),
    );
    expect(await probe.get(TENANT, lookup)).toBeNull();
    expect(hit).toBe(true);
  });

  it("degrades a failing cache backend to a miss / a dropped write", async () => {
    const broken = new AvailabilityCache(
      {
        get: () => Promise.reject(new Error("redis down")),
        set: () => Promise.reject(new Error("redis down")),
      },
      new FixedSearchCacheTtlSource(),
    );
    const lookup = { supplierCode: "sup-a", query: QUERY, nationality: "SA" };
    await expect(broken.get(TENANT, lookup)).resolves.toBeNull();
    await expect(broken.put(TENANT, lookup, [OFFER])).resolves.toBeUndefined();
  });
});

describe("StaticContentCache", () => {
  const schema = z.array(z.object({ code: z.string(), name: z.string() }));

  it("loads once, then serves reads for the long TTL, per (tenant, supplier, resource, params)", async () => {
    const clock = { now: T0 };
    const store = new InMemorySearchCache(() => new Date(clock.now));
    const cache = new StaticContentCache(store);
    let loads = 0;
    const loader = () => {
      loads += 1;
      return Promise.resolve([{ code: "SA", name: "Saudi Arabia" }]);
    };
    const lookup = { tenant: TENANT, supplierCode: "sup-a", resource: "country-list", params: [] };

    expect(await cache.getOrLoad(lookup, schema, loader)).toEqual([
      { code: "SA", name: "Saudi Arabia" },
    ]);
    await cache.getOrLoad(lookup, schema, loader);
    expect(loads).toBe(1);

    // Distinct params and tenants are distinct entries.
    await cache.getOrLoad({ ...lookup, params: ["SA"] }, schema, loader);
    await cache.getOrLoad({ ...lookup, tenant: OTHER_TENANT }, schema, loader);
    expect(loads).toBe(3);

    // Long TTL: still cached hours later, reloaded after expiry.
    clock.now = T0 + 23 * 60 * 60 * 1_000;
    await cache.getOrLoad(lookup, schema, loader);
    expect(loads).toBe(3);
    clock.now = T0 + 25 * 60 * 60 * 1_000;
    await cache.getOrLoad(lookup, schema, loader);
    expect(loads).toBe(4);
  });

  it("falls back to the loader when the backend fails or the entry is invalid", async () => {
    const cache = new StaticContentCache({
      get: () => Promise.reject(new Error("redis down")),
      set: () => Promise.reject(new Error("redis down")),
    });
    let loads = 0;
    const value = await cache.getOrLoad(
      { tenant: TENANT, supplierCode: "sup-a", resource: "city-list", params: ["SA"] },
      schema,
      () => {
        loads += 1;
        return Promise.resolve([{ code: "147536", name: "Riyadh" }]);
      },
    );
    expect(value).toEqual([{ code: "147536", name: "Riyadh" }]);
    expect(loads).toBe(1);
  });
});
