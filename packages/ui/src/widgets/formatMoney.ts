/**
 * Money display formatting (pure — unit-tested).
 *
 * Input is always domain Money: INTEGER minor units + ISO 4217 code
 * (CLAUDE.md rule 6). Formatting is a display concern: the minor-unit
 * exponent comes from Intl's CLDR currency data, the decimal value is
 * built as an exact string (never float arithmetic), and digits follow
 * the tenant's numeral display setting — Latin by default, Eastern
 * Arabic (arab) as an opt-in (docs/06).
 */

import { assertValidMoney, type Locale, type Money } from "@jenova/domain";

/** Tenant display setting (docs/06): Latin digits unless tenant opts in. */
export type NumeralSystem = "latn" | "arab";

export interface FormatMoneyOptions {
  readonly locale: Locale;
  readonly numerals?: NumeralSystem;
  /** "symbol" (default) or ISO "code" currency display. */
  readonly currencyDisplay?: "symbol" | "code";
  readonly signDisplay?: "auto" | "always" | "never" | "exceptZero";
}

/** Minor-unit digits for a currency per CLDR (SAR/AED 2, BHD/KWD/OMR 3, …). */
export function currencyFractionDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

/** Exact decimal string for integer minor units — no float arithmetic. */
export function minorUnitsToDecimalString(amount: number, fractionDigits: number): string {
  const sign = amount < 0 ? "-" : "";
  const digits = Math.abs(amount).toString().padStart(fractionDigits + 1, "0");
  const whole = digits.slice(0, digits.length - fractionDigits);
  const fraction = fractionDigits > 0 ? `.${digits.slice(digits.length - fractionDigits)}` : "";
  return `${sign}${whole}${fraction}`;
}

export function formatMoney(money: Money, options: FormatMoneyOptions): string {
  assertValidMoney(money);
  const numerals: NumeralSystem = options.numerals ?? "latn";
  const formatter = new Intl.NumberFormat(`${options.locale}-u-nu-${numerals}`, {
    style: "currency",
    currency: money.currency,
    currencyDisplay: options.currencyDisplay ?? "symbol",
    signDisplay: options.signDisplay ?? "auto",
  });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const decimal = minorUnitsToDecimalString(money.amount, digits);
  // Intl.NumberFormat v3 accepts exact decimal strings; TS lib typings lag.
  return formatter.format(decimal as unknown as number);
}
