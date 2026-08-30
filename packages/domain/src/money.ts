/**
 * Money — integer minor units + ISO 4217 currency code (CLAUDE.md rule 6).
 *
 * No floats: amounts are safe integers in the currency's minor unit (halalas,
 * fils, cents). All arithmetic is integer-exact; the only rounding point is
 * `multiplyByScalar`, whose policy is documented on the function.
 */

export interface Money {
  /** Integer amount in minor units (e.g. halalas). Never fractional. */
  readonly amount: number;
  /** ISO 4217 alphabetic code, uppercase (e.g. "SAR", "USD"). */
  readonly currency: string;
}

const ISO_4217_RE = /^[A-Z]{3}$/;

export class CurrencyMismatchError extends Error {
  constructor(
    readonly left: string,
    readonly right: string,
  ) {
    super(`currency mismatch: ${left} vs ${right}`);
    this.name = "CurrencyMismatchError";
  }
}

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoneyError";
  }
}

/** True when `amount` is a finite safe integer (rejects NaN, ±Infinity, fractions). */
export function isValidAmount(amount: number): boolean {
  return Number.isSafeInteger(amount);
}

/** True when `currency` is a three-letter uppercase ISO 4217 alphabetic code. */
export function isValidCurrency(currency: string): boolean {
  return ISO_4217_RE.test(currency);
}

/** Throws `InvalidMoneyError` unless `value` is a structurally valid Money. */
export function assertValidMoney(value: Money): void {
  if (!isValidAmount(value.amount)) {
    throw new InvalidMoneyError(
      `amount must be a safe integer in minor units, got ${String(value.amount)}`,
    );
  }
  if (!isValidCurrency(value.currency)) {
    throw new InvalidMoneyError(
      `currency must be a 3-letter uppercase ISO 4217 code, got ${JSON.stringify(value.currency)}`,
    );
  }
}

/** Collapses IEEE negative zero — `-0` must never be stored in an amount. */
function normalizeZero(amount: number): number {
  return amount === 0 ? 0 : amount;
}

/** Validating constructor — the only way Money values should be created. */
export function money(amount: number, currency: string): Money {
  const value: Money = { amount: normalizeZero(amount), currency };
  assertValidMoney(value);
  return value;
}

/** Zero in the given currency. */
export function zero(currency: string): Money {
  return money(0, currency);
}

/** Throws `CurrencyMismatchError` unless both operands share a currency. */
export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
}

function safeResult(amount: number, currency: string, op: string): Money {
  if (!Number.isSafeInteger(amount)) {
    throw new InvalidMoneyError(`${op} overflowed the safe integer range`);
  }
  return { amount: normalizeZero(amount), currency };
}

export function add(a: Money, b: Money): Money {
  assertValidMoney(a);
  assertValidMoney(b);
  assertSameCurrency(a, b);
  return safeResult(a.amount + b.amount, a.currency, "add");
}

export function subtract(a: Money, b: Money): Money {
  assertValidMoney(a);
  assertValidMoney(b);
  assertSameCurrency(a, b);
  return safeResult(a.amount - b.amount, a.currency, "subtract");
}

/**
 * Multiply by a scalar (markup factor, quantity, percentage/100).
 *
 * Rounding policy — integer-safe, documented per issue #15:
 * - Integer scalars multiply exactly in bigint space (no float path at all).
 * - Non-integer scalars are decimal by nature (markups like 1.15, 0.075):
 *   the scalar is exactly decomposed into numerator/denominator via its
 *   decimal string form, the product is computed in bigint, and the final
 *   division rounds HALF-AWAY-FROM-ZERO (commercial rounding — the rule
 *   used on GCC invoices/VAT), applied to the absolute value so +/- amounts
 *   round symmetrically. Exactly one rounding step, at the very end.
 * - Scalars that are not finite decimals (NaN, Infinity, exponent forms that
 *   cannot be represented exactly) are rejected.
 */
