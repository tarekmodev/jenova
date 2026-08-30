/**
 * Date display formatting (pure — unit-tested).
 *
 * Storage is Gregorian UTC everywhere (CLAUDE.md rule 9); Hijri and local
 * time are DISPLAY concerns only. The Hijri string uses the Umm al-Qura
 * calendar (the KSA civil reference) and is always a secondary line —
 * never a stored or computed-with value.
 */

import type { Locale } from "@jenova/domain";
import type { NumeralSystem } from "./formatMoney";

export interface FormatDateOptions {
  readonly locale: Locale;
  readonly numerals?: NumeralSystem;
  readonly dateStyle?: "full" | "long" | "medium" | "short";
  /** Omit for date-only display. */
  readonly timeStyle?: "full" | "long" | "medium" | "short";
  /** IANA zone for display; UTC when omitted (storage truth). */
  readonly timeZone?: string;
}

function toDate(utc: string | Date): Date {
  const date = typeof utc === "string" ? new Date(utc) : utc;
  if (Number.isNaN(date.getTime())) {
    throw new Error(`not a parseable UTC instant: ${JSON.stringify(String(utc))}`);
  }
  return date;
}

function buildFormatter(options: FormatDateOptions, calendar?: string): Intl.DateTimeFormat {
  const numerals: NumeralSystem = options.numerals ?? "latn";
  const tag = `${options.locale}-u-nu-${numerals}${calendar !== undefined ? `-ca-${calendar}` : ""}`;
  return new Intl.DateTimeFormat(tag, {
    dateStyle: options.dateStyle ?? "medium",
    ...(options.timeStyle !== undefined ? { timeStyle: options.timeStyle } : {}),
    timeZone: options.timeZone ?? "UTC",
  });
}

/** Gregorian display string — the primary line. */
export function formatGregorian(utc: string | Date, options: FormatDateOptions): string {
  return buildFormatter(options, "gregory").format(toDate(utc));
}

/** Hijri (Umm al-Qura) display string — the optional secondary line. */
export function formatHijri(utc: string | Date, options: FormatDateOptions): string {
  // Hijri is date-granular for display; time repeats on the primary line.
  const dateOnly: FormatDateOptions = {
    locale: options.locale,
    ...(options.numerals !== undefined ? { numerals: options.numerals } : {}),
    ...(options.dateStyle !== undefined ? { dateStyle: options.dateStyle } : {}),
    ...(options.timeZone !== undefined ? { timeZone: options.timeZone } : {}),
  };
  return buildFormatter(dateOnly, "islamic-umalqura").format(toDate(utc));
}
