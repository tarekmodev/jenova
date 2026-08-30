import { money, subTenantId } from "@jenova/domain";
import { describe, expect, it } from "vitest";
import { PricingCurrencyError, PricingInputError, PricingRuleError } from "./errors";
import { resolvePrice, SA_DEFAULT_VAT, type ResolveOptions, type VatTreatment } from "./resolve";
import type { PricingContext, PricingRule } from "./rules";

// Structural test values only — abstract Money amounts and rule shapes; no
// supplier payloads are imitated anywhere (CLAUDE.md rule 5).

const AGENCY = subTenantId("agency-1");

function ctx(overrides: Partial<PricingContext> = {}): PricingContext {
  return {
    subTenantId: null,
    channel: "b2b",
    vertical: "hotel",
    supplierCode: "sup-a",
    destination: "RUH",
    travelDate: "2026-11-10",
    nights: 3,
    paxCount: 2,
    ...overrides,
  };
}

function rule(overrides: Partial<PricingRule> = {}): PricingRule {
  return {
    id: "rule-1",
    priority: 100,
    agencyId: null,
    channel: null,
    vertical: null,
    supplierCode: null,
    destination: null,
    travelFrom: null,
    travelTo: null,
    valueType: "percent",
    value: 1000n,
    currency: null,
    commissionSplitBps: null,
    active: true,
    ...overrides,
  };
}

/** Keeps markup arithmetic visible without VAT carving. */
const NO_VAT: ResolveOptions = { vat: { mode: "exempt", rateBps: 0 } };

describe("rule application", () => {
  it("no matching rule: sell equals net, no fired rule", () => {
    const r = resolvePrice(money(10_000, "SAR"), ctx(), [], NO_VAT);
    expect(r.sell).toEqual(money(10_000, "SAR"));
    expect(r.firedRuleId).toBeNull();
    expect(r.breakdown.markup).toEqual(money(0, "SAR"));
    expect(r.breakdown.commissionSplit).toBeNull();
    expect(r.breakdown.fx).toBeNull();
  });

  it("percent rule applies basis points with one half-away-from-zero rounding", () => {
    const r = resolvePrice(money(10_000, "SAR"), ctx(), [rule({ value: 1000n })], NO_VAT);
    expect(r.sell).toEqual(money(11_000, "SAR"));
    expect(r.firedRuleId).toBe("rule-1");
    // 105 * 0.005 = 0.525 -> rounds to 1 (half away from zero)
    const tiny = resolvePrice(money(105, "SAR"), ctx(), [rule({ value: 50n })], NO_VAT);
    expect(tiny.sell).toEqual(money(106, "SAR"));
  });

  it("fixed rule adds minor units in the sell currency", () => {
    const r = resolvePrice(
      money(10_000, "SAR"),
      ctx(),
      [rule({ valueType: "fixed", value: 2500n, currency: "SAR" })],
      NO_VAT,
    );
    expect(r.sell).toEqual(money(12_500, "SAR"));
  });

  it("fixed rule in another currency refuses to fire without a stored rate", () => {
    expect(() =>
      resolvePrice(
        money(10_000, "SAR"),
        ctx(),
        [rule({ valueType: "fixed", value: 2500n, currency: "USD" })],
        NO_VAT,
      ),
    ).toThrow(PricingCurrencyError);
  });

  it("per_night multiplies by nights and requires nights in context", () => {
    const nightly = rule({ valueType: "per_night", value: 500n, currency: "SAR" });
    const r = resolvePrice(money(10_000, "SAR"), ctx({ nights: 3 }), [nightly], NO_VAT);
    expect(r.sell).toEqual(money(11_500, "SAR"));
    expect(() => resolvePrice(money(10_000, "SAR"), ctx({ nights: null }), [nightly], NO_VAT)).toThrow(
      PricingInputError,
    );
  });

  it("per_pax multiplies by pax count and requires paxCount in context", () => {
    const perPax = rule({ valueType: "per_pax", value: 700n, currency: "SAR" });
    const r = resolvePrice(money(10_000, "SAR"), ctx({ paxCount: 2 }), [perPax], NO_VAT);
    expect(r.sell).toEqual(money(11_400, "SAR"));
    expect(() => resolvePrice(money(10_000, "SAR"), ctx({ paxCount: 0 }), [perPax], NO_VAT)).toThrow(
      PricingInputError,
    );
  });

  it("an explicit discount may sell below net but clamps at zero", () => {
    const discounted = resolvePrice(money(10_000, "SAR"), ctx(), [rule({ value: -2000n })], NO_VAT);
    expect(discounted.sell).toEqual(money(8_000, "SAR"));

    const clamped = resolvePrice(
      money(10_000, "SAR"),
      ctx(),
      [rule({ valueType: "fixed", value: -20_000n, currency: "SAR" })],
      NO_VAT,
    );
    expect(clamped.sell).toEqual(money(0, "SAR"));
    // After clamping the identity net + markup = sell still holds exactly.
    expect(clamped.breakdown.markup).toEqual(money(-10_000, "SAR"));
  });

  it("rejects a negative supplier net", () => {
    expect(() => resolvePrice(money(-1, "SAR"), ctx(), [], NO_VAT)).toThrow(PricingInputError);
  });
});

