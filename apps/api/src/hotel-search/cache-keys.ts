/**
 * Cache key construction (issue #61) — pure functions, property-tested.
 *
 * Availability keys are EXACTLY (tenant, supplier, canonical target,
 * checkIn, checkOut, occupancy signature, NATIONALITY):
 *
 * - TENANT-SCOPED: tenants share nothing, not even a hot cache line — a key
 *   without the tenant would leak one tenant's supplier answers to another.
 * - NATIONALITY IS NEVER DROPPED: GCC rates vary by guest nationality
 *   (CLAUDE.md rule 9); a key without it would serve one nationality's
 *   availability and prices to another.
 *
 * Injectivity is by construction, not by convention: every key is a fixed
 * prefix + the JSON encoding of the component ARRAY, so no component can
 * bleed into its neighbor no matter what characters it contains (JSON
 * escapes them). Distinct canonical inputs therefore always yield distinct
 * keys; the property tests pin this.
 *
 * Occupancy and property lists are canonicalized (sorted) first: the same
 * stay asked with rooms or hotel ids in a different order is the same
 * search, and should hit the same entry.
 */

import type { TenantId } from "@jenova/domain";
import type { HotelSearchTarget, RoomOccupancy } from "@jenova/supplier-sdk";

const AVAILABILITY_PREFIX = "jenova:hotel-avail:v1:";
const STATIC_PREFIX = "jenova:supplier-static:v1:";

/** Canonical occupancy signature: ages sorted within rooms, rooms sorted. */
export function occupancySignature(
  rooms: readonly RoomOccupancy[],
): readonly (readonly [number, readonly number[]])[] {
  return rooms
    .map((room): readonly [number, readonly number[]] => [
      room.adults,
      [...room.childAges].sort((a, b) => a - b),
    ])
    .sort((a, b) => {
      if (a[0] !== b[0]) return a[0] - b[0];
      const [, agesA] = a;
      const [, agesB] = b;
      if (agesA.length !== agesB.length) return agesA.length - agesB.length;
      for (let i = 0; i < agesA.length; i += 1) {
        const ageA = agesA[i] ?? 0;
        const ageB = agesB[i] ?? 0;
        if (ageA !== ageB) return ageA - ageB;
      }
      return 0;
    });
}

/** Canonical target signature: kind-tagged; property id ORDER is irrelevant. */
export function targetSignature(
  target: HotelSearchTarget,
): readonly [string, readonly string[]] {
  return target.kind === "properties"
    ? ["properties", [...target.canonicalPropertyIds].sort()]
    : ["location", [target.canonicalLocationId]];
}

export interface AvailabilityKeyInput {
  readonly tenant: TenantId;
  readonly supplierCode: string;
  readonly target: HotelSearchTarget;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly rooms: readonly RoomOccupancy[];
  readonly nationality: string;
}

export function availabilityCacheKey(input: AvailabilityKeyInput): string {
  return (
    AVAILABILITY_PREFIX +
    JSON.stringify([
      input.tenant,
      input.supplierCode,
      targetSignature(input.target),
      input.checkIn,
      input.checkOut,
      occupancySignature(input.rooms),
      input.nationality,
    ])
  );
}

/**
 * Static supplier content (CountryList / CityList / HotelDetails class of
 * data). Tenant-scoped too: content is fetched on the tenant's own supplier
 * account, and account-dependent visibility must never cross tenants.
 */
export function staticContentCacheKey(
  tenant: TenantId,
  supplierCode: string,
  resource: string,
  params: readonly string[],
): string {
  return STATIC_PREFIX + JSON.stringify([tenant, supplierCode, resource, params]);
}
