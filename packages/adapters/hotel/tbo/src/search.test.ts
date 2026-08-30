/**
 * search mapping over the committed live-sandbox recording (Riyadh,
 * 2026-10-13 → 2026-10-14, 1 adult, SA nationality). Replay resolves the
 * exact request the adapter builds — a drifting request shape breaks the
 * fingerprint and fails loudly here.
 */

import { describe, expect, it } from "vitest";
import { money } from "@jenova/domain";
import { assertHotelOffer } from "@jenova/supplier-sdk/testing";
import { createTboHotelAdapter } from "./adapter";
import { RECORDED_SEARCH_QUERY } from "./recorded-scenarios";
import { makeTestContext } from "./test-context";
import { createTboTransport } from "./transport";

function makeAdapter() {
  return createTboHotelAdapter({ transport: createTboTransport({ mode: "replay" }) });
}

describe("TBO search → canonical HotelOffer[]", () => {
  it("maps every recorded room rate into a valid canonical offer", async () => {
    const ctx = makeTestContext();
    const offers = await makeAdapter().search(ctx, RECORDED_SEARCH_QUERY);
    expect(offers.length).toBeGreaterThan(0);
    for (const offer of offers) {
      assertHotelOffer(offer, ctx);
      expect(offer.canonicalPropertyId.startsWith("tbo:")).toBe(true);
      expect(offer.nationalityApplied).toBe("SA");
    }
  });

  it("normalizes the recorded refundable Studio rate exactly (money, policy, board basis)", async () => {
    const ctx = makeTestContext();
    const offers = await makeAdapter().search(ctx, RECORDED_SEARCH_QUERY);
    // Hotel 1065918, "Studio,2 Twin Beds": TotalFare 139.73 USD, free
    // cancellation until 11-10-2026 (TBO clock), then 100%.
    const studio = offers.find(
      (offer) =>
        offer.canonicalPropertyId === "tbo:1065918" &&
        offer.supplierRoomName === "Studio,2 Twin Beds",
    );
    expect(studio).toBeDefined();
    expect(studio?.net).toEqual(money(13973, "USD"));
    expect(studio?.boardBasis).toBe("RO");
    expect(studio?.cancellationPolicy.refundable).toBe(true);
    expect(studio?.cancellationPolicy.rules).toEqual([
      { fromUtc: "2026-08-28T18:30:00.000Z", penalty: money(0, "USD") },
      { fromUtc: "2026-10-10T18:30:00.000Z", penalty: money(13973, "USD") },
    ]);
  });

  it("maps recorded breakfast rates to BB with the supplier's own room name kept", async () => {
    const ctx = makeTestContext();
    const offers = await makeAdapter().search(ctx, RECORDED_SEARCH_QUERY);
    const breakfast = offers.filter((offer) => offer.boardBasis === "BB");
    expect(breakfast.length).toBeGreaterThan(0);
    for (const offer of breakfast) {
      expect(offer.supplierRoomName.length).toBeGreaterThan(0);
    }
  });

  it("refuses location targets until the M3 mapping service lands", async () => {
    const ctx = makeTestContext();
    await expect(
      makeAdapter().search(ctx, {
        target: { kind: "location", canonicalLocationId: "city:riyadh" },
        checkIn: "2026-10-13",
        checkOut: "2026-10-14",
        rooms: [{ adults: 1, childAges: [] }],
      }),
    ).rejects.toMatchObject({ kind: "invalid_request" });
  });
});
