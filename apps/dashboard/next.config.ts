import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (no build step) — Next
  // compiles them. @jenova/ui is the ONLY UI import (CLAUDE.md rule 10).
  transpilePackages: ["@jenova/ui", "@jenova/domain"],
  // Pin the tracing root to THIS monorepo checkout — git worktrees see the
  // primary checkout's lockfile too and Next would guess the wrong root.
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // App sections live at /apps/<appKey> (the app-framework URL space) but
  // the route folder is `appsection`: a literal `apps/` folder inside the
  // route tree would shadow the repo-level apps/* element in the ESLint
  // boundaries config (it matches path segments from the right).
  rewrites: () =>
    Promise.resolve([{ source: "/apps/:path*", destination: "/appsection/:path*" }]),
};

export default withNextIntl(nextConfig);
