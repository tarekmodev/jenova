/**
 * Filter/sort unit tests over structural OfferSummary values (our own api
 * shape; amounts are arbitrary integers exercising comparisons — no supplier
 * data involved).
 */

import { describe, expect, it } from "vitest";
import { applyOfferFilters, NO_FILTERS, sortBySellAscending } from "./filters";
import type { OfferSummary } from "./types";

function offer(partial: {
  id: string;
  amount: number;
  board: OfferSummary["boardBasis"];
  refundable: boolean;
}): OfferSummary {
  return {
    offerId: partial.id,
    offerToken: `token-${partial.id}`,
    expiresAt: "2099-01-01T00:00:00.000Z",
    supplierCode: "structural",
    canonicalPropertyId: `structural:${partial.id}`,
    supplierRoomName: `room ${partial.id}`,
    boardBasis: partial.board,
    sell: { amount: partial.amount, currency: "USD" },
    refundable: partial.refundable,
    cancellationPolicy: { refundable: partial.refundable, rules: [] },
  };
}

const offers = [
  offer({ id: "a", amount: 300, board: "RO", refundable: true }),
  offer({ id: "b", amount: 100, board: "BB", refundable: false }),
  offer({ id: "c", amount: 200, board: "RO", refundable: false }),
];

describe("applyOfferFilters", () => {
  it("no filters passes everything through", () => {
    expect(applyOfferFilters(offers, NO_FILTERS)).toHaveLength(3);
  });

  it("refundableOnly keeps only refundable offers", () => {
    const result = applyOfferFilters(offers, { ...NO_FILTERS, refundableOnly: true });
    expect(result.map((o) => o.offerId)).toEqual(["a"]);
  });

  it("board filter keeps only listed boards; empty list = all", () => {
    const result = applyOfferFilters(offers, { ...NO_FILTERS, boards: ["BB"] });
    expect(result.map((o) => o.offerId)).toEqual(["b"]);
  });

  it("maxSellMinor caps by integer minor units, inclusive", () => {
    const result = applyOfferFilters(offers, { ...NO_FILTERS, maxSellMinor: 200 });
    expect(result.map((o) => o.offerId)).toEqual(["b", "c"]);
  });
});

describe("sortBySellAscending", () => {
  it("sorts cheapest first without mutating the input", () => {
    const sorted = sortBySellAscending(offers);
    expect(sorted.map((o) => o.offerId)).toEqual(["b", "c", "a"]);
    expect(offers[0]?.offerId).toBe("a");
  });
});
