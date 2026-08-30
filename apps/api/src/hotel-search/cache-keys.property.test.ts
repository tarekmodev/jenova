/**
 * Cache key property tests (issue #61): the availability key is injective
 * over its canonical inputs, tenant-scoped, and NEVER drops nationality —
 * GCC rates vary by nationality (CLAUDE.md rule 9), so two nationalities
 * must never share an entry. Pure key construction over arbitrary
 * structural values (fast-check) — no supplier data involved.
 */

import fc from "fast-check";
import { tenantId } from "@jenova/domain";
import type { HotelSearchTarget, RoomOccupancy } from "@jenova/supplier-sdk";
import { describe, expect, it } from "vitest";
import {
  availabilityCacheKey,
  occupancySignature,
  staticContentCacheKey,
  targetSignature,
  type AvailabilityKeyInput,
} from "./cache-keys";

const idText = fc.stringMatching(/^[\x20-\x7e؀-ۿ]{1,24}$/);
const isoDate = fc
  .record({
    y: fc.integer({ min: 2026, max: 2030 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ y, m, d }) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
const nationality = fc.stringMatching(/^[A-Z]{2}$/);

const room: fc.Arbitrary<RoomOccupancy> = fc.record({
  adults: fc.integer({ min: 1, max: 9 }),
  childAges: fc.array(fc.integer({ min: 0, max: 17 }), { maxLength: 6 }),
});

const target: fc.Arbitrary<HotelSearchTarget> = fc.oneof(
  fc.record({
    kind: fc.constant("properties" as const),
    canonicalPropertyIds: fc.uniqueArray(idText, { minLength: 1, maxLength: 10 }),
  }),
  fc.record({
    kind: fc.constant("location" as const),
    canonicalLocationId: idText,
  }),
);

const keyInput: fc.Arbitrary<AvailabilityKeyInput> = fc.record({
  tenant: idText.map((s) => tenantId(`t-${s.replace(/[^a-z0-9]/gi, "x")}`)),
  supplierCode: idText,
  target,
  checkIn: isoDate,
  checkOut: isoDate,
  rooms: fc.array(room, { minLength: 1, maxLength: 9 }),
  nationality,
});

/** Canonical identity of one input — two inputs are "the same search" iff equal. */
function canonicalIdentity(input: AvailabilityKeyInput): string {
  return JSON.stringify([
    input.tenant,
    input.supplierCode,
    targetSignature(input.target),
    input.checkIn,
    input.checkOut,
    occupancySignature(input.rooms),
    input.nationality,
  ]);
}

describe("availabilityCacheKey — injectivity", () => {
  it("two inputs share a key IFF they are the same canonical search", () => {
    fc.assert(
      fc.property(keyInput, keyInput, (a, b) => {
        const sameKey = availabilityCacheKey(a) === availabilityCacheKey(b);
        const sameSearch = canonicalIdentity(a) === canonicalIdentity(b);
        expect(sameKey).toBe(sameSearch);
      }),
      { numRuns: 500 },
    );
  });

  it("changing ONLY the nationality always changes the key (rule 9)", () => {
    fc.assert(
      fc.property(keyInput, nationality, (input, otherNationality) => {
        fc.pre(otherNationality !== input.nationality);
        expect(availabilityCacheKey({ ...input, nationality: otherNationality })).not.toBe(
          availabilityCacheKey(input),
        );
      }),
      { numRuns: 300 },
    );
  });

  it("changing ONLY the tenant always changes the key (tenant-scoped)", () => {
    fc.assert(
      fc.property(keyInput, fc.stringMatching(/^[a-z0-9]{1,16}$/), (input, slug) => {
        const otherTenant = tenantId(`t2-${slug}`);
        fc.pre(otherTenant !== input.tenant);
        expect(availabilityCacheKey({ ...input, tenant: otherTenant })).not.toBe(
          availabilityCacheKey(input),
        );
      }),
      { numRuns: 300 },
    );
  });

  it("every key literally carries tenant and nationality (never dropped)", () => {
    fc.assert(
      fc.property(keyInput, (input) => {
        const key = availabilityCacheKey(input);
        const components = JSON.parse(key.slice(key.indexOf(":[") + 1)) as unknown[];
        expect(components[0]).toBe(input.tenant);
        expect(components[components.length - 1]).toBe(input.nationality);
      }),
      { numRuns: 200 },
    );
  });

  it("hostile component values cannot collide across field boundaries", () => {
    // Delimiter-injection probe: JSON encoding escapes everything, so
    // moving characters between adjacent fields must change the key.
    const a = availabilityCacheKey({
      tenant: tenantId("t-a"),
      supplierCode: 'sup","x',
      target: { kind: "location", canonicalLocationId: "loc" },
      checkIn: "2026-10-13",
      checkOut: "2026-10-14",
      rooms: [{ adults: 1, childAges: [] }],
      nationality: "SA",
    });
    const b = availabilityCacheKey({
      tenant: tenantId("t-a"),
      supplierCode: "sup",
      target: { kind: "location", canonicalLocationId: '","x","loc' },
      checkIn: "2026-10-13",
      checkOut: "2026-10-14",
      rooms: [{ adults: 1, childAges: [] }],
      nationality: "SA",
    });
    expect(a).not.toBe(b);
  });
});

describe("canonicalization — same search, same key", () => {
  it("room order and child-age order do not change the key", () => {
    fc.assert(
      fc.property(keyInput, (input) => {
        const shuffledRooms = [...input.rooms].reverse().map((r) => ({
          adults: r.adults,
          childAges: [...r.childAges].reverse(),
        }));
        expect(availabilityCacheKey({ ...input, rooms: shuffledRooms })).toBe(
          availabilityCacheKey(input),
        );
      }),
      { numRuns: 200 },
    );
  });

  it("property id order does not change the key", () => {
    fc.assert(
      fc.property(keyInput, (input) => {
        if (input.target.kind !== "properties") return;
        const shuffled: HotelSearchTarget = {
          kind: "properties",
          canonicalPropertyIds: [...input.target.canonicalPropertyIds].reverse(),
        };
        expect(availabilityCacheKey({ ...input, target: shuffled })).toBe(
          availabilityCacheKey(input),
        );
      }),
      { numRuns: 200 },
    );
  });

  it("a properties target never collides with a location target", () => {
    fc.assert(
      fc.property(keyInput, idText, (input, id) => {
        const asProperties: HotelSearchTarget = { kind: "properties", canonicalPropertyIds: [id] };
        const asLocation: HotelSearchTarget = { kind: "location", canonicalLocationId: id };
        expect(availabilityCacheKey({ ...input, target: asProperties })).not.toBe(
          availabilityCacheKey({ ...input, target: asLocation }),
        );
      }),
      { numRuns: 200 },
    );
  });
});

describe("staticContentCacheKey", () => {
  it("is tenant- and supplier-scoped and injective over resource/params", () => {
    fc.assert(
      fc.property(
        idText,
        idText,
        fc.array(idText, { maxLength: 4 }),
        idText,
        fc.array(idText, { maxLength: 4 }),
        (supplier, resourceA, paramsA, resourceB, paramsB) => {
          const t = tenantId("t-static");
          const keyA = staticContentCacheKey(t, supplier, resourceA, paramsA);
          const keyB = staticContentCacheKey(t, supplier, resourceB, paramsB);
          const same = resourceA === resourceB && JSON.stringify(paramsA) === JSON.stringify(paramsB);
          expect(keyA === keyB).toBe(same);
          expect(keyA).not.toBe(
            staticContentCacheKey(tenantId("t-other"), supplier, resourceA, paramsA),
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});
