import fc from "fast-check";
import { add, compare, money, subTenantId, SALES_CHANNELS, VERTICALS, type Money } from "@jenova/domain";
import { describe, expect, it } from "vitest";
import { PricingCurrencyError } from "./errors";
import { resolvePrice, SA_DEFAULT_VAT, type ResolveOptions, type SettlementSpec, type VatTreatment } from "./resolve";
import { MARKUP_VALUE_TYPES, type PricingContext, type PricingRule } from "./rules";

// Property inputs are ABSTRACT structural values (Money amounts, scope enums,
// rule shapes) — nothing here imitates a supplier response (CLAUDE.md rule 5).

const CURRENCIES = ["SAR", "USD", "AED", "KWD", "BHD"] as const;
const AMOUNT_BOUND = 2 ** 32;

const currencyArb = fc.constantFrom<string>(...CURRENCIES);

const contextArb: fc.Arbitrary<PricingContext> = fc.record({
  subTenantId: fc.option(fc.constantFrom(subTenantId("agency-1"), subTenantId("agency-2")), {
    nil: null,
  }),
  channel: fc.constantFrom(...SALES_CHANNELS),
  vertical: fc.constantFrom(...VERTICALS),
  supplierCode: fc.constantFrom("sup-a", "sup-b", "sup-c"),
  destination: fc.option(fc.constantFrom("RUH", "JED", "DXB"), { nil: null }),
  travelDate: fc.option(fc.constantFrom("2026-01-15", "2026-06-01", "2026-12-20"), { nil: null }),
  nights: fc.integer({ min: 1, max: 30 }),
  paxCount: fc.integer({ min: 1, max: 9 }),
});

const DATES = ["2025-01-01", "2026-01-01", "2026-06-01", "2026-12-31", "2027-01-01"] as const;

const dateBandArb: fc.Arbitrary<{ travelFrom: string | null; travelTo: string | null }> = fc.oneof(
  fc.constant({ travelFrom: null, travelTo: null }),
  fc
    .tuple(fc.constantFrom(...DATES), fc.constantFrom(...DATES))
    .map(([a, b]) => (a <= b ? { travelFrom: a, travelTo: b } : { travelFrom: b, travelTo: a })),
  fc.constantFrom(...DATES).map((d) => ({ travelFrom: d, travelTo: null })),
  fc.constantFrom(...DATES).map((d) => ({ travelFrom: null, travelTo: d })),
);

/**
 * Rules whose monetary currency is the sell currency, so resolution succeeds;
 * scope columns are a mix of nulls, context-matching and non-matching values.
 */
function ruleArb(
  context: PricingContext,
  sellCurrency: string,
  { allowNegative }: { allowNegative: boolean },
): fc.Arbitrary<PricingRule> {
  const scope = <T>(contextValue: T | null, other: NoInfer<T>): fc.Arbitrary<T | null> =>
    fc.oneof(fc.constant(null), fc.constant(contextValue), fc.constant(other));
  const min = allowNegative ? -9_000 : 0;
  return fc
    .record({
      id: fc.uuid(),
      priority: fc.integer({ min: 0, max: 100 }),
      agencyId: scope(context.subTenantId, subTenantId("agency-elsewhere")),
      channel: scope(context.channel, context.channel === "b2b" ? "b2c" : "b2b"),
      vertical: scope(context.vertical, context.vertical === "hotel" ? "air" : "hotel"),
      supplierCode: scope(context.supplierCode, "sup-none"),
      destination: scope(context.destination, "CAI"),
      band: dateBandArb,
      valueType: fc.constantFrom(...MARKUP_VALUE_TYPES),
      percentValue: fc.integer({ min, max: 10_000 }),
      monetaryValue: fc.integer({ min: allowNegative ? -10_000_000 : 0, max: 10_000_000 }),
      commissionSplitBps: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: null }),
      active: fc.boolean(),
    })
    .map(({ band, valueType, percentValue, monetaryValue, ...rest }) => ({
      ...rest,
      ...band,
      valueType,
      value: BigInt(valueType === "percent" ? percentValue : monetaryValue),
      currency: valueType === "percent" ? null : sellCurrency,
    }));
}

const vatArb: fc.Arbitrary<VatTreatment> = fc.constantFrom(
  SA_DEFAULT_VAT,
  { mode: "inclusive", rateBps: 500 },
  { mode: "exclusive", rateBps: 1500 },
  { mode: "exempt", rateBps: 0 },
);

function settlementArb(netCurrency: string): fc.Arbitrary<SettlementSpec | undefined> {
  const others = CURRENCIES.filter((c) => c !== netCurrency);
  return fc.option(
    fc
      .record({
        currency: fc.constantFrom<string>(...others),
        rateTenThousandths: fc.integer({ min: 1, max: 999_999 }),
        bufferBps: fc.integer({ min: 0, max: 1_000 }),
      })
      .map(({ currency, rateTenThousandths, bufferBps }) => ({
        currency,
        rate: {
          from: netCurrency,
          to: currency,
          rate: rateTenThousandths / 10_000,
          asOf: "2026-08-01T00:00:00Z",
        },
        bufferBps,
      })),
    { nil: undefined },
  );
}

