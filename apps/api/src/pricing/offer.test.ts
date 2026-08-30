import { money, type CancellationPolicy } from "@jenova/domain";
import { describe, expect, it } from "vitest";
import { PricingInputError } from "./errors";
import { assemblePricedOffer, type OfferAssemblyInput } from "./offer";
import { resolvePrice } from "./resolve";
import type { PricingContext, PricingRule } from "./rules";

// Structural values only — abstract Money/context shapes, no supplier
// payloads imitated (CLAUDE.md rule 5).

const CONTEXT: PricingContext = {
  subTenantId: null,
  channel: "b2b",
  vertical: "hotel",
  supplierCode: "sup-a",
  destination: "RUH",
  travelDate: "2026-11-10",
  nights: 3,
  paxCount: 2,
};

const RULE: PricingRule = {
  id: "rule-1",
  priority: 0,
  agencyId: null,
  channel: null,
  vertical: null,
  supplierCode: null,
  destination: null,
  travelFrom: null,
  travelTo: null,
  valueType: "percent",
  value: 2500n,
  currency: null,
  commissionSplitBps: 5000,
  active: true,
};

const POLICY: CancellationPolicy = {
  refundable: true,
  rules: [{ fromUtc: "2026-11-01T00:00:00Z", penalty: money(5_000, "SAR") }],
};

function input(overrides: Partial<OfferAssemblyInput> = {}): OfferAssemblyInput {
  return {
    supplierCode: "sup-a",
    vertical: "hotel",
    policySnapshot: POLICY,
    expiresAt: new Date("2026-08-30T12:30:00Z"),
    ...overrides,
  };
}

describe("assemblePricedOffer", () => {
  it("stamps the breakdown and fired-rule id onto the offer payload", () => {
    const resolution = resolvePrice(money(8_000, "SAR"), CONTEXT, [RULE]);
    const offer = assemblePricedOffer(input(), resolution);

    expect(offer.markupRuleId).toBe("rule-1");
    expect(offer.breakdown).toBe(resolution.breakdown);
    expect(offer.sell).toEqual(resolution.sell);
    expect(offer.net).toEqual(resolution.breakdown.net);
    // Single-currency offer row: currency matches both amounts.
    expect(offer.currency).toBe("SAR");
    expect(offer.net.currency).toBe(offer.currency);
    expect(offer.sell.currency).toBe(offer.currency);
    expect(offer.policySnapshot).toBe(POLICY);
    expect(offer.expiresAt).toEqual(new Date("2026-08-30T12:30:00Z"));
    expect(offer.supplierCode).toBe("sup-a");
    expect(offer.vertical).toBe("hotel");
  });

  it("carries a null markupRuleId when no rule matched", () => {
    const resolution = resolvePrice(money(8_000, "SAR"), CONTEXT, []);
    const offer = assemblePricedOffer(input(), resolution);
    expect(offer.markupRuleId).toBeNull();
    expect(offer.breakdown.markup).toEqual(money(0, "SAR"));
  });

  it("keeps the sell-currency net on the offer and the supplier net in breakdown.fx", () => {
    const resolution = resolvePrice(money(100_000, "USD"), CONTEXT, [RULE], {
      settlement: {
        currency: "SAR",
        rate: { from: "USD", to: "SAR", rate: 3.75, asOf: "2026-08-01T00:00:00Z" },
        bufferBps: 100,
      },
    });
    const offer = assemblePricedOffer(input(), resolution);
    expect(offer.currency).toBe("SAR");
    expect(offer.net).toEqual(money(378_750, "SAR"));
    expect(offer.breakdown.fx?.supplierNet).toEqual(money(100_000, "USD"));
  });

  it("rejects incoherent inputs", () => {
    const resolution = resolvePrice(money(8_000, "SAR"), CONTEXT, [RULE]);
    expect(() => assemblePricedOffer(input({ supplierCode: "" }), resolution)).toThrow(
      PricingInputError,
    );
    expect(() =>
      assemblePricedOffer(input({ expiresAt: new Date(Number.NaN) }), resolution),
    ).toThrow(PricingInputError);
    expect(() =>
      assemblePricedOffer(input(), {
        ...resolution,
        breakdown: { ...resolution.breakdown, net: money(1, "USD") },
      }),
    ).toThrow(PricingInputError);
  });
});
