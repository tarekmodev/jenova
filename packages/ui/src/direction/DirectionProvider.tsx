"use client";

/**
 * DirectionProvider — flips the whole tree rtl/ltr from a Locale.
 *
 * Provides { locale, direction } context, mounts the per-direction emotion
 * cache (stylis-plugin-rtl for rtl), and keeps <html dir/lang> in sync on
 * the client. Arabic → rtl by default; `direction` overrides only for
 * tooling (Storybook's direction toolbar).
 *
 * `withEmotionCache={false}` skips the client cache when an SSR-aware cache
 * provider already wraps the tree (see src/next/JenovaNextProvider).
 */

import { CacheProvider } from "@emotion/react";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import type { Locale } from "@jenova/domain";
import { createDirectionCache } from "./cache";
import { DEFAULT_LOCALE, resolveDirection, type UiDirection } from "./direction";

export interface DirectionContextValue {
  readonly locale: Locale;
  readonly direction: UiDirection;
}

const DirectionContext = createContext<DirectionContextValue>({
  locale: DEFAULT_LOCALE,
  direction: resolveDirection(DEFAULT_LOCALE),
});

export function useDirection(): UiDirection {
  return useContext(DirectionContext).direction;
}

export function useLocale(): Locale {
  return useContext(DirectionContext).locale;
}

export interface DirectionProviderProps {
  /** Defaults to Arabic — the product-wide primary locale. */
  readonly locale?: Locale;
  /** Tooling-only override; production direction derives from locale. */
  readonly direction?: UiDirection;
  readonly withEmotionCache?: boolean;
  readonly children: ReactNode;
}

export function DirectionProvider(props: DirectionProviderProps): ReactNode {
  const locale = props.locale ?? DEFAULT_LOCALE;
  const direction = resolveDirection(locale, props.direction);
  const withCache = props.withEmotionCache ?? true;

  const value = useMemo<DirectionContextValue>(
    () => ({ locale, direction }),
    [locale, direction],
  );

  // One cache per direction per provider instance (a fresh render tree —
  // e.g. a server request — gets fresh caches; a client toggle reuses them).
  const cache = useMemo(
    () => (withCache ? createDirectionCache(direction) : null),
    [withCache, direction],
  );

  useEffect(() => {
    document.documentElement.dir = direction;
    document.documentElement.lang = locale;
  }, [direction, locale]);

  const tree = <DirectionContext.Provider value={value}>{props.children}</DirectionContext.Provider>;
  return cache ? <CacheProvider value={cache}>{tree}</CacheProvider> : tree;
}
