# @jenova/ui

Jenova's design system for dashboard-class apps (`dashboard`, `portal-agent`,
`portal-corporate`, `platform-admin`). It is the ONLY UI import those apps may use
(CLAUDE.md rule 10) — they never import `@mui/*` directly; the ESLint module-boundary
rule enforces this mechanically. `storefront-b2c` must not depend on this package.

Built on `@mui/material` v7 (MIT) + `@emotion` (MIT), RTL-first via a per-direction
emotion cache with `stylis-plugin-rtl`. Arabic (`ar`) is the default locale; English
(`en`) is the mirror.

## Provenance — the Modernize template is a reference, never a source

The Modernize (MUI) admin template is Tarek's licensed property and lives OUTSIDE this
repository. This repository is public: **no Modernize source file, component, stylesheet,
or asset may ever be committed here — copied, adapted, or renamed.** Modernize serves as
the *visual and structural reference only*: its palette, typography scale, shadow scale,
shape, layout metrics, and its RTL-variant technique informed the Jenova design tokens in
`src/theme/tokens.ts` (design-token *values* are facts, not code). Every component and
every line of code in this package is written fresh against the MIT-licensed MUI v7 /
emotion APIs. If you find yourself pasting from the template, stop — you are violating
the license and the repo's public-visibility guarantee.

## Structure

- `src/theme/tokens.ts` — Jenova design tokens: light + dark palettes, typography,
  shadows, shape, layout metrics, Arabic-capable font stack. Dark tokens exist so the
  structure is dark-ready; only the light theme ships in M2.
- `src/theme/createJenovaTheme.ts` — builds the MUI theme from tokens + direction.
- `src/direction/` — `DirectionProvider`, per-direction emotion cache
  (`stylis-plugin-rtl` for RTL), `useDirection`/`useLocale`.
- `src/providers/JenovaThemeProvider.tsx` — theme + direction + `CssBaseline` in one
  provider (what Storybook/tests use).
- `src/next/` — `JenovaNextProvider` (subpath `@jenova/ui/next`): the same provider
  composed with the Next.js App Router SSR emotion cache. Next apps use this one.
- `src/shell/` — AppShell, NavSection, DataTable, FormField, ConfirmDialog, Toast,
  PageHeader, StatusStates.
- `src/widgets/` — MoneyText, DateText, BookingStateChip, StreamingList, PolicyTimeline
  (consume `@jenova/domain` types: Money, BookingItemState, CancellationPolicy).
- `.storybook/` + `src/**/*.stories.tsx` — every component, with an ar/en locale and
  rtl/ltr direction toolbar.
- `screenshots/` — Playwright harness that screenshots every story in BOTH directions
  against a static Storybook build (CI job `ui-screenshots`).

## Rules for contributors

- **No hardcoded user-facing strings.** Every label, message, and aria text arrives via
  props/slots — the apps own the ar/en message catalogs.
- **No hardcoded direction.** Logical CSS properties (`marginInlineStart`,
  `textAlign: "end"`, `insetInlineEnd`, …) only; anything positional must derive from
  `useDirection()`. The stylis RTL plugin flips physical properties emitted by MUI
  internals — never rely on it for code you write yourself.
- **Money is `@jenova/domain` Money** (integer minor units + ISO 4217). Formatting is
  display-only (`formatMoney`), digits per tenant numeral setting (`latn` default,
  `arab` opt-in), tabular-nums everywhere money columns align.
- **Dates are Gregorian UTC** in props; Hijri is a display-only secondary line.
- Stories may use only obviously-synthetic structural values (CLAUDE.md rule 5) — never
  supplier-shaped payloads.
- Apps needing an MUI primitive not yet re-exported: add it to the curated re-export list
  in `src/index.ts` here — never import `@mui/*` from an app.
