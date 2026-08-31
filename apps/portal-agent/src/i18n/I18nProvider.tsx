"use client";

/**
 * Client-side access to the message catalog. The locale itself is decided
 * server-side (cookie, Arabic default) and flows in from the root layout —
 * this provider only distributes the matching catalog.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { Locale } from "@jenova/domain";
import { MESSAGES, type Messages } from "./messages";

interface I18nContextValue {
  readonly locale: Locale;
  readonly messages: Messages;
}

const I18nContext = createContext<I18nContextValue>({ locale: "ar", messages: MESSAGES.ar });

export function I18nProvider(props: { locale: Locale; children: ReactNode }): ReactNode {
  return (
    <I18nContext.Provider value={{ locale: props.locale, messages: MESSAGES[props.locale] }}>
      {props.children}
    </I18nContext.Provider>
  );
}

export function useMessages(): Messages {
  return useContext(I18nContext).messages;
}

export function useAppLocale(): Locale {
  return useContext(I18nContext).locale;
}
