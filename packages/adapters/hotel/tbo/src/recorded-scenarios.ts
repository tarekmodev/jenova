/**
 * The scenario inputs behind the committed recordings in
 * packages/sandbox-replay/recordings/tbo — shared by the contract/unit tests
 * (replay) and tools/record.ts (re-recording), so both always speak the same
 * request fingerprint.
 *
 * Provenance (CLAUDE.md rule 5 — nothing invented): hotel codes come from
 * the live TBOHotelCodeList recording for Riyadh (CityList "SA" →
 * city 147536), captured 2026-08-30. Dates are the recorded stay window.
 * Re-recording (weekly drift job, or after supplier changes) may need fresh
 * dates: update here, run `pnpm record search`, commit both.
 */

import type { HotelSearchQuery } from "@jenova/supplier-sdk";

/** Riyadh hotel codes drawn from the recorded TBOHotelCodeList response. */
export const RECORDED_RIYADH_HOTEL_CODES = [
  "1010062",
  "1032860",
  "1037420",
  "1065918",
  "1065929",
  "1065933",
  "1065937",
  "1065954",
  "1077182",
  "1087447",
] as const;

export const RECORDED_SEARCH_QUERY: HotelSearchQuery = {
  target: {
    kind: "properties",
    canonicalPropertyIds: RECORDED_RIYADH_HOTEL_CODES.map((code) => `tbo:${code}`),
  },
  checkIn: "2026-10-13",
  checkOut: "2026-10-14",
  rooms: [{ adults: 1, childAges: [] }],
};
