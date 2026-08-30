/**
 * Root layout — owns <html dir lang> server-side (Arabic-first: ar/rtl is
 * the default, CLAUDE.md rule 9). JenovaNextProvider supplies the
 * per-request, per-direction SSR emotion cache so RTL styles arrive
 * direction-correct with no flash.
 */

import type { ReactNode } from "react";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { directionForLocale } from "@jenova/ui";
import { isLocale, type Locale } from "@jenova/domain";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Jenova",
};

export default async function RootLayout(props: {
  readonly children: ReactNode;
}): Promise<ReactNode> {
  const rawLocale = await getLocale();
  const locale: Locale = isLocale(rawLocale) ? rawLocale : "ar";
  const direction = directionForLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} dir={direction}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers locale={locale}>{props.children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
