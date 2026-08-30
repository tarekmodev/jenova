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
import { NODE_ENVS, type NodeEnv } from "@jenova/supplier-registry";

// Single-source NodeEnv vocabulary (supplier-registry gates transport mode
// AND the credentials seam on it); re-exported for existing importers.
export { NODE_ENVS, type NodeEnv };

const apiEnvSchema = z.object({
  // FAIL-CLOSED (review round 2): an unset NODE_ENV is PRODUCTION — live
  // transport, no recordings, no env credentials. Development must be asked
  // for by name (.env.example sets it; main.ts loads .env in local dev).
  NODE_ENV: z.enum(NODE_ENVS).default("production"),
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
  // Hard total budget for one hotel search fan-out (docs/02: ~8s hotels).
  // Platform-level; the service clamps any value to its safe bounds.
  HOTEL_SEARCH_BUDGET_MS: z.coerce.number().int().min(500).max(30_000).default(8_000),
  // --- Documents v1 (M2 #99): object store for rendered PDFs + Typst -----
  // The S3 block is all-or-nothing: fully set → documents enabled; fully
  // unset → the voucher endpoint answers documents_unavailable; partial →
  // fail fast (a half-configured store must never boot quietly).
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false"),
  DOCUMENTS_TYPST_BIN: z.string().min(1).default("typst"),
});

export interface DocumentsConfig {
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
  };
  readonly typstBin: string;
}

const S3_KEYS = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET",
] as const;

interface DocumentsEnvSlice {
  readonly S3_ENDPOINT?: string | undefined;
  readonly S3_REGION?: string | undefined;
  readonly S3_ACCESS_KEY_ID?: string | undefined;
  readonly S3_SECRET_ACCESS_KEY?: string | undefined;
  readonly S3_BUCKET?: string | undefined;
  readonly S3_FORCE_PATH_STYLE: "true" | "false";
  readonly DOCUMENTS_TYPST_BIN: string;
}

/** All-or-nothing S3 block: fully set, fully unset, or fail fast. */
export function resolveDocumentsConfig(parsed: DocumentsEnvSlice): DocumentsConfig | null {
  const missing = S3_KEYS.filter((key) => parsed[key] === undefined);
  if (missing.length === S3_KEYS.length) {
    return null;
  }
  if (missing.length > 0) {
    throw new ApiConfigError(
      missing.map((key) => `${key}: required when any S3_* variable is set (all-or-nothing)`),
    );
  }
  return {
    s3: {
      endpoint: parsed.S3_ENDPOINT as string,
      region: parsed.S3_REGION as string,
      accessKeyId: parsed.S3_ACCESS_KEY_ID as string,
      secretAccessKey: parsed.S3_SECRET_ACCESS_KEY as string,
      bucket: parsed.S3_BUCKET as string,
      forcePathStyle: parsed.S3_FORCE_PATH_STYLE === "true",
    },
    typstBin: parsed.DOCUMENTS_TYPST_BIN,
  };
}

export interface ApiConfig {
  readonly nodeEnv: NodeEnv;
  readonly port: number;
  readonly controlPlaneDatabaseUrl: string;
  readonly redisUrl: string;
  readonly tenantRuntimeDsn: string;
  readonly offerSigningKey: string;
  readonly hotelSearchBudgetMs: number;
  /** Null = documents disabled (no S3 block configured). */
  readonly documents: DocumentsConfig | null;
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
    hotelSearchBudgetMs: parsed.data.HOTEL_SEARCH_BUDGET_MS,
    documents: resolveDocumentsConfig(parsed.data),
  });
}
