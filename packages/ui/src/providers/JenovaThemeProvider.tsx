"use client";

/**
 * JenovaThemeProvider — theme + direction + CssBaseline in one wrapper.
 *
 * The one provider dashboard-class surfaces (and Storybook/tests) mount at
 * their root. Next.js apps mount `JenovaNextProvider` from `@jenova/ui/next`
 * instead, which composes this with the App Router SSR emotion cache.
 */

import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { useMemo, type ReactNode } from "react";
import type { Locale } from "@jenova/domain";
import { DirectionProvider, useDirection } from "../direction/DirectionProvider";
import type { UiDirection } from "../direction/direction";
import { createJenovaTheme } from "../theme/createJenovaTheme";
import type { ThemeMode } from "../theme/tokens";

export interface JenovaThemeProviderProps {
  /** Defaults to Arabic — the product-wide primary locale. */
  readonly locale?: Locale;
  /** Tooling-only direction override (Storybook toolbar). */
  readonly direction?: UiDirection;
  /** Dark-ready structure; only "light" ships in M2. */
  readonly mode?: ThemeMode;
  /** Tenant/app font override for the Arabic-capable default stack. */
  readonly fontFamily?: string;
  /** False when an SSR-aware emotion cache already wraps the tree. */
  readonly withEmotionCache?: boolean;
  readonly children: ReactNode;
}

function ThemedSubtree(props: {
  readonly mode: ThemeMode | undefined;
  readonly fontFamily: string | undefined;
  readonly children: ReactNode;
}): ReactNode {
  const direction = useDirection();
  const theme = useMemo(
    () =>
      createJenovaTheme({
        direction,
        ...(props.mode !== undefined ? { mode: props.mode } : {}),
        ...(props.fontFamily !== undefined ? { fontFamily: props.fontFamily } : {}),
      }),
    [direction, props.mode, props.fontFamily],
  );
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {props.children}
    </ThemeProvider>
  );
}

export function JenovaThemeProvider(props: JenovaThemeProviderProps): ReactNode {
  return (
    <DirectionProvider
      {...(props.locale !== undefined ? { locale: props.locale } : {})}
      {...(props.direction !== undefined ? { direction: props.direction } : {})}
      {...(props.withEmotionCache !== undefined
        ? { withEmotionCache: props.withEmotionCache }
        : {})}
    >
      <ThemedSubtree mode={props.mode} fontFamily={props.fontFamily}>
        {props.children}
      </ThemedSubtree>
    </DirectionProvider>
  );
}
