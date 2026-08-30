/**
 * Worker entrypoint (issue #68): the real BullMQ bootstrap replacing the M0
 * idle heartbeat. One queue, one repeatable job scheduler:
 *
 *   booking-pending — the pending-confirmation sweep, every
 *   WORKER_PENDING_SWEEP_INTERVAL_MS: polls due pending_confirmation and
 *   pending-cancel booking items across all provisioned tenants (transitions
 *   through the runner ONLY, escalation to the manual queue on max age) and
 *   re-dispatches unpublished outbox events.
 *
 * Supplier retries beyond the sweep's own backoff stay inside the transport
 * client (bounded, idempotent-only); the sweep never blind-retries book().
 */

import { existsSync } from "node:fs";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { connectControlPlane, createTenantDbResolver } from "@jenova/db";
import { BookingTransitionRunner, NoopEventSink } from "@jenova/booking-engine";
import {
  createSupplierRegistry,
  EnvSupplierCredentialsSource,
  UnboundSupplierCredentialsSource,
} from "@jenova/supplier-registry";
import { loadWorkerConfig, WorkerConfigError } from "./config";
import { createPendingSweep } from "./pending-sweep";

export const PENDING_QUEUE_NAME = "booking-pending";
export const PENDING_SWEEP_JOB = "pending-sweep";

async function bootstrap(): Promise<void> {
  // Node 22 native .env loading — local dev only; staging/production inject
  // real environment variables from the deployment secret store.
  if (existsSync(".env")) {
    process.loadEnvFile();
  }
  const config = loadWorkerConfig(process.env);

  const controlPlane = connectControlPlane({ url: config.controlPlaneDatabaseUrl });
  const resolver = createTenantDbResolver(controlPlane, {
    runtimeDsn: config.tenantRuntimeDsn,
  });
  const runner = new BookingTransitionRunner(resolver, new NoopEventSink());
  const registry = createSupplierRegistry();
  const credentials =
    config.nodeEnv === "development"
      ? new EnvSupplierCredentialsSource()
      : new UnboundSupplierCredentialsSource();
  const sweep = createPendingSweep({ controlPlane, resolver, registry, credentials, runner });

  // BullMQ requires maxRetriesPerRequest: null on worker connections.
  const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

  const queue = new Queue(PENDING_QUEUE_NAME, { connection });
  await queue.upsertJobScheduler(
    PENDING_SWEEP_JOB,
    { every: config.pendingSweepIntervalMs },
    { name: PENDING_SWEEP_JOB },
  );

  const worker = new Worker(
    PENDING_QUEUE_NAME,
    async () => {
      const report = await sweep();
      const polled = report.perTenant.reduce((sum, t) => sum + t.report.due, 0);
      if (polled > 0 || report.failures.length > 0) {
        console.log(
          `[worker] pending sweep: ${String(report.tenants)} tenants, ${String(polled)} due items` +
            (report.failures.length > 0 ? `, ${String(report.failures.length)} tenant failures` : ""),
        );
        for (const failure of report.failures) {
          console.error(`[worker] tenant ${failure.tenantId}: ${failure.error}`);
        }
      }
      return report;
    },
    { connection, concurrency: 1 },
  );
  worker.on("failed", (job, error) => {
    console.error(`[worker] job ${job?.name ?? "?"} failed:`, error.message);
  });

  console.log(
    `[worker] up — ${PENDING_QUEUE_NAME} sweep every ${String(config.pendingSweepIntervalMs)}ms`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] ${signal} — shutting down`);
    await worker.close();
    await queue.close();
    connection.disconnect();
    await resolver.close();
    await controlPlane.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

bootstrap().catch((error: unknown) => {
  if (error instanceof WorkerConfigError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
