/**
 * Which suppliers a tenant's search fans out to (issue #59).
 *
 * The tenant database's `supplier_account` rows are the source of truth —
 * tenants trade on their OWN supplier accounts (Jenova is a technology
 * partner, never a merchant), so an account that is not enabled is simply
 * not searched. The Drizzle implementation reaches tenant data ONLY through
 * the @jenova/db resolver (CLAUDE.md rule 1); the in-memory implementation
 * backs unit tests and the pre-provisioning boot path with the structural
 * values those callers set themselves.
 */

import { eq } from "drizzle-orm";
import type { TenantId } from "@jenova/domain";
import { supplierAccounts, type TenantDbResolver } from "@jenova/db";

/** Nest injection token for the process-wide {@link SupplierAccountsSource}. */
export const SUPPLIER_ACCOUNTS_SOURCE = Symbol("jenova.api.supplierAccountsSource");

export interface SupplierAccountsSource {
  /**
   * Distinct supplier codes with at least one ENABLED account for this
   * tenant. Vertical filtering happens against the adapter registry (the
   * platform's knowledge of which codes are hotel suppliers), not here.
   */
  enabledSupplierCodes(tenant: TenantId): Promise<readonly string[]>;
}

export class DrizzleSupplierAccountsSource implements SupplierAccountsSource {
  constructor(private readonly resolver: TenantDbResolver) {}

  async enabledSupplierCodes(tenant: TenantId): Promise<readonly string[]> {
    const db = await this.resolver.getTenantDb(tenant);
    const rows = await db
      .select({ supplierCode: supplierAccounts.supplierCode })
      .from(supplierAccounts)
      .where(eq(supplierAccounts.enabled, true));
    return [...new Set(rows.map((row) => row.supplierCode))];
  }
}

/** Per-process source for tests and tooling — empty until seeded. */
export class InMemorySupplierAccountsSource implements SupplierAccountsSource {
  private readonly codesByTenant = new Map<TenantId, readonly string[]>();

  setEnabled(tenant: TenantId, codes: readonly string[]): void {
    this.codesByTenant.set(tenant, [...new Set(codes)]);
  }

  enabledSupplierCodes(tenant: TenantId): Promise<readonly string[]> {
    return Promise.resolve(this.codesByTenant.get(tenant) ?? []);
  }
}
