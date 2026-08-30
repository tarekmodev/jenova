/**
 * Global Storybook setup: every story renders inside JenovaThemeProvider
 * with an ar/en locale toolbar (Arabic default — CLAUDE.md rule 9) and an
 * rtl/ltr direction toolbar (auto = derived from locale; the override
 * exists to catch direction bugs, production always derives).
 */

import type { Decorator, Preview } from "@storybook/react-vite";
import { isLocale, type Locale } from "@jenova/domain";
import { JenovaThemeProvider } from "../src/providers/JenovaThemeProvider";
import type { UiDirection } from "../src/direction/direction";

const withJenovaTheme: Decorator = (Story, context) => {
  const locale: Locale =
    typeof context.globals.locale === "string" && isLocale(context.globals.locale)
      ? context.globals.locale
      : "ar";
  const direction = context.globals.direction;
  const override: UiDirection | undefined =
    direction === "rtl" || direction === "ltr" ? direction : undefined;
  return (
    <JenovaThemeProvider locale={locale} {...(override !== undefined ? { direction: override } : {})}>
      <Story />
    </JenovaThemeProvider>
  );
};

const preview: Preview = {
  globalTypes: {
    locale: {
      description: "UI locale (Arabic is the product default)",
      toolbar: {
        title: "Locale",
        icon: "globe",
        items: [
          { value: "ar", title: "العربية (ar)" },
          { value: "en", title: "English (en)" },
        ],
        dynamicTitle: true,
      },
    },
    direction: {
      description: "Direction override (auto derives from locale)",
      toolbar: {
        title: "Direction",
        icon: "transfer",
        items: [
          { value: "auto", title: "auto (from locale)" },
          { value: "rtl", title: "rtl" },
          { value: "ltr", title: "ltr" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { locale: "ar", direction: "auto" },
  decorators: [withJenovaTheme],
  parameters: {
    layout: "padded",
  },
};

export default preview;