export function multiplyByScalar(m: Money, scalar: number): Money {
  assertValidMoney(m);
  if (!Number.isFinite(scalar)) {
    throw new InvalidMoneyError(`scalar must be finite, got ${String(scalar)}`);
  }
  const { numerator, denominator } = decimalToRatio(scalar);
  const product = BigInt(m.amount) * numerator;
  const rounded = divideRoundHalfAwayFromZero(product, denominator);
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER) || rounded < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new InvalidMoneyError("multiplyByScalar overflowed the safe integer range");
  }
  return { amount: normalizeZero(Number(rounded)), currency: m.currency };
}

/** Exact decimal decomposition of a scalar into a bigint ratio. */
function decimalToRatio(scalar: number): { numerator: bigint; denominator: bigint } {
  if (Number.isInteger(scalar) && Number.isSafeInteger(scalar)) {
    return { numerator: BigInt(scalar), denominator: 1n };
  }
  // toString() of a finite double is the shortest decimal that round-trips,
  // so parsing it back yields an exact rational representation of intent.
  const text = scalar.toString();
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(text);
  if (!match) {
    throw new InvalidMoneyError(`scalar is not a representable decimal: ${text}`);
  }
  const [, sign, intPart, fracPart = "", exp] = match;
  let numerator = BigInt(intPart + fracPart);
  let denominator = 10n ** BigInt(fracPart.length);
  if (exp !== undefined) {
    const e = BigInt(exp);
    if (e > 0n) numerator *= 10n ** e;
    else denominator *= 10n ** -e;
  }
  if (sign === "-") numerator = -numerator;
  return { numerator, denominator };
}

/** Integer division rounding half away from zero. `denominator` must be > 0. */
function divideRoundHalfAwayFromZero(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = abs / denominator;
  const remainder = abs % denominator;
  const roundedAbs = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -roundedAbs : roundedAbs;
}

/**
 * Split `m` proportionally to non-negative integer `weights` using the
 * largest-remainder method. The parts ALWAYS sum exactly to `m.amount` —
 * no halala is ever lost or invented. Leftover minor units go to the parts
 * with the largest remainders; ties break toward the earliest part, so the
 * result is deterministic.
 */
export function allocate(m: Money, weights: readonly number[]): Money[] {
  assertValidMoney(m);
  if (weights.length === 0) {
    throw new InvalidMoneyError("allocate requires at least one weight");
  }
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) {
      throw new InvalidMoneyError(
        `allocation weights must be non-negative safe integers, got ${String(w)}`,
      );
    }
  }
  const total = weights.reduce((sum, w) => sum + BigInt(w), 0n);
  if (total === 0n) {
    throw new InvalidMoneyError("allocation weights must not all be zero");
  }

  // Allocate the absolute value, then restore the sign on every part, so the
  // remainder distribution is symmetric for negative amounts (refunds).
  const negative = m.amount < 0;
  const absAmount = BigInt(Math.abs(m.amount));

  const shares: bigint[] = [];
  const remainders: { index: number; remainder: bigint }[] = [];
  let allocated = 0n;
  for (const [index, w] of weights.entries()) {
    const exact = absAmount * BigInt(w);
    const share = exact / total;
    shares.push(share);
    allocated += share;
    remainders.push({ index, remainder: exact % total });
  }

  let leftover = absAmount - allocated; // 0 <= leftover < weights.length
  remainders.sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const { index } of remainders) {
    if (leftover === 0n) break;
    shares[index] = (shares[index] ?? 0n) + 1n;
    leftover -= 1n;
  }

  return shares.map((share) => {
    const signed = negative ? -share : share;
    return safeResult(Number(signed), m.currency, "allocate");
  });
}

/** Total order within one currency: -1, 0, or 1. Throws on currency mixing. */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertValidMoney(a);
  assertValidMoney(b);
  assertSameCurrency(a, b);
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

export function equals(a: Money, b: Money): boolean {
  return compare(a, b) === 0;
}

export function isZero(m: Money): boolean {
  assertValidMoney(m);
  return m.amount === 0;
}
