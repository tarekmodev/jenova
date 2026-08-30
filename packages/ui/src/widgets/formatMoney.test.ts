import { money } from "@jenova/domain";
import { describe, expect, it } from "vitest";
import {
  currencyFractionDigits,
  formatMoney,
  minorUnitsToDecimalString,
} from "./formatMoney";

// Structural synthetic amounts only (CLAUDE.md rule 5).

const EASTERN_ARABIC_DIGIT = /[٠-٩]/;
const LATIN_DIGIT = /[0-9]/;

describe("currencyFractionDigits", () => {
  it("uses CLDR minor-unit exponents (GCC currencies matter)", () => {
    expect(currencyFractionDigits("SAR")).toBe(2);
    expect(currencyFractionDigits("AED")).toBe(2);
    expect(currencyFractionDigits("BHD")).toBe(3);
    expect(currencyFractionDigits("KWD")).toBe(3);
    expect(currencyFractionDigits("JPY")).toBe(0);
  });
});

describe("minorUnitsToDecimalString", () => {
  it("is exact — no float arithmetic", () => {
    expect(minorUnitsToDecimalString(123456, 2)).toBe("1234.56");
    expect(minorUnitsToDecimalString(5, 2)).toBe("0.05");
    expect(minorUnitsToDecimalString(-123456, 3)).toBe("-123.456");
    expect(minorUnitsToDecimalString(7, 0)).toBe("7");
    expect(minorUnitsToDecimalString(0, 2)).toBe("0.00");
    expect(minorUnitsToDecimalString(9007199254740991, 2)).toBe("90071992547409.91");
  });
});

describe("formatMoney", () => {
  it("renders integer minor units at the currency's exponent", () => {
    const en = formatMoney(money(123456, "SAR"), { locale: "en" });
    expect(en).toContain("1,234.56");
    const dinar = formatMoney(money(123456, "BHD"), { locale: "en" });
    expect(dinar).toContain("123.456");
  });

  it("defaults to Latin digits even in Arabic (docs/06)", () => {
    const ar = formatMoney(money(123456, "SAR"), { locale: "ar" });
    expect(ar).toMatch(LATIN_DIGIT);
    expect(ar).not.toMatch(EASTERN_ARABIC_DIGIT);
  });

  it("tenant opt-in switches to Eastern Arabic numerals", () => {
    const ar = formatMoney(money(123456, "SAR"), { locale: "ar", numerals: "arab" });
    expect(ar).toMatch(EASTERN_ARABIC_DIGIT);
    expect(ar).not.toMatch(LATIN_DIGIT);
  });

  it("supports ISO-code display and sign handling", () => {
    const coded = formatMoney(money(123456, "SAR"), { locale: "en", currencyDisplay: "code" });
    expect(coded).toContain("SAR");
    const negative = formatMoney(money(-5000, "SAR"), { locale: "en" });
    expect(negative).toContain("50.00");
    expect(negative).toContain("-");
  });

  it("rejects invalid Money (validation stays at the domain boundary)", () => {
    expect(() =>
      formatMoney({ amount: 10.5, currency: "SAR" }, { locale: "en" }),
    ).toThrowError();
    expect(() =>
      formatMoney({ amount: 100, currency: "riyal" }, { locale: "en" }),
    ).toThrowError();
  });
});
