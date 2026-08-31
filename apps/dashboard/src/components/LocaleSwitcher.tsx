"use client";

/**
 * Arabic ⇄ English switcher. Each language is labeled in ITSELF (the one
 * string a user locked out of the current language can always read), so
 * these two labels deliberately bypass the message catalogs.
 */

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { ReactNode } from "react";
import { useLocale } from "next-intl";
import type { Locale } from "@jenova/domain";
import { ToggleButton, ToggleButtonGroup } from "@jenova/ui";

const LABELS: Readonly<Record<Locale, string>> = {
  ar: "العربية",
  en: "English",
};

export function LocaleSwitcher(): ReactNode {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const switchTo = (next: Locale | null): void => {
    if (next === null || next === locale) return;
    startTransition(async () => {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      router.refresh();
    });
  };

  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={locale}
      disabled={pending}
      onChange={(_event, next: Locale | null) => switchTo(next)}
      aria-label={`${LABELS.ar} / ${LABELS.en}`}
    >
      <ToggleButton value="ar">{LABELS.ar}</ToggleButton>
      <ToggleButton value="en">{LABELS.en}</ToggleButton>
    </ToggleButtonGroup>
  );
}
