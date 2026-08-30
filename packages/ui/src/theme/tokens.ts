/**
 * Jenova design tokens — the single source of the platform's visual language.
 *
 * Provenance: the token VALUES (palette, type scale, shadow scale, shape,
 * layout metrics) were read off the licensed Modernize (MUI) template that
 * Jenova standardizes on visually (docs/07-tech-stack.md); the template's
 * source lives outside this public repo and none of its code is used here
 * (see packages/ui/README.md). These are Jenova's tokens from this point on
 * — evolve them here, not against the template.
 *
 * Dark-ready: every palette/shadow token has a dark counterpart so the
 * structure supports a dark theme; only `light` ships in M2.
 */

export type ThemeMode = "light" | "dark";

export interface JenovaPaletteChannel {
  readonly main: string;
  readonly light: string;
  readonly dark: string;
  readonly contrastText: string;
}

export interface JenovaPalette {
  readonly primary: JenovaPaletteChannel;
  readonly secondary: JenovaPaletteChannel;
  readonly success: JenovaPaletteChannel;
  readonly info: JenovaPaletteChannel;
  readonly warning: JenovaPaletteChannel;
  readonly error: JenovaPaletteChannel;
  readonly grey: Readonly<Record<100 | 200 | 300 | 400 | 500 | 600, string>>;
  readonly text: { readonly primary: string; readonly secondary: string };
  readonly background: { readonly default: string; readonly paper: string };
  readonly divider: string;
  readonly action: {
    readonly hover: string;
    readonly hoverOpacity: number;
    readonly disabledBackground: string;
  };
}

const lightPalette: JenovaPalette = {
  primary: { main: "#5D87FF", light: "#ECF2FF", dark: "#4570EA", contrastText: "#ffffff" },
  secondary: { main: "#49BEFF", light: "#E8F7FF", dark: "#23afdb", contrastText: "#ffffff" },
  success: { main: "#13DEB9", light: "#E6FFFA", dark: "#02b3a9", contrastText: "#ffffff" },
  info: { main: "#539BFF", light: "#EBF3FE", dark: "#1682d4", contrastText: "#ffffff" },
  warning: { main: "#FFAE1F", light: "#FEF5E5", dark: "#ae8e59", contrastText: "#ffffff" },
  error: { main: "#FA896B", light: "#FDEDE8", dark: "#f3704d", contrastText: "#ffffff" },
  grey: {
    100: "#F2F6FA",
    200: "#EAEFF4",
    300: "#DFE5EF",
    400: "#7C8FAC",
    500: "#5A6A85",
    600: "#2A3547",
  },
  text: { primary: "#2A3547", secondary: "#5A6A85" },
  background: { default: "#F2F6FA", paper: "#ffffff" },
  divider: "#e5eaef",
  action: {
    hover: "#f6f9fc",
    hoverOpacity: 0.02,
    disabledBackground: "rgba(73,82,88,0.12)",
  },
};

const darkPalette: JenovaPalette = {
  primary: { main: "#5D87FF", light: "#253662", dark: "#4570EA", contrastText: "#ffffff" },
  secondary: { main: "#49BEFF", light: "#1C455D", dark: "#23afdb", contrastText: "#ffffff" },
  success: { main: "#13DEB9", light: "#1B3C48", dark: "#02b3a9", contrastText: "#ffffff" },
  info: { main: "#539BFF", light: "#223662", dark: "#1682d4", contrastText: "#ffffff" },
  warning: { main: "#FFAE1F", light: "#4D3A2A", dark: "#ae8e59", contrastText: "#ffffff" },
  error: { main: "#FA896B", light: "#4B313D", dark: "#f3704d", contrastText: "#ffffff" },
  grey: {
    100: "#333F55",
    200: "#465670",
    300: "#7C8FAC",
    400: "#DFE5EF",
    500: "#EAEFF4",
    600: "#F2F6FA",
  },
  text: { primary: "#EAEFF4", secondary: "#7C8FAC" },
  background: { default: "#171c23", paper: "#171c23" },
  divider: "#333F55",
  action: {
    hover: "#333F55",
    hoverOpacity: 0.02,
    disabledBackground: "rgba(73,82,88,0.12)",
  },
};

export const jenovaPalettes: Readonly<Record<ThemeMode, JenovaPalette>> = {
  light: lightPalette,
  dark: darkPalette,
};

