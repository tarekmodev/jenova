import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  add,
  allocate,
  assertSameCurrency,
  compare,
  CurrencyMismatchError,
  equals,
  InvalidMoneyError,
  isZero,
  money,
  multiplyByScalar,
  subtract,
  zero,
  type Money,
} from "./money";

// Keep operands small enough that sums/products of a few of them stay safe;
// the overflow guard itself is tested separately.
const AMOUNT_BOUND = 2 ** 40;

const currencyArb = fc.constantFrom("SAR", "USD", "AED", "KWD", "EGP");

const moneyArb: fc.Arbitrary<Money> = fc
  .record({
    amount: fc.integer({ min: -AMOUNT_BOUND, max: AMOUNT_BOUND }),
    currency: currencyArb,
  })
  .map(({ amount, currency }) => money(amount, currency));

/** Pair/triple of Money sharing one currency, for add laws. */
const sameCurrencyPairArb = currencyArb.chain((currency) =>
  fc.tuple(
    fc.integer({ min: -AMOUNT_BOUND, max: AMOUNT_BOUND }),
    fc.integer({ min: -AMOUNT_BOUND, max: AMOUNT_BOUND }),
  ).map(([a, b]) => [money(a, currency), money(b, currency)] as const),
);

const sameCurrencyTripleArb = currencyArb.chain((currency) =>
  fc.tuple(
    fc.integer({ min: -AMOUNT_BOUND, max: AMOUNT_BOUND }),
    fc.integer({ min: -AMOUNT_BOUND, max: AMOUNT_BOUND }),
    fc.integer({ min: -AMOUNT_BOUND, max: AMOUNT_BOUND }),
  ).map(([a, b, c]) => [money(a, currency), money(b, currency), money(c, currency)] as const),
);

describe("money constructor and guards", () => {
  it("rejects non-integer, NaN and Infinity amounts", () => {
    for (const bad of [0.5, 1.0000001, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => money(bad, "SAR")).toThrow(InvalidMoneyError);
    }
  });

  it("rejects malformed currency codes", () => {
    for (const bad of ["sar", "SA", "SAUD", "S4R", "", " SAR"]) {
      expect(() => money(100, bad)).toThrow(InvalidMoneyError);
    }
  });

  it("accepts integer minor units with ISO 4217 codes", () => {
    expect(money(12345, "SAR")).toEqual({ amount: 12345, currency: "SAR" });
    expect(zero("KWD")).toEqual({ amount: 0, currency: "KWD" });
    expect(isZero(zero("SAR"))).toBe(true);
  });

  it("property: any generated Money round-trips through the constructor", () => {
    fc.assert(
      fc.property(moneyArb, (m) => {
        expect(money(m.amount, m.currency)).toEqual(m);
      }),
    );
  });
});

describe("currency mixing", () => {
  it("add/subtract/compare/assertSameCurrency throw on mixed currencies", () => {
    const sar = money(100, "SAR");
    const usd = money(100, "USD");
    expect(() => add(sar, usd)).toThrow(CurrencyMismatchError);
    expect(() => subtract(sar, usd)).toThrow(CurrencyMismatchError);
    expect(() => compare(sar, usd)).toThrow(CurrencyMismatchError);
    expect(() => assertSameCurrency(sar, usd)).toThrow(CurrencyMismatchError);
  });

  it("property: mixing any two distinct currencies always throws", () => {
    fc.assert(
      fc.property(
        moneyArb,
        moneyArb.filter((m) => m.currency !== "SAR"),
        (a, b) => {
          fc.pre(a.currency !== b.currency);
          expect(() => add(a, b)).toThrow(CurrencyMismatchError);
        },
      ),
    );
  });
});

describe("add / subtract laws", () => {
  it("property: add is commutative", () => {
    fc.assert(
      fc.property(sameCurrencyPairArb, ([a, b]) => {
        expect(add(a, b)).toEqual(add(b, a));
      }),
    );
  });

  it("property: add is associative", () => {
    fc.assert(
      fc.property(sameCurrencyTripleArb, ([a, b, c]) => {
        expect(add(add(a, b), c)).toEqual(add(a, add(b, c)));
      }),
    );
  });

  it("property: zero is the additive identity and subtract inverts add", () => {
    fc.assert(
      fc.property(sameCurrencyPairArb, ([a, b]) => {
        expect(add(a, zero(a.currency))).toEqual(a);
        expect(subtract(add(a, b), b)).toEqual(a);
      }),
    );
  });

  it("property: no float leakage — every result amount is a safe integer", () => {
    fc.assert(
      fc.property(sameCurrencyPairArb, ([a, b]) => {
        expect(Number.isSafeInteger(add(a, b).amount)).toBe(true);
        expect(Number.isSafeInteger(subtract(a, b).amount)).toBe(true);
      }),
    );
  });

  it("throws instead of silently overflowing", () => {
    const nearMax = money(Number.MAX_SAFE_INTEGER, "SAR");
    expect(() => add(nearMax, money(1, "SAR"))).toThrow(InvalidMoneyError);
    expect(() => subtract(money(Number.MIN_SAFE_INTEGER, "SAR"), money(1, "SAR"))).toThrow(
      InvalidMoneyError,
    );
  });
});

