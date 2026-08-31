/**
 * Typed environment configuration for the worker process (issue #68).
 * Same discipline as the api's config: `.env.example` is the authoritative
 * variable list, loading fails fast with every problem listed.
 */

import { z } from "zod";
import { NODE_ENVS, type NodeEnv } from "@jenova/supplier-registry";

// Single-source NodeEnv vocabulary (supplier-registry gates transport mode
// AND the credentials seam on it); re-exported for existing importers.
export { NODE_ENVS, type NodeEnv };

const workerEnvSchema = z.object({
  // FAIL-CLOSED (review round 2): unset NODE_ENV is PRODUCTION — live
  // transport, Unbound credentials; development must be asked for by name.
  NODE_ENV: z.enum(NODE_ENVS).default("production"),
  REDIS_URL: z.url(),
  CONTROL_PLANE_DATABASE_URL: z.url(),
  JENOVA_TENANT_RUNTIME_DSN: z.url(),
  /** Pending-confirmation sweep cadence (BullMQ job scheduler), ms. */
  WORKER_PENDING_SWEEP_INTERVAL_MS: z.coerce.number().int().min(1_000).default(30_000),
  // --- Documents delivery (M2 #100): confirm-event → voucher → email -----
  // All-or-nothing per block: S3_* (object store) and SMTP_HOST/SMTP_PORT/
  // MAIL_FROM (outbound mail). Both blocks set → delivery runs; both unset →
  // delivery is disabled with a log line; a partial block fails startup.
  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false"),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(3).optional(),
  DOCUMENTS_TYPST_BIN: z.string().min(1).default("typst"),
  WORKER_DOCUMENT_DELIVERY_INTERVAL_MS: z.coerce.number().int().min(1_000).default(30_000),
});

export interface DocumentsDeliveryConfig {
  readonly s3: {
    readonly endpoint: string;
    readonly region: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly bucket: string;
    readonly forcePathStyle: boolean;
  };
  readonly smtp: {
    readonly host: string;
    readonly port: number;
    readonly user?: string;
    readonly password?: string;
  };
  readonly from: string;
  readonly typstBin: string;
  readonly intervalMs: number;
}

type ParsedWorkerEnv = z.infer<typeof workerEnvSchema>;

function resolveDocumentsDelivery(parsed: ParsedWorkerEnv): DocumentsDeliveryConfig | null {
  const required = {
    S3_ENDPOINT: parsed.S3_ENDPOINT,
    S3_REGION: parsed.S3_REGION,
    S3_ACCESS_KEY_ID: parsed.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: parsed.S3_SECRET_ACCESS_KEY,
    S3_BUCKET: parsed.S3_BUCKET,
    SMTP_HOST: parsed.SMTP_HOST,
    SMTP_PORT: parsed.SMTP_PORT,
    MAIL_FROM: parsed.MAIL_FROM,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);
  if (missing.length === Object.keys(required).length) {
    return null; // documents delivery deliberately not configured
  }
  if (missing.length > 0) {
    throw new WorkerConfigError(
      missing.map(
        (key) => `${key}: required when any documents-delivery variable is set (all-or-nothing)`,
      ),
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
    smtp: {
      host: parsed.SMTP_HOST as string,
      port: parsed.SMTP_PORT as number,
      ...(parsed.SMTP_USER === undefined ? {} : { user: parsed.SMTP_USER }),
      ...(parsed.SMTP_PASSWORD === undefined ? {} : { password: parsed.SMTP_PASSWORD }),
    },
    from: parsed.MAIL_FROM as string,
    typstBin: parsed.DOCUMENTS_TYPST_BIN,
    intervalMs: parsed.WORKER_DOCUMENT_DELIVERY_INTERVAL_MS,
  };
}

export interface WorkerConfig {
  readonly nodeEnv: NodeEnv;
  readonly redisUrl: string;
  readonly controlPlaneDatabaseUrl: string;
  readonly tenantRuntimeDsn: string;
  readonly pendingSweepIntervalMs: number;
  /** Null = documents delivery disabled (no S3/SMTP blocks configured). */
  readonly documentsDelivery: DocumentsDeliveryConfig | null;
}

export class WorkerConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(
      `invalid worker environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    this.name = "WorkerConfigError";
  }
}

export function loadWorkerConfig(
  env: Readonly<Record<string, string | undefined>>,
): WorkerConfig {
  const parsed = workerEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new WorkerConfigError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return Object.freeze({
    nodeEnv: parsed.data.NODE_ENV,
    redisUrl: parsed.data.REDIS_URL,
    controlPlaneDatabaseUrl: parsed.data.CONTROL_PLANE_DATABASE_URL,
    tenantRuntimeDsn: parsed.data.JENOVA_TENANT_RUNTIME_DSN,
    pendingSweepIntervalMs: parsed.data.WORKER_PENDING_SWEEP_INTERVAL_MS,
    documentsDelivery: resolveDocumentsDelivery(parsed.data),
  });
}
