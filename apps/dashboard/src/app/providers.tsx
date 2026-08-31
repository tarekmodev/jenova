"use client";

/**
 * Client provider stack: Jenova theme + direction (SSR-cached emotion) and
 * the ui kit's toast surface. Locale arrives from the server layout — the
 * single source is the locale cookie read per request.
 */

import type { ReactNode } from "react";
import type { Locale } from "@jenova/domain";
import { ToastProvider } from "@jenova/ui";
import { JenovaNextProvider } from "@jenova/ui/next";

export function Providers(props: {
  readonly locale: Locale;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <JenovaNextProvider locale={props.locale}>
      <ToastProvider>{props.children}</ToastProvider>
    </JenovaNextProvider>
  );
}