describe("most-specific-wins ordering (documented in rules.ts)", () => {
  it("agency rule beats the tenant default", () => {
    const r = resolvePrice(
      money(10_000, "SAR"),
      ctx({ subTenantId: AGENCY }),
      [rule({ id: "default", value: 1000n }), rule({ id: "agency", agencyId: AGENCY, value: 500n })],
      NO_VAT,
    );
    expect(r.firedRuleId).toBe("agency");
    expect(r.sell).toEqual(money(10_500, "SAR"));
  });

  it("a more specific dimension beats any combination of less specific ones", () => {
    // date band alone (32) vs agency+channel+vertical+supplier+destination (31)
    const combo = rule({
      id: "combo",
      agencyId: AGENCY,
      channel: "b2b",
      vertical: "hotel",
      supplierCode: "sup-a",
      destination: "RUH",
      value: 500n,
    });
    const band = rule({ id: "band", travelFrom: "2026-11-01", travelTo: "2026-11-30", value: 900n });
    const r = resolvePrice(money(10_000, "SAR"), ctx({ subTenantId: AGENCY }), [combo, band], NO_VAT);
    expect(r.firedRuleId).toBe("band");
  });

  it("ties on scope shape break by lower priority, then smaller id — order-independent", () => {
    const a = rule({ id: "bbb", agencyId: AGENCY, priority: 10, value: 100n });
    const b = rule({ id: "aaa", agencyId: AGENCY, priority: 20, value: 200n });
    const context = ctx({ subTenantId: AGENCY });
    expect(resolvePrice(money(1_000, "SAR"), context, [a, b], NO_VAT).firedRuleId).toBe("bbb");
    expect(resolvePrice(money(1_000, "SAR"), context, [b, a], NO_VAT).firedRuleId).toBe("bbb");

    const c = rule({ id: "aaa", agencyId: AGENCY, priority: 10, value: 300n });
    expect(resolvePrice(money(1_000, "SAR"), context, [a, c], NO_VAT).firedRuleId).toBe("aaa");
    expect(resolvePrice(money(1_000, "SAR"), context, [c, a], NO_VAT).firedRuleId).toBe("aaa");
  });

  it("scope dimensions must match exactly; date bands are inclusive and need a travel date", () => {
    const wrongChannel = rule({ id: "b2c-only", channel: "b2c" });
    expect(resolvePrice(money(1_000, "SAR"), ctx(), [wrongChannel], NO_VAT).firedRuleId).toBeNull();

    const band = rule({ id: "band", travelFrom: "2026-11-10", travelTo: "2026-11-10" });
    expect(resolvePrice(money(1_000, "SAR"), ctx(), [band], NO_VAT).firedRuleId).toBe("band");
    expect(
      resolvePrice(money(1_000, "SAR"), ctx({ travelDate: "2026-11-11" }), [band], NO_VAT).firedRuleId,
    ).toBeNull();
    expect(
      resolvePrice(money(1_000, "SAR"), ctx({ travelDate: null }), [band], NO_VAT).firedRuleId,
    ).toBeNull();

    const inactive = rule({ id: "off", active: false });
    expect(resolvePrice(money(1_000, "SAR"), ctx(), [inactive], NO_VAT).firedRuleId).toBeNull();
  });
});

