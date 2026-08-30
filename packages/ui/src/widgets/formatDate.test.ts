import { describe, expect, it } from "vitest";
import { formatGregorian, formatHijri } from "./formatDate";

// Structural synthetic instants only (CLAUDE.md rule 5).
const INSTANT = "2026-03-01T09:30:00Z";

const EASTERN_ARABIC_DIGIT = /[٠-٩]/;

describe("formatGregorian", () => {
  it("renders the Gregorian date in both locales", () => {
    expect(formatGregorian(INSTANT, { locale: "en" })).toContain("2026");
    expect(formatGregorian(INSTANT, { locale: "ar" })).toContain("2026");
  });

  it("defaults to UTC display; time only when requested", () => {
    const dateOnly = formatGregorian(INSTANT, { locale: "en" });
    expect(dateOnly).not.toContain("9:30");
    const withTime = formatGregorian(INSTANT, { locale: "en", timeStyle: "short" });
    expect(withTime).toContain("9:30");
    const riyadh = formatGregorian(INSTANT, {
      locale: "en",
      timeStyle: "short",
      timeZone: "Asia/Riyadh",
    });
    expect(riyadh).toContain("12:30"); // UTC+3, no DST
  });

  it("Latin digits by default; Eastern Arabic on opt-in", () => {
    expect(formatGregorian(INSTANT, { locale: "ar" })).not.toMatch(EASTERN_ARABIC_DIGIT);
    expect(formatGregorian(INSTANT, { locale: "ar", numerals: "arab" })).toMatch(
      EASTERN_ARABIC_DIGIT,
    );
  });

  it("rejects unparseable instants", () => {
    expect(() => formatGregorian("not-a-date", { locale: "en" })).toThrowError();
  });
});

describe("formatHijri", () => {
  it("renders the Umm al-Qura date (1447 for this instant), date-only", () => {
    const hijri = formatHijri(INSTANT, { locale: "en", timeStyle: "short" });
    expect(hijri).toContain("1447");
    expect(hijri).not.toContain("9:30");
  });

  it("differs from the Gregorian line (display-only secondary)", () => {
    expect(formatHijri(INSTANT, { locale: "ar" })).not.toBe(
      formatGregorian(INSTANT, { locale: "ar" }),
    );
  });
});
