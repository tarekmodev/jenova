// Module-boundary enforcement (CLAUDE.md rules 3, 4, 10; docs/07-tech-stack.md).
// If this config blocks an import, the design is wrong — not the linter.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";

const DASHBOARD_CLASS_APPS = "(dashboard|portal-agent|portal-corporate|platform-admin)";
const MUI_AND_MODERNIZE = [
  "@mui/*",
  "@mui/*/**",
  "modernize",
  "modernize/**",
  "@modernize/*",
  "@modernize/*/**",
];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "packages/sandbox-replay/raw-captures/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: { boundaries },
    settings: {
      "import/resolver": {
        typescript: {
          project: "./tsconfig.base.json",
          alwaysTryTypes: true,
        },
      },
      // Order matters: first match wins, so carve supplier-registry, adapters
      // and ui out of packages/* before the generic patterns.
      "boundaries/elements": [
        { type: "supplier-registry", pattern: "packages/supplier-registry" },
        {
          type: "adapter",
          pattern: "packages/adapters/*/*",
          capture: ["vertical", "supplier"],
        },
        { type: "ui", pattern: "packages/ui" },
        { type: "package", pattern: "packages/*", capture: ["pkg"] },
        { type: "app", pattern: "apps/*", capture: ["app"] },
        { type: "e2e", pattern: "e2e" },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          // Also evaluate imports of external/core modules (needed for the
          // MUI/Modernize ban below); the first policy allows them in general.
          checkAllOrigins: true,
          policies: [
            {
              // External and Node core modules are allowed by default —
              // later policies override this (last matching policy wins).
              allow: [
                { to: { module: { origin: "external" } } },
                { to: { module: { origin: "core" } } },
              ],
            },
            {
              from: { element: { type: "package" } },
              allow: { to: { element: { type: "package" } } },
            },
            {
              from: { element: { type: "ui" } },
              allow: { to: { element: { type: "package" } } },
            },
            {
              // Apps may consume shared packages — never other apps.
              from: { element: { type: "app" } },
              allow: { to: { element: { type: "package" } } },
              message:
                "Apps may only import shared @jenova packages — never other apps (docs/07-tech-stack.md)",
            },
            {
              // Only dashboard-class apps consume the Modernize-wrapping ui kit;
              // storefront-b2c is custom Tailwind and must not depend on it.
              from: { element: { type: "app", captured: { app: DASHBOARD_CLASS_APPS } } },
              allow: { to: { element: { type: "ui" } } },
            },
            {
              // Only the two ENGINE processes consume the supplier registry;
              // frontends and other packages never reach adapters, even
              // transitively through it.
              from: { element: { type: "app", captured: { app: "(api|worker)" } } },
              allow: { to: { element: { type: "supplier-registry" } } },
            },
            {
              // The supplier registry is the ONLY place adapter packages may be imported.
              from: { element: { type: "supplier-registry" } },
              allow: [{ to: { element: { types: { anyOf: ["adapter", "package"] } } } }],
            },
            {
              // Adapters translate to canonical domain types; they may not reach
              // into engine modules (apps/api) or other adapters.
              from: { element: { type: "adapter" } },
              allow: {
                to: {
                  element: { type: "package", captured: { pkg: "(domain|supplier-sdk|sandbox-replay)" } },
                },
              },
              message:
                "Adapters may only import @jenova/domain, @jenova/supplier-sdk and @jenova/sandbox-replay — never engine modules or other adapters (CLAUDE.md rule 4)",
            },
            {
              from: { element: { type: "e2e" } },
              allow: { to: { element: { type: "package" } } },
            },
            {
              // Dashboard-class apps use ONLY @jenova/ui — never MUI/Modernize directly;
              // storefront-b2c is custom Tailwind — no MUI (and no @jenova/ui, above).
              from: {
                element: {
                  type: "app",
                  captured: { app: `(${DASHBOARD_CLASS_APPS.slice(1, -1)}|storefront-b2c)` },
                },
              },
              disallow: {
                to: { module: { origin: "external", source: MUI_AND_MODERNIZE } },
              },
              message:
                "Only @jenova/ui may wrap MUI/Modernize — apps never import them directly (CLAUDE.md rule 10)",
            },
          ],
        },
      ],
    },
  },
);
