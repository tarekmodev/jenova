/**
 * The pending-confirmation sweep (issue #68): one pass polls every
 * provisioned tenant's due pending items through the booking-engine poller —
 * transitions happen through the runner ONLY — and re-dispatches any outbox
 * events an earlier crash left unpublished.
 *
 * Composition, not logic: the polling/backoff/escalation core lives in
 * @jenova/booking-engine (PendingConfirmationPoller); this module wires it
 * to the control-plane tenant list, the supplier registry and credentials.
 */

import { isNotNull } from "drizzle-orm";
import type { TenantId } from "@jenova/domain";
import { tenants, type ControlPlaneClient, type TenantDbResolver } from "@jenova/db";
import type { AdapterCallContext } from "@jenova/supplier-sdk";
import {
  BookingTransitionRunner,
  PendingConfirmationPoller,
  type PendingBackoffPolicy,
  type PollReport,
  type RetrieveBookingFn,
} from "@jenova/booking-engine";
import type { SupplierCredentialsSource, SupplierRegistry } from "@jenova/supplier-registry";

/** Supplier retrieve budget per poll hop. */
const RETRIEVE_DEADLINE_MS = 20_000;

/** Unpublished outbox events older than this are re-dispatched by the sweep. */
const OUTBOX_REDELIVERY_AGE_MS = 60_000;

export interface PendingSweepDeps {
  readonly controlPlane: ControlPlaneClient;
  readonly resolver: TenantDbResolver;
  readonly registry: SupplierRegistry;
  readonly credentials: SupplierCredentialsSource;
  readonly runner: BookingTransitionRunner;
  readonly backoff?: PendingBackoffPolicy;
}

export interface SweepReport {
  readonly tenants: number;
  readonly perTenant: readonly { tenantId: TenantId; report: PollReport; redelivered: number }[];
  readonly failures: readonly { tenantId: TenantId; error: string }[];
}

export function makeRetrieveFn(
  registry: SupplierRegistry,
  credentials: SupplierCredentialsSource,
): RetrieveBookingFn {
  return async (tenant, target) => {
    const adapter = registry.hotelAdapter(target.supplierCode);
    if (adapter === null) {
      throw new Error(`no adapter deployed for supplier ${target.supplierCode}`);
    }
    const ctx: AdapterCallContext = {
      credentials: await credentials.credentialsFor(tenant, target.supplierCode),
      deadline: new Date(Date.now() + RETRIEVE_DEADLINE_MS),
      // Retrieval addresses an existing reservation by reference; currency
      // echoes the ITEM's own (review M1 — no constants on a money path),
      // nationality is not applicable to retrieval and unused by adapters.
      nationality: "SA",
      currency: target.currency,
      locale: "en",
    };
    return adapter.retrieve(ctx, target.supplierBookingReference);
  };
}

export function createPendingSweep(deps: PendingSweepDeps): () => Promise<SweepReport> {
  const poller = new PendingConfirmationPoller(
    deps.resolver,
    deps.runner,
    makeRetrieveFn(deps.registry, deps.credentials),
    deps.backoff,
  );

  return async (): Promise<SweepReport> => {
    const provisioned = await deps.controlPlane.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(isNotNull(tenants.dbName));

    const perTenant: { tenantId: TenantId; report: PollReport; redelivered: number }[] = [];
    const failures: { tenantId: TenantId; error: string }[] = [];
    for (const tenant of provisioned) {
      try {
        const report = await poller.pollTenant(tenant.id);
        const redelivered = await deps.runner.outbox.republishUnpublished(
          tenant.id,
          new Date(Date.now() - OUTBOX_REDELIVERY_AGE_MS),
        );
        perTenant.push({ tenantId: tenant.id, report, redelivered });
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
