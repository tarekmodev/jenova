/**
 * Vocabulary-drift observability (review M1): unmappable rooms are skipped,
 * never mislabeled — and never silently. No recorded response carries an
 * unmapped meal type (proven below against the real search recording), so
 * the skip path is driven with a minimal structural mapper input
 * (adapter-internal, not a supplier recording).
 */

import { describe, expect, it } from "vitest";
import { createSkippedRoomRateLog } from "./diagnostics";
import { mapHotelRooms, type SkippedRoomRateEvent } from "./mapping";
import type { TboHotelResult } from "./schemas";
import { createTboHotelAdapter } from "./adapter";
import { RECORDED_SEARCH_QUERY } from "./recorded-scenarios";
import { makeTestContext } from "./test-context";
import { createTboTransport } from "./transport";

/** Minimal structural mapper input — exercises the skip path only. */
const STRUCTURAL_HOTEL: TboHotelResult = {
  HotelCode: "0",
  Currency: "USD",
  Rooms: [
    {
      Name: ["structural"],
      BookingCode: "structural",
      TotalFare: 1,
      MealType: "Structural_Unmapped_Vocabulary",
      IsRefundable: false,
    },
  ],
};

describe("skipped-room vocabulary drift is visible", () => {
  it("mapHotelRooms reports each skipped room with the raw value, no payload", () => {
    const events: SkippedRoomRateEvent[] = [];
    const offers = mapHotelRooms(STRUCTURAL_HOTEL, "SA", (event) => events.push(event));
    expect(offers).toEqual([]);
    expect(events).toEqual([
      {
        supplierCode: "tbo",
        hotelCode: "0",
        field: "MealType",
        rawValue: "Structural_Unmapped_Vocabulary",
      },
    ]);
  });

  it("createSkippedRoomRateLog counts every occurrence but warns once per value", () => {
    const lines: string[] = [];
    const log = createSkippedRoomRateLog((line) => lines.push(line));
    const event: SkippedRoomRateEvent = {
      supplierCode: "tbo",
      hotelCode: "0",
      field: "MealType",
      rawValue: "Structural_Unmapped_Vocabulary",
    };
    log.observer(event);
    log.observer(event);
    log.observer({ ...event, rawValue: "Structural_Other" });
    expect(log.total()).toBe(3);
    expect(log.counts().get("MealType:Structural_Unmapped_Vocabulary")).toBe(2);
    expect(log.counts().get("MealType:Structural_Other")).toBe(1);
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(first["msg"]).toBe("supplier_vocabulary_drift");
    expect(first["supplier"]).toBe("tbo");
    expect(first["rawValue"]).toBe("Structural_Unmapped_Vocabulary");
  });

  it("the recorded live search skips nothing — every real meal type maps", async () => {
    const events: SkippedRoomRateEvent[] = [];
    const adapter = createTboHotelAdapter({
      transport: createTboTransport({ mode: "replay" }),
      onSkippedRoomRate: (event) => events.push(event),
    });
    const offers = await adapter.search(makeTestContext(), RECORDED_SEARCH_QUERY);
    expect(offers.length).toBeGreaterThan(0);
    expect(events).toEqual([]);
  });
});
