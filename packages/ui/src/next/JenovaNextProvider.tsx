"use client";

/**
 * JenovaNextProvider — JenovaThemeProvider composed with the App Router
 * per-request SSR emotion cache (@mui/material-nextjs), built with the
 * same per-direction options (stylis-plugin-rtl for rtl) as the client
 * cache, so server-rendered styles are direction-correct with no flash.
 *
 * The app's root layout still owns `<html dir lang>` server-side; the
 * client-side sync in DirectionProvider keeps them consistent after
 * locale switches.
 */

import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import type { ReactNode } from "react";
import type { Locale } from "@jenova/domain";
import { directionCacheOptions } from "../direction/cache";
import { DEFAULT_LOCALE, resolveDirection } from "../direction/direction";
import {
  JenovaThemeProvider,
  type JenovaThemeProviderProps,
} from "../providers/JenovaThemeProvider";

export type JenovaNextProviderProps = Omit<JenovaThemeProviderProps, "withEmotionCache">;

export function JenovaNextProvider(props: JenovaNextProviderProps): ReactNode {
  const locale: Locale = props.locale ?? DEFAULT_LOCALE;
  const direction = resolveDirection(locale, props.direction);
  return (
    <AppRouterCacheProvider options={directionCacheOptions(direction)}>
      <JenovaThemeProvider {...props} withEmotionCache={false} />
    </AppRouterCacheProvider>
  );
}
