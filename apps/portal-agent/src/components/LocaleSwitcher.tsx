"use client";

/**
 * ar ⇄ en switch. A full reload after the cookie write is deliberate: the
 * html dir/lang and the SSR emotion cache direction are server-decided, so
 * the whole document re-renders in the other direction.
 */

import { Button } from "@jenova/ui";
import type { ReactNode } from "react";
import { useAppLocale, useMessages } from "../i18n/I18nProvider";

export function LocaleSwitcher(): ReactNode {
  const messages = useMessages();
  const locale = useAppLocale();

  const switchTo = async (): Promise<void> => {
    await fetch("/portal-session/locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: locale === "ar" ? "en" : "ar" }),
    });
    window.location.reload();
  };

  return (
    <Button
      size="small"
      variant="outlined"
      color="inherit"
      onClick={() => void switchTo()}
      data-testid="locale-switcher"
    >
      {messages.common.switchLocale}
    </Button>
  );
}
