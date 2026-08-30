/**
 * Builds the MUI theme from Jenova tokens (tokens.ts) + direction.
 *
 * Direction is a THEME INPUT, never a component concern: components use
 * logical CSS properties and `useDirection()`; nothing hardcodes ltr/rtl.
 */

import { createTheme, type Direction, type Theme } from "@mui/material/styles";
import {
  jenovaCardShadowIndex,
  jenovaFontFamily,
  jenovaLayout,
  jenovaPalettes,
  jenovaShadows,
  jenovaShape,
  jenovaTypography,
  type ThemeMode,
} from "./tokens";

export interface CreateJenovaThemeOptions {
  readonly direction: Direction;
  /** Dark tokens exist (dark-ready structure); only "light" ships in M2. */
  readonly mode?: ThemeMode;
  /** Tenant/app override for the Arabic-capable default stack. */
  readonly fontFamily?: string;
}

export function createJenovaTheme(options: CreateJenovaThemeOptions): Theme {
  const mode: ThemeMode = options.mode ?? "light";
  const palette = jenovaPalettes[mode];
  const shadows = jenovaShadows[mode];

  const theme = createTheme({
    direction: options.direction,
    palette: {
      mode,
      primary: palette.primary,
      secondary: palette.secondary,
      success: palette.success,
      info: palette.info,
      warning: palette.warning,
      error: palette.error,
      grey: palette.grey,
      text: palette.text,
      background: palette.background,
      divider: palette.divider,
      action: {
        hover: palette.action.hover,
        hoverOpacity: palette.action.hoverOpacity,
        disabledBackground: palette.action.disabledBackground,
      },
    },
    shape: { borderRadius: jenovaShape.borderRadius },
    shadows: [...shadows] as Theme["shadows"],
    typography: {
      fontFamily: options.fontFamily ?? jenovaFontFamily,
      ...jenovaTypography,
    },
  });

  theme.components = {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: palette.background.default },
      },
    },
    MuiCard: {
      defaultProps: { elevation: jenovaCardShadowIndex },
      styleOverrides: {
        root: { borderRadius: jenovaShape.borderRadius },
      },
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: "none" } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 500 } },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 600,
          color: palette.text.primary,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          boxShadow: "none",
          backgroundColor: palette.background.paper,
          color: palette.text.primary,
          borderBlockEnd: `1px solid ${palette.divider}`,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: { backgroundColor: palette.background.paper },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: { borderRadius: jenovaShape.borderRadius },
      },
    },
  };

  return theme;
}

export { jenovaLayout };
