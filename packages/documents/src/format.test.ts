/**
 * Display-formatting units. Pure layout/formatting mechanics — the values
 * below are minimal structural inputs, not supplier data (CLAUDE.md rule 5
 * note: rendering-only units may use structural values).
 */

import { describe, expect, it } from "vitest";
import {
  addDaysUtc,
  currencyExponent,
  formatGregorianDate,
  formatHijriDate,
  formatMoney,
  formatUtcInstant,
  parseIsoDateUtc,
} from "./format";

describe("formatMoney", () => {
  it("renders 2-decimal currencies from minor units", () => {
    expect(formatMoney({ amount: 13_973, currency: "USD" })).toBe("139.73 USD");
    expect(formatMoney({ amount: 52_400, currency: "SAR" })).toBe("524.00 SAR");
    expect(formatMoney({ amount: 5, currency: "SAR" })).toBe("0.05 SAR");
  });

  it("renders GCC 3-decimal currencies correctly (BHD/KWD/OMR)", () => {
    expect(currencyExponent("KWD")).toBe(3);
    expect(formatMoney({ amount: 1_500, currency: "KWD" })).toBe("1.500 KWD");
    expect(formatMoney({ amount: 999, currency: "BHD" })).toBe("0.999 BHD");
    expect(formatMoney({ amount: 12_345, currency: "OMR" })).toBe("12.345 OMR");
  });

  it("renders zero-decimal currencies without a fraction", () => {
    expect(formatMoney({ amount: 5_000, currency: "JPY" })).toBe("5000 JPY");
  });
});

describe("dates", () => {
  it("parses and adds days in UTC across month boundaries", () => {
    expect(parseIsoDateUtc("2026-10-13").toISOString()).toBe("2026-10-13T00:00:00.000Z");
    expect(addDaysUtc("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysUtc("2026-10-13", 1)).toBe("2026-10-14");
  });

  it("refuses garbage dates", () => {
    expect(() => parseIsoDateUtc("13/10/2026")).toThrow(/ISO calendar date/);
    expect(() => parseIsoDateUtc("2026-13-45")).toThrow(/real calendar date/);
  });

  it("renders Gregorian per locale", () => {
    expect(formatGregorianDate("2026-10-13", "en")).toBe("13 October 2026");
    expect(formatGregorianDate("2026-10-13", "ar")).toContain("أكتوبر");
  });

  it("Hijri display (Umm al-Qura) is derived, non-empty and Hijri-year-dated", () => {
    const en = formatHijriDate("2026-10-13", "en");
    const ar = formatHijriDate("2026-10-13", "ar");
    // 2026-10-13 CE falls in Hijri year 1448.
    expect(en).toContain("1448");
    expect(ar.length).toBeGreaterThan(0);
    expect(ar).not.toBe(formatGregorianDate("2026-10-13", "ar"));
  });

  it("formats policy deadlines as UTC instants", () => {
    expect(formatUtcInstant("2026-10-10T23:59:00Z")).toBe("2026-10-10 23:59 UTC");
    expect(() => formatUtcInstant("whenever")).toThrow(/UTC instant/);
  });
});
