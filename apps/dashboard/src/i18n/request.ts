/**
 * next-intl request config — cookie-based locale, NO locale routing.
 *
 * Why next-intl: first-class App Router support (server components get
 * translations without shipping catalogs to the client), ICU messages,
 * and a "without i18n routing" mode that fits a tenant dashboard behind a
 * login (the locale is a user preference, not a URL). Arabic is the
 * default locale product-wide (CLAUDE.md rule 9).
 */

import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { isLocale, type Locale } from "@jenova/domain";
import { LOCALE_COOKIE } from "../lib/session";

export const DEFAULT_LOCALE: Locale = "ar";

export default getRequestConfig(async () => {
  const raw = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = raw !== undefined && isLocale(raw) ? raw : DEFAULT_LOCALE;
  return {
    locale,
    messages: (
      (await import(`../messages/${locale}.json`)) as { default: Record<string, unknown> }
    ).default,
  };
});