describe("multiplyByScalar", () => {
  it("multiplies exactly by integer scalars", () => {
    expect(multiplyByScalar(money(1234, "SAR"), 3)).toEqual(money(3702, "SAR"));
    expect(multiplyByScalar(money(1234, "SAR"), -2)).toEqual(money(-2468, "SAR"));
    expect(multiplyByScalar(money(1234, "SAR"), 0)).toEqual(money(0, "SAR"));
  });

  it("rounds half away from zero, symmetrically for negative amounts", () => {
    expect(multiplyByScalar(money(5, "SAR"), 0.5)).toEqual(money(3, "SAR")); // 2.5 -> 3
    expect(multiplyByScalar(money(-5, "SAR"), 0.5)).toEqual(money(-3, "SAR")); // -2.5 -> -3
    expect(multiplyByScalar(money(10000, "SAR"), 1.15)).toEqual(money(11500, "SAR"));
    expect(multiplyByScalar(money(333, "SAR"), 0.075)).toEqual(money(25, "SAR")); // 24.975 -> 25
  });

  it("rejects NaN and Infinity scalars", () => {
    expect(() => multiplyByScalar(money(100, "SAR"), NaN)).toThrow(InvalidMoneyError);
    expect(() => multiplyByScalar(money(100, "SAR"), Infinity)).toThrow(InvalidMoneyError);
  });

  it("property: integer-scalar multiplication has no float path (matches bigint math)", () => {
    fc.assert(
      fc.property(
        moneyArb,
        fc.integer({ min: -1000, max: 1000 }),
        (m, k) => {
          const result = multiplyByScalar(m, k);
          expect(BigInt(result.amount)).toBe(BigInt(m.amount) * BigInt(k));
        },
      ),
    );
  });

  it("property: result is always a safe integer for decimal scalars", () => {
    const decimalScalarArb = fc
      .tuple(fc.integer({ min: -10_000, max: 10_000 }), fc.integer({ min: 0, max: 4 }))
      .map(([mantissa, places]) => mantissa / 10 ** places);
    fc.assert(
      fc.property(moneyArb, decimalScalarArb, (m, scalar) => {
        expect(Number.isSafeInteger(multiplyByScalar(m, scalar).amount)).toBe(true);
      }),
    );
  });
});

describe("allocate (largest remainder)", () => {
  it("splits with no lost minor units", () => {
    expect(allocate(money(100, "SAR"), [1, 1, 1]).map((p) => p.amount)).toEqual([34, 33, 33]);
    expect(allocate(money(101, "SAR"), [3, 7]).map((p) => p.amount)).toEqual([30, 71]);
    expect(allocate(money(-100, "SAR"), [1, 1, 1]).map((p) => p.amount)).toEqual([-34, -33, -33]);
  });

  it("rejects empty, negative, fractional and all-zero weights", () => {
    const m = money(100, "SAR");
    expect(() => allocate(m, [])).toThrow(InvalidMoneyError);
    expect(() => allocate(m, [1, -1])).toThrow(InvalidMoneyError);
    expect(() => allocate(m, [0.5, 0.5])).toThrow(InvalidMoneyError);
    expect(() => allocate(m, [0, 0])).toThrow(InvalidMoneyError);
  });

  it("gives zero-weight parts exactly zero", () => {
    expect(allocate(money(99, "SAR"), [0, 1]).map((p) => p.amount)).toEqual([0, 99]);
  });

  const weightsArb = fc
    .array(fc.integer({ min: 0, max: 10_000 }), { minLength: 1, maxLength: 20 })
    .filter((ws) => ws.some((w) => w > 0));

  it("property: allocation always sums exactly to the input", () => {
    fc.assert(
      fc.property(moneyArb, weightsArb, (m, weights) => {
        const parts = allocate(m, weights);
        expect(parts).toHaveLength(weights.length);
        const total = parts.reduce((sum, p) => sum + BigInt(p.amount), 0n);
        expect(total).toBe(BigInt(m.amount));
      }),
    );
  });

  it("property: every part is a safe integer in the input currency", () => {
    fc.assert(
      fc.property(moneyArb, weightsArb, (m, weights) => {
        for (const part of allocate(m, weights)) {
          expect(Number.isSafeInteger(part.amount)).toBe(true);
          expect(part.currency).toBe(m.currency);
        }
      }),
    );
  });

  it("property: parts differ from the exact proportional share by less than one minor unit", () => {
    fc.assert(
      fc.property(moneyArb, weightsArb, (m, weights) => {
        const total = weights.reduce((s, w) => s + w, 0);
        const parts = allocate(m, weights);
        for (const [i, part] of parts.entries()) {
          const exact = (m.amount * (weights[i] ?? 0)) / total;
          expect(Math.abs(part.amount - exact)).toBeLessThan(1);
        }
      }),
    );
  });
});

describe("compare", () => {
  it("property: compare is a total order consistent with amounts", () => {
    fc.assert(
      fc.property(sameCurrencyPairArb, ([a, b]) => {
        expect(compare(a, b)).toBe(-compare(b, a));
        expect(compare(a, b) === 0).toBe(a.amount === b.amount);
        expect(equals(a, a)).toBe(true);
      }),
    );
  });
});