describe("VAT treatment hook", () => {
  it("defaults to SA 15% inclusive and carves taxable base vs VAT out of the sell", () => {
    const r = resolvePrice(money(8_000, "SAR"), ctx(), [rule({ value: 2500n })]);
    expect(r.breakdown.vatTreatment).toEqual(SA_DEFAULT_VAT);
    expect(r.sell).toEqual(money(10_000, "SAR"));
    // 10000 split 10000:1500 by largest remainder -> 8696 + 1304
    expect(r.breakdown.taxableBase).toEqual(money(8_696, "SAR"));
    expect(r.breakdown.vat).toEqual(money(1_304, "SAR"));
  });

  it("exclusive mode adds VAT on top as a breakdown component", () => {
    const vat: VatTreatment = { mode: "exclusive", rateBps: 1500 };
    const r = resolvePrice(money(8_000, "SAR"), ctx(), [rule({ value: 2500n })], { vat });
    expect(r.sell).toEqual(money(11_500, "SAR"));
    expect(r.breakdown.taxableBase).toEqual(money(10_000, "SAR"));
    expect(r.breakdown.vat).toEqual(money(1_500, "SAR"));
    expect(r.breakdown.components.map((c) => c.kind)).toEqual(["net", "markup", "vat"]);
  });

  it("exempt mode carries zero VAT with taxableBase = sell", () => {
    const r = resolvePrice(money(8_000, "SAR"), ctx(), [], NO_VAT);
    expect(r.breakdown.vat).toEqual(money(0, "SAR"));
    expect(r.breakdown.taxableBase).toEqual(r.sell);
  });
});

describe("FX via stored rate + tenant buffer", () => {
  const rate = { from: "USD", to: "SAR", rate: 3.75, asOf: "2026-08-01T00:00:00Z" };

  it("converts the net with the stored rate then applies the buffer", () => {
    const r = resolvePrice(money(100_000, "USD"), ctx(), [], {
      ...NO_VAT,
      settlement: { currency: "SAR", rate, bufferBps: 100 },
    });
    // 100000 * 3.75 = 375000; * 1.01 = 378750
    expect(r.sell).toEqual(money(378_750, "SAR"));
    expect(r.breakdown.fx).toEqual({ supplierNet: money(100_000, "USD"), rate, bufferBps: 100 });
  });

  it("refuses a stored rate that does not cover the currency pair", () => {
    expect(() =>
      resolvePrice(money(100_000, "USD"), ctx(), [], {
        ...NO_VAT,
        settlement: { currency: "AED", rate, bufferBps: 0 },
      }),
    ).toThrow(PricingCurrencyError);
  });

  it("refuses a settlement into the net currency itself", () => {
    expect(() =>
      resolvePrice(money(100_000, "SAR"), ctx(), [], {
        ...NO_VAT,
        settlement: { currency: "SAR", rate: { ...rate, to: "SAR", from: "SAR" }, bufferBps: 0 },
      }),
    ).toThrow(PricingInputError);
  });

  it("monetary rules fire in the converted sell currency", () => {
    const r = resolvePrice(
      money(100_000, "USD"),
      ctx(),
      [rule({ valueType: "fixed", value: 1_000n, currency: "SAR" })],
      { ...NO_VAT, settlement: { currency: "SAR", rate, bufferBps: 0 } },
    );
    expect(r.sell).toEqual(money(376_000, "SAR"));
  });
});

describe("commission split", () => {
  it("splits the markup exactly, agency share first on remainder ties", () => {
    const r = resolvePrice(
      money(10_000, "SAR"),
      ctx(),
      [rule({ value: 1000n, commissionSplitBps: 2500 })],
      NO_VAT,
    );
    expect(r.breakdown.commissionSplit).toEqual({
      agencyCommission: money(250, "SAR"),
      tenantMargin: money(750, "SAR"),
    });

    // Odd markup 1001 at 50/50: largest-remainder tie goes to the agency part.
    const odd = resolvePrice(
      money(10_010, "SAR"),
      ctx(),
      [rule({ value: 1000n, commissionSplitBps: 5000 })],
      NO_VAT,
    );
    expect(odd.breakdown.commissionSplit).toEqual({
      agencyCommission: money(501, "SAR"),
      tenantMargin: money(500, "SAR"),
    });
  });
});

describe("rule validation (mirrors the tenant-schema SQL checks)", () => {
  it("rejects rows that would violate markup_rule constraints", () => {
    const bad: PricingRule[] = [
      rule({ valueType: "percent", currency: "SAR" }),
      rule({ valueType: "fixed", value: 100n, currency: null }),
      rule({ travelFrom: "2026-12-31", travelTo: "2026-01-01" }),
      rule({ commissionSplitBps: 10_001 }),
      rule({ travelFrom: "31/12/2026" }),
    ];
    for (const b of bad) {
      expect(() => resolvePrice(money(1_000, "SAR"), ctx(), [b], NO_VAT)).toThrow(PricingRuleError);
    }
  });
});
