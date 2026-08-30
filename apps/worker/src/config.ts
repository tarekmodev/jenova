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
});

export interface WorkerConfig {
  readonly nodeEnv: NodeEnv;
  readonly redisUrl: string;
  readonly controlPlaneDatabaseUrl: string;
  readonly tenantRuntimeDsn: string;
  readonly pendingSweepIntervalMs: number;
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
  });
}
