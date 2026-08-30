/**
 * SupplierAccount-backed credentials (M2 #91) — the "secret-store wiring"
 * the M0 placeholder promised: tenant supplier credentials come from the
 * tenant DB's supplier_account rows, sealed at rest (secret-box) and
 * decrypted at call time. Jenova is a technology partner — these are the
 * TENANT'S OWN accounts (CLAUDE.md identity rules).
 *
 * MONEY-PATH ADJACENT — human review required.
 */

import { and, eq } from "drizzle-orm";
import type { TenantId } from "@jenova/domain";
import { supplierAccounts, type SupplierEnvironment, type TenantDbResolver } from "@jenova/db";
import type { SupplierAccountCredentials } from "@jenova/supplier-sdk";
import type { SupplierCredentialsSource } from "@jenova/supplier-registry";
import type { SecretBox } from "./secret-box";

/** No enabled account row — distinct so a dev fallback can catch EXACTLY this. */
export class SupplierAccountUnconfiguredError extends Error {
  constructor(tenant: TenantId, supplierCode: string, environment: SupplierEnvironment) {
    super(
      `tenant ${tenant} has no enabled ${environment} supplier_account for '${supplierCode}'`,
    );
    this.name = "SupplierAccountUnconfiguredError";
  }
}

export class DrizzleSupplierCredentialsSource implements SupplierCredentialsSource {
  constructor(
    private readonly resolver: TenantDbResolver,
    private readonly secrets: SecretBox,
    /** Which environment this PROCESS trades in (production ⇒ production). */
    private readonly environment: SupplierEnvironment,
  ) {}

  async credentialsFor(
    tenant: TenantId,
    supplierCode: string,
  ): Promise<SupplierAccountCredentials> {
    const db = await this.resolver.getTenantDb(tenant);
    const rows = await db
      .select()
      .from(supplierAccounts)
      .where(
        and(
          eq(supplierAccounts.supplierCode, supplierCode),
          eq(supplierAccounts.environment, this.environment),
          eq(supplierAccounts.enabled, true),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      throw new SupplierAccountUnconfiguredError(tenant, supplierCode, this.environment);
    }
    const opened = this.secrets.open(row.secretsEncrypted, row.secretsKeyId);
    const secrets = JSON.parse(opened) as Record<string, string>;
    return { tenantId: tenant, supplierCode, environment: this.environment, secrets };
  }
}

/**
 * Development composition: stored account first, repo-.env sandbox
 * credentials only where NO account row exists yet (the pre-Settings boot
 * path). Anything but "unconfigured" — decryption failure included —
 * propagates; a fallback there would mask real breakage.
 */
export class FallbackSupplierCredentialsSource implements SupplierCredentialsSource {
  constructor(
    private readonly primary: SupplierCredentialsSource,
    private readonly fallback: SupplierCredentialsSource,
  ) {}

  async credentialsFor(
    tenant: TenantId,
    supplierCode: string,
  ): Promise<SupplierAccountCredentials> {
    try {
      return await this.primary.credentialsFor(tenant, supplierCode);
    } catch (error) {
      if (error instanceof SupplierAccountUnconfiguredError) {
        return this.fallback.credentialsFor(tenant, supplierCode);
      }
      throw error;
    }
  }
}
