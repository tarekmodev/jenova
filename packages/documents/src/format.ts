/**
 * Display-time formatting for documents (CLAUDE.md rules 6 and 9): money
 * stays integer minor units everywhere — conversion to a decimal string
 * happens HERE, at the rendering boundary, and nowhere else. Dates are
 * stored Gregorian UTC; Hijri is a display concern computed at format time
 * (Umm al-Qura calendar via ICU).
 *
 * Pure functions, zero IO.
 */

import type { Money } from "@jenova/domain";

/**
 * ISO 4217 minor-unit exponents that differ from the default of 2. GCC
 * three-decimal currencies (BHD/KWD/OMR) matter from day one; the zero-
 * decimal set covers the common travel currencies.
 */
const CURRENCY_EXPONENT_EXCEPTIONS: Readonly<Record<string, number>> = {
  BHD: 3,
  IQD: 3,
  JOD: 3,
  KWD: 3,
  LYD: 3,
  OMR: 3,
  TND: 3,
  JPY: 0,
  KRW: 0,
  VND: 0,
};

export function currencyExponent(currency: string): number {
  return CURRENCY_EXPONENT_EXCEPTIONS[currency] ?? 2;
}

/** `{ amount: 13973, currency: "USD" }` → `"139.73 USD"`. Latin digits in both language sections. */
export function formatMoney(value: Money): string {
  const exponent = currencyExponent(value.currency);
  if (exponent === 0) {
    return `${String(value.amount)} ${value.currency}`;
  }
  const factor = 10 ** exponent;
  const sign = value.amount < 0 ? "-" : "";
  const abs = Math.abs(value.amount);
  const units = Math.trunc(abs / factor);
  const minor = String(abs % factor).padStart(exponent, "0");
  return `${sign}${String(units)}.${minor} ${value.currency}`;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a stored `YYYY-MM-DD` Gregorian calendar date to a UTC Date. */
export function parseIsoDateUtc(isoDate: string): Date {
  const match = ISO_DATE_RE.exec(isoDate);
  if (match === null) {
    throw new Error(`not an ISO calendar date: ${JSON.stringify(isoDate)}`);
  }
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`not a real calendar date: ${JSON.stringify(isoDate)}`);
  }
  return parsed;
}

/** Adds whole days to a `YYYY-MM-DD` date, in UTC. */
export function addDaysUtc(isoDate: string, days: number): string {
  const date = parseIsoDateUtc(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  const found = date.toISOString().split("T")[0];
  if (found === undefined) {
    throw new Error("unreachable: toISOString always carries a date part");
  }
  return found;
}

/** Gregorian long-form date for one locale, e.g. `13 October 2026` / `13 أكتوبر 2026`. */
export function formatGregorianDate(isoDate: string, locale: "ar" | "en"): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    calendar: "gregory",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseIsoDateUtc(isoDate));
}

/**
 * Hijri (Umm al-Qura) rendering of a stored Gregorian date — DISPLAY ONLY
 * (CLAUDE.md rule 9: storage stays Gregorian UTC). Shown secondary next to
 * the Gregorian date on documents.
 */
export function formatHijriDate(isoDate: string, locale: "ar" | "en"): string {
  const tag = locale === "ar" ? "ar-SA-u-ca-islamic-umalqura" : "en-u-ca-islamic-umalqura";
  const formatted = new Intl.DateTimeFormat(tag, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseIsoDateUtc(isoDate));
  // ICU suffixes the era ("AH" / "هـ") in some forms only; normalize to a
  // plain date string — the template labels the calendar itself.
  return formatted.replace(/\s*(AH|هـ)\s*$/u, "");
}

/** UTC instant → `2026-10-10 23:59 UTC` (policy deadlines are UTC, docs/03). */
export function formatUtcInstant(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`not a parseable UTC instant: ${JSON.stringify(iso)}`);
  }
  const date = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${String(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`
  );
}
