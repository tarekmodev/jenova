/**
 * Documents delivery sweep (issue #100): one pass runs the voucher delivery
 * consumer — booking_item.confirmed events → render voucher → email — over
 * every provisioned tenant. Composition only: the consumption/backoff/
 * escalation core lives in @jenova/documents (VoucherDeliveryConsumer).
 */

import { isNotNull } from "drizzle-orm";
import type { TenantId } from "@jenova/domain";
import { tenants, type ControlPlaneClient, type TenantDbResolver } from "@jenova/db";
import type { BookingTransitionRunner } from "@jenova/booking-engine";
import {
  DocumentsService,
  S3DocumentStore,
  SmtpMailSender,
  TypstRenderer,
  VoucherDeliveryConsumer,
  type DeliveryReport,
} from "@jenova/documents";
import type { DocumentsDeliveryConfig } from "./config";

export interface DocumentDeliverySweepDeps {
  readonly controlPlane: ControlPlaneClient;
  readonly resolver: TenantDbResolver;
  readonly runner: BookingTransitionRunner;
  readonly config: DocumentsDeliveryConfig;
}

export interface DocumentDeliverySweepReport {
  readonly tenants: number;
  readonly perTenant: readonly { tenantId: TenantId; report: DeliveryReport }[];
  readonly failures: readonly { tenantId: TenantId; error: string }[];
}

export function createDocumentDeliverySweep(
  deps: DocumentDeliverySweepDeps,
): () => Promise<DocumentDeliverySweepReport> {
  const documents = new DocumentsService({
    resolver: deps.resolver,
    controlPlane: deps.controlPlane,
    store: new S3DocumentStore(deps.config.s3),
    renderer: new TypstRenderer({ bin: deps.config.typstBin }),
  });
  const consumer = new VoucherDeliveryConsumer({
    resolver: deps.resolver,
    documents,
    mail: new SmtpMailSender({
      host: deps.config.smtp.host,
      port: deps.config.smtp.port,
      from: deps.config.from,
      ...(deps.config.smtp.user === undefined ? {} : { user: deps.config.smtp.user }),
      ...(deps.config.smtp.password === undefined
        ? {}
        : { password: deps.config.smtp.password }),
    }),
    runner: deps.runner,
  });

  return async (): Promise<DocumentDeliverySweepReport> => {
    const provisioned = await deps.controlPlane.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(isNotNull(tenants.dbName));

    const perTenant: { tenantId: TenantId; report: DeliveryReport }[] = [];
    const failures: { tenantId: TenantId; error: string }[] = [];
    for (const tenant of provisioned) {
      try {
        const report = await consumer.sweepTenant(tenant.id);
        perTenant.push({ tenantId: tenant.id, report });
      } catch (error) {
        // One tenant's failure never blocks the rest of the sweep.
        failures.push({
          tenantId: tenant.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { tenants: provisioned.length, perTenant, failures };
  };
}
