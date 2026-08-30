/**
 * Story helpers: pick the ar/en variant of story copy from the toolbar
 * locale. Story copy is the storybook's own — apps own real catalogs.
 *
 * Story data policy (CLAUDE.md rule 5): stories carry only obviously
 * synthetic STRUCTURAL values — placeholder names, round amounts, fixed
 * instants — never supplier-shaped payloads or recorded business data.
 */

import type { Locale } from "@jenova/domain";
import { isLocale } from "@jenova/domain";

export function storyLocale(globals: Record<string, unknown>): Locale {
  const value = globals["locale"];
  return typeof value === "string" && isLocale(value) ? value : "ar";
}

export function pickCopy<T>(globals: Record<string, unknown>, copy: { ar: T; en: T }): T {
  return storyLocale(globals) === "ar" ? copy.ar : copy.en;
}

/** A fixed instant so screenshots are deterministic. */
export const STORY_NOW = new Date("2026-03-12T09:00:00Z");
