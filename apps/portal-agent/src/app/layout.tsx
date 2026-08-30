/**
 * Root layout — Arabic-first RTL (CLAUDE.md rule 9): the locale cookie
 * decides lang/dir server-side (default ar/rtl), so the FIRST paint is
 * direction-correct; JenovaNextProvider mounts the direction-aware SSR
 * emotion cache on top.
 */

import type { ReactNode } from "react";
import { JenovaNextProvider } from "@jenova/ui/next";
import { I18nProvider } from "../i18n/I18nProvider";
import { MESSAGES } from "../i18n/messages";
import { resolveLocale } from "../lib/session";

export async function generateMetadata() {
  const locale = await resolveLocale();
  return { title: MESSAGES[locale].common.portalName };
}

export default async function RootLayout(props: { children: ReactNode }) {
  const locale = await resolveLocale();
  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <body>
        <JenovaNextProvider locale={locale}>
          <I18nProvider locale={locale}>{props.children}</I18nProvider>
        </JenovaNextProvider>
      </body>
    </html>
  );
}
