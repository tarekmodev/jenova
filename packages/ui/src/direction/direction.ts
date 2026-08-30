/**
 * Locale → direction resolution (pure). Arabic is the default locale
 * product-wide (CLAUDE.md rule 9); direction always DERIVES from locale
 * unless a caller explicitly overrides it (Storybook's direction toolbar).
 */

import type { Locale } from "@jenova/domain";

export type UiDirection = "ltr" | "rtl";

export const DEFAULT_LOCALE: Locale = "ar";

export function directionForLocale(locale: Locale): UiDirection {
  return locale === "ar" ? "rtl" : "ltr";
}

export function resolveDirection(locale: Locale, override?: UiDirection): UiDirection {
  return override ?? directionForLocale(locale);
}