/**
 * Arabic-capable font stack. Arabic-first: the primary face must carry both
 * scripts; system faces with solid Arabic coverage back it up. The apps load
 * the actual webfont (e.g. via next/font) and may override per tenant via
 * `createJenovaTheme({ fontFamily })`.
 */
export const jenovaFontFamily = [
  '"IBM Plex Sans Arabic"',
  '"Plus Jakarta Sans"',
  '"Noto Sans Arabic"',
  '"Segoe UI"',
  "Tahoma",
  "Helvetica",
  "Arial",
  "sans-serif",
].join(", ");

/** Type scale (rem-based; weights favor 600 headings / 400 body). */
export const jenovaTypography = {
  h1: { fontWeight: 600, fontSize: "2.25rem", lineHeight: "2.75rem" },
  h2: { fontWeight: 600, fontSize: "1.875rem", lineHeight: "2.25rem" },
  h3: { fontWeight: 600, fontSize: "1.5rem", lineHeight: "1.75rem" },
  h4: { fontWeight: 600, fontSize: "1.3125rem", lineHeight: "1.6rem" },
  h5: { fontWeight: 600, fontSize: "1.125rem", lineHeight: "1.6rem" },
  h6: { fontWeight: 600, fontSize: "1rem", lineHeight: "1.2rem" },
  body1: { fontSize: "0.875rem", fontWeight: 400, lineHeight: "1.334rem" },
  body2: { fontSize: "0.75rem", fontWeight: 400, lineHeight: "1rem", letterSpacing: "0rem" },
  subtitle1: { fontSize: "0.875rem", fontWeight: 400 },
  subtitle2: { fontSize: "0.875rem", fontWeight: 400 },
  /** No uppercase/capitalize transform — Arabic has no letter case. */
  button: { textTransform: "none", fontWeight: 500 },
} as const;

/**
 * 25-entry elevation scale (index 0 = none). Elevations 8–10 are the soft
 * "card" shadows the design language leans on; the rest step depth evenly.
 */
export const jenovaShadows: Readonly<Record<ThemeMode, readonly string[]>> = {
  light: [
    "none",
    "0px 2px 3px rgba(0,0,0,0.10)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 2px 2px -2px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 3px 4px -2px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 3px 4px -2px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 4px 6px -2px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 4px 6px -2px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 4px 8px -2px rgba(0,0,0,0.25)",
    "0 9px 17.5px rgb(0,0,0,0.05)",
    "rgb(145 158 171 / 30%) 0px 0px 2px 0px, rgb(145 158 171 / 12%) 0px 12px 24px -4px",
    "0px 6px 12px rgba(127, 145, 156, 0.12)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 6px 16px -4px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 7px 16px -4px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 8px 18px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 9px 18px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 10px 20px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 11px 20px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 12px 22px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 13px 22px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 14px 24px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 16px 28px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 18px 30px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 20px 32px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 22px 34px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 24px 36px -8px rgba(0,0,0,0.25)",
  ],
  dark: [
    "none",
    "0px 2px 3px rgba(0,0,0,0.10)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 2px 2px -2px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 3px 4px -2px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 3px 4px -2px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 4px 6px -2px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 4px 6px -2px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 4px 8px -2px rgba(0,0,0,0.25)",
    "0 9px 17.5px rgb(0,0,0,0.05)",
    "rgb(145 158 171 / 30%) 0px 0px 2px 0px, rgb(145 158 171 / 2%) 0px 12px 24px -4px",
    "0px 6px 12px rgba(127, 145, 156, 0.12)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 6px 16px -4px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 7px 16px -4px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 8px 18px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 9px 18px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 10px 20px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 11px 20px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 12px 22px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 13px 22px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 14px 24px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 16px 28px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 18px 30px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 20px 32px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 22px 34px -8px rgba(0,0,0,0.25)",
    "0 0 1px 0 rgba(0,0,0,0.31), 0 24px 36px -8px rgba(0,0,0,0.25)",
  ],
};

/** Index into the shadow scale for the resting card/surface elevation. */
export const jenovaCardShadowIndex = 9;

export const jenovaShape = { borderRadius: 7 } as const;

/** Shell layout metrics (px). */
export const jenovaLayout = {
  sidebarWidth: 270,
  miniSidebarWidth: 87,
  topbarHeight: 70,
} as const;
