import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (no build step) — Next
  // compiles them. @jenova/ui is the ONLY UI import (CLAUDE.md rule 10).
  transpilePackages: ["@jenova/ui", "@jenova/domain"],
};

export default withNextIntl(nextConfig);
