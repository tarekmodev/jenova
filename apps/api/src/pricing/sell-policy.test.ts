/**
 * Sell-side policy derivation (review H1) — exactness properties. All
 * values are structural integers exercising the arithmetic; no supplier
 * payloads involved.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { money, type CancellationPolicy } from "@jenova/domain";
import { PricingInputError } from "./errors";
import { toSellCancellationPolicy } from "./sell-policy";

function policyOf(...penalties: number[]): CancellationPolicy {
  return {
    refundable: true,
    rules: penalties.map((amount, i) => ({
      fromUtc: `2026-10-0${String(i + 1)}T00:00:00.000Z`,
      penalty: money(amount, "USD"),
    })),
  };
}

describe("toSellCancellationPolicy", () => {
  it("a 100%-of-net penalty becomes EXACTLY 100%-of-sell", () => {
    const result = toSellCancellationPolicy(policyOf(13_973), money(13_973, "USD"), money(15_370, "USD"));
    expect(result.rules[0]?.penalty).toEqual(money(15_370, "USD"));
  });

  it("zero penalties stay exactly zero; refundable and deadlines pass through", () => {
    const input = policyOf(0, 5_000);
    const result = toSellCancellationPolicy(input, money(10_000, "USD"), money(11_000, "USD"));
    expect(result.refundable).toBe(true);
    expect(result.rules.map((r) => r.fromUtc)).toEqual(input.rules.map((r) => r.fromUtc));
    expect(result.rules[0]?.penalty).toEqual(money(0, "USD"));
    // 5_000 × 11_000 / 10_000 = 5_500 exactly.
    expect(result.rules[1]?.penalty).toEqual(money(5_500, "USD"));
  });

  it("rounds half away from zero (multiplyByScalar's documented policy)", () => {
    // 1 × 3 / 2 = 1.5 → 2 (half rounds AWAY, not to even).
    const result = toSellCancellationPolicy(policyOf(1), money(2, "USD"), money(3, "USD"));
    expect(result.rules[0]?.penalty.amount).toBe(2);
  });

  it("results take the sell currency (post-FX offers scale against supplierNet)", () => {
    const result = toSellCancellationPolicy(policyOf(10_000), money(10_000, "USD"), money(41_250, "SAR"));
    expect(result.rules[0]?.penalty).toEqual(money(41_250, "SAR"));
  });

  it("refuses a penalty whose currency does not match the net basis", () => {
    expect(() =>
      toSellCancellationPolicy(policyOf(1_000), money(10_000, "SAR"), money(11_000, "SAR")),
    ).toThrow(PricingInputError);
  });

  it("property: sell penalties are capped at sell, proportional within half a minor unit, and monotone", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }), // net basis
        fc.integer({ min: 0, max: 2_000_000 }), // sell
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 4 }),
        (net, sell, penalties) => {
          const sorted = [...penalties].sort((a, b) => a - b);
          const result = toSellCancellationPolicy(policyOf(...sorted), money(net, "USD"), money(sell, "USD"));
          let previous = 0;
          for (const [i, rule] of result.rules.entries()) {
            const scaled = rule.penalty.amount;
            // Never exceeds the sell price (cap).
            expect(scaled).toBeLessThanOrEqual(sell);
            // Exact proportionality up to the single rounding step:
            // |scaled·net − penalty·sell| ≤ net/2, unless the cap fired.
            const raw = (sorted[i] ?? 0) * sell;
            if (scaled < sell || raw <= sell * net) {
              expect(Math.abs(scaled * net - raw)).toBeLessThanOrEqual(net / 2);
            }
            // Monotone: a larger net penalty never maps below a smaller one.
            expect(scaled).toBeGreaterThanOrEqual(previous);
            previous = scaled;
          }
        },
      ),
    );
  });
});
