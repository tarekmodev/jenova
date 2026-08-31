import path from "node:path";
import type { NextConfig } from "next";

/**
 * Agent Portal (docs/apps/b2b.md, Agent Portal side). Workspace packages are
 * source-shipped TypeScript — Next transpiles them.
 */
const nextConfig: NextConfig = {
  transpilePackages: ["@jenova/ui", "@jenova/domain"],
  // Monorepo: file tracing roots at the workspace, not the app.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
};

export default nextConfig;