interface Scenario {
  net: Money;
  context: PricingContext;
  rules: PricingRule[];
  options: ResolveOptions;
}

function scenarioArb({ allowNegative }: { allowNegative: boolean }): fc.Arbitrary<Scenario> {
  return fc
    .tuple(currencyArb, fc.integer({ min: 0, max: AMOUNT_BOUND }), contextArb, vatArb)
    .chain(([netCurrency, netAmount, context, vat]) =>
      settlementArb(netCurrency).chain((settlement) => {
        const sellCurrency = settlement?.currency ?? netCurrency;
        return fc
          .array(ruleArb(context, sellCurrency, { allowNegative }), { maxLength: 8 })
          .map((rules) => ({
            net: money(netAmount, netCurrency),
            context,
            rules,
            options: settlement === undefined ? { vat } : { vat, settlement },
          }));
      }),
    );
}

function sum(parts: readonly Money[], currency: string): Money {
  return parts.reduce((acc, part) => add(acc, part), money(0, currency));
}

describe("resolvePrice properties", () => {
  it("sell >= net basis unless the fired rule explicitly discounts; never below zero", () => {
    fc.assert(
      fc.property(scenarioArb({ allowNegative: true }), ({ net, context, rules, options }) => {
        const r = resolvePrice(net, context, rules, options);
        expect(r.sell.amount).toBeGreaterThanOrEqual(0);
        const fired = rules.find((rule) => rule.id === r.firedRuleId);
        if (fired === undefined || fired.value >= 0n) {
          expect(compare(r.sell, r.breakdown.net)).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it("breakdown components always sum exactly to sell (and splits to their totals)", () => {
    fc.assert(
      fc.property(scenarioArb({ allowNegative: true }), ({ net, context, rules, options }) => {
        const r = resolvePrice(net, context, rules, options);
        const currency = r.sell.currency;
        expect(sum(r.breakdown.components.map((c) => c.amount), currency)).toEqual(r.sell);
        expect(add(r.breakdown.taxableBase, r.breakdown.vat)).toEqual(r.sell);
        expect(add(r.breakdown.net, r.breakdown.markup)).toEqual(
          options.vat?.mode === "exclusive" ? r.breakdown.taxableBase : r.sell,
        );
        const split = r.breakdown.commissionSplit;
        if (split !== null) {
          expect(add(split.agencyCommission, split.tenantMargin)).toEqual(r.breakdown.markup);
        }
      }),
    );
  });

  it("is deterministic and independent of rule array order", () => {
    fc.assert(
      fc.property(scenarioArb({ allowNegative: true }), ({ net, context, rules, options }) => {
        const first = resolvePrice(net, context, rules, options);
        const second = resolvePrice(net, context, rules, options);
        const reversed = resolvePrice(net, context, [...rules].reverse(), options);
        expect(second).toEqual(first);
        expect(reversed).toEqual(first);
      }),
    );
  });

  it("keeps a single currency throughout, set by the stored settlement rate when present", () => {
    fc.assert(
      fc.property(scenarioArb({ allowNegative: false }), ({ net, context, rules, options }) => {
        const r = resolvePrice(net, context, rules, options);
        const expected = options.settlement?.currency ?? net.currency;
        const everyMoney: Money[] = [
          r.sell,
          r.breakdown.net,
          r.breakdown.markup,
          r.breakdown.taxableBase,
          r.breakdown.vat,
          ...r.breakdown.components.map((c) => c.amount),
        ];
        for (const m of everyMoney) {
          expect(m.currency).toBe(expected);
        }
        if (options.settlement !== undefined) {
          expect(r.breakdown.fx?.supplierNet).toEqual(net);
        }
      }),
    );
  });

  it("never mixes currencies without an explicit stored rate", () => {
    const mismatchArb = fc
      .tuple(currencyArb, fc.integer({ min: 0, max: AMOUNT_BOUND }), contextArb)
      .chain(([netCurrency, netAmount, context]) => {
        const others = CURRENCIES.filter((c) => c !== netCurrency);
        return fc
          .tuple(
            fc.constantFrom<string>(...others),
            fc.constantFrom<"fixed" | "per_night" | "per_pax">("fixed", "per_night", "per_pax"),
            fc.integer({ min: 1, max: 10_000 }),
          )
          .map(([otherCurrency, valueType, value]) => ({
            net: money(netAmount, netCurrency),
            context,
            // The only matching rule is monetary in a foreign currency.
            rule: {
              id: "foreign-rule",
              priority: 0,
              agencyId: null,
              channel: null,
              vertical: null,
              supplierCode: null,
              destination: null,
              travelFrom: null,
              travelTo: null,
              valueType,
              value: BigInt(value),
              currency: otherCurrency,
              commissionSplitBps: null,
              active: true,
            } satisfies PricingRule,
          }));
      });
    fc.assert(
      fc.property(mismatchArb, ({ net, context, rule }) => {
        expect(() => resolvePrice(net, context, [rule])).toThrow(PricingCurrencyError);
      }),
    );
  });
});
