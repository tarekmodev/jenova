/**
 * Typed environment configuration for the api process (issue #30).
 *
 * `.env.example` at the repo root is the AUTHORITATIVE variable list — any
 * variable this schema requires must exist there, and renames happen in both
 * places in the same commit. Loading fails fast: a missing or malformed
 * required variable aborts startup with every problem listed, never a partial
 * config.
 */

import { z } from "zod";

export const NODE_ENVS = ["development", "test", "production"] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

const apiEnvSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  // Required from day one: the gateway's tenant directory and rate limiting
  // are control-plane/redis reads as soon as #42 wiring lands, and requiring
  // them now keeps staging/production fail-fast instead of half-up.
  CONTROL_PLANE_DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  // Least-privilege runtime DSN for the tenant resolver (M1 offer store —
  // the first api surface that opens tenant connections).
  JENOVA_TENANT_RUNTIME_DSN: z.url(),
  // HMAC-SHA256 key behind every offer's signed price hash (CLAUDE.md
  // rule 8). ≥ 32 chars of real entropy. ROTATION: there is ONE active key —
  // rotating it fails verification of every outstanding offer token, so
  // in-flight shoppers re-search (offers live minutes; rotation costs one
  // brief re-search window, never money). See offers/signing.ts.
  OFFER_SIGNING_KEY: z.string().min(32),
});

export interface ApiConfig {
  readonly nodeEnv: NodeEnv;
  readonly port: number;
  readonly controlPlaneDatabaseUrl: string;
  readonly redisUrl: string;
  readonly tenantRuntimeDsn: string;
  readonly offerSigningKey: string;
}

/** Nest injection token for the loaded {@link ApiConfig}. */
export const API_CONFIG = Symbol("jenova.api.config");

export class ApiConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(`invalid api environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ApiConfigError";
  }
}

/**
 * Parse and validate the environment. Pure — callers pass `process.env` (or a
 * literal object in tests) and get a frozen config or an {@link ApiConfigError}
 * listing every missing/invalid variable.
 */
export function loadApiConfig(env: Readonly<Record<string, string | undefined>>): ApiConfig {
  const parsed = apiEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ApiConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return Object.freeze({
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.API_PORT,
    controlPlaneDatabaseUrl: parsed.data.CONTROL_PLANE_DATABASE_URL,
    redisUrl: parsed.data.REDIS_URL,
    tenantRuntimeDsn: parsed.data.JENOVA_TENANT_RUNTIME_DSN,
    offerSigningKey: parsed.data.OFFER_SIGNING_KEY,
  });
}
