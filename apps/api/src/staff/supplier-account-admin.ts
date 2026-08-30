/**
 * Supplier-account administration store (Settings v1, issue #91).
 *
 * WRITE-ONLY credentials: secrets go in sealed (secret-box) and NEVER come
 * back out through this seam's summaries — only the engine's credentials
 * source and the test-connection probe decrypt, at call time. Every
 * credential write lands an audit event (never the secret contents).
 */

import { and, eq } from "drizzle-orm";
import type { TenantId } from "@jenova/domain";
import {
  auditEvents,
  supplierAccounts,
  type SupplierEnvironment,
  type TenantDbResolver,
} from "@jenova/db";
import type { SecretBox } from "../tenancy/secret-box";

export interface SupplierAccountSummary {
  readonly supplierCode: string;
  readonly environment: SupplierEnvironment;
  readonly enabled: boolean;
  readonly updatedAt: Date;
}

export interface SupplierAccountSecret {
  readonly secrets: Readonly<Record<string, string>>;
}

export interface UpsertSupplierAccountInput {
  readonly secrets?: Readonly<Record<string, string>> | undefined;
  readonly enabled?: boolean | undefined;
  /** Staff user performing the change — audited. */
  readonly actorId: string;
}

export type UpsertOutcome =
  | { readonly ok: true; readonly created: boolean }
  | { readonly ok: false; readonly reason: "secrets_required" };

/** Nest injection token for the process-wide {@link SupplierAccountAdmin}. */
export const SUPPLIER_ACCOUNT_ADMIN = Symbol("jenova.api.supplierAccountAdmin");

export interface SupplierAccountAdmin {
  list(tenant: TenantId): Promise<readonly SupplierAccountSummary[]>;
  upsert(
    tenant: TenantId,
    supplierCode: string,
    environment: SupplierEnvironment,
    input: UpsertSupplierAccountInput,
  ): Promise<UpsertOutcome>;
  /** Decrypt ONE account's secrets — test-connection only, never serialized. */
  openSecrets(
    tenant: TenantId,
    supplierCode: string,
    environment: SupplierEnvironment,
  ): Promise<SupplierAccountSecret | null>;
}

export class DrizzleSupplierAccountAdmin implements SupplierAccountAdmin {
  constructor(
    private readonly resolver: TenantDbResolver,
    private readonly secrets: SecretBox,
  ) {}

  async list(tenant: TenantId): Promise<readonly SupplierAccountSummary[]> {
    const db = await this.resolver.getTenantDb(tenant);
    const rows = await db
      .select({
        supplierCode: supplierAccounts.supplierCode,
        environment: supplierAccounts.environment,
        enabled: supplierAccounts.enabled,
        updatedAt: supplierAccounts.updatedAt,
      })
      .from(supplierAccounts)
      .orderBy(supplierAccounts.supplierCode, supplierAccounts.environment);
    return rows;
  }

  async upsert(
    tenant: TenantId,
    supplierCode: string,
    environment: SupplierEnvironment,
    input: UpsertSupplierAccountInput,
  ): Promise<UpsertOutcome> {
    const db = await this.resolver.getTenantDb(tenant);
    const now = new Date();
    const sealed =
      input.secrets !== undefined
        ? { blob: this.secrets.seal(JSON.stringify(input.secrets)), keyId: this.secrets.keyId }
        : null;

    return db.transaction(async (tx) => {
      const existingRows = await tx
        .select({ id: supplierAccounts.id, enabled: supplierAccounts.enabled })
        .from(supplierAccounts)
        .where(
          and(
            eq(supplierAccounts.supplierCode, supplierCode),
            eq(supplierAccounts.environment, environment),
          ),
        )
        .limit(1);
      const existing = existingRows[0];

      if (existing === undefined) {
        if (sealed === null) {
          // Creating an account IS supplying its credentials.
          return { ok: false, reason: "secrets_required" } as const;
        }
        await tx.insert(supplierAccounts).values({
          supplierCode,
          environment,
          enabled: input.enabled ?? true,
          secretsEncrypted: sealed.blob,
          secretsKeyId: sealed.keyId,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        await tx
          .update(supplierAccounts)
          .set({
            ...(sealed !== null
              ? { secretsEncrypted: sealed.blob, secretsKeyId: sealed.keyId }
              : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
            updatedAt: now,
          })
          .where(eq(supplierAccounts.id, existing.id));
      }

      await tx.insert(auditEvents).values({
        actorType: "staff_user",
        actorId: input.actorId,
        entityType: "supplier_account",
        entityId: `${supplierCode}:${environment}`,
        action: existing === undefined ? "supplier_account.created" : "supplier_account.updated",
        // Never the secrets — only THAT they rotated.
        before: existing === undefined ? null : { enabled: existing.enabled },
        after: {
          enabled: input.enabled ?? existing?.enabled ?? true,
          credentialsRotated: sealed !== null,
        },
      });
      return { ok: true, created: existing === undefined } as const;
    });
  }

  async openSecrets(
    tenant: TenantId,
    supplierCode: string,
    environment: SupplierEnvironment,
  ): Promise<SupplierAccountSecret | null> {
    const db = await this.resolver.getTenantDb(tenant);
    const rows = await db
      .select({
        secretsEncrypted: supplierAccounts.secretsEncrypted,
        secretsKeyId: supplierAccounts.secretsKeyId,
      })
      .from(supplierAccounts)
      .where(
        and(
          eq(supplierAccounts.supplierCode, supplierCode),
          eq(supplierAccounts.environment, environment),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    const opened = this.secrets.open(row.secretsEncrypted, row.secretsKeyId);
    return { secrets: JSON.parse(opened) as Record<string, string> };
  }
}

/** Per-process admin for supertest suites — same contract, no Postgres. */
export class InMemorySupplierAccountAdmin implements SupplierAccountAdmin {
  private readonly accounts = new Map<
    string,
    { enabled: boolean; secrets: Readonly<Record<string, string>>; updatedAt: Date }
  >();

  private key(tenant: TenantId, code: string, environment: SupplierEnvironment): string {
    return `${tenant}:${code}:${environment}`;
  }

  list(tenant: TenantId): Promise<readonly SupplierAccountSummary[]> {
    const summaries: SupplierAccountSummary[] = [];
    for (const [key, value] of this.accounts) {
      const [keyTenant, supplierCode, environment] = key.split(":") as [
        string,
        string,
        SupplierEnvironment,
      ];
      if (keyTenant === tenant) {
        summaries.push({
          supplierCode,
          environment,
          enabled: value.enabled,
          updatedAt: value.updatedAt,
        });
      }
    }
    return Promise.resolve(summaries);
  }

  upsert(
    tenant: TenantId,
    supplierCode: string,
    environment: SupplierEnvironment,
    input: UpsertSupplierAccountInput,
  ): Promise<UpsertOutcome> {
    const key = this.key(tenant, supplierCode, environment);
    const existing = this.accounts.get(key);
    if (existing === undefined && input.secrets === undefined) {
      return Promise.resolve({ ok: false, reason: "secrets_required" } as const);
    }
    this.accounts.set(key, {
      enabled: input.enabled ?? existing?.enabled ?? true,
      secrets: input.secrets ?? existing?.secrets ?? {},
      updatedAt: new Date(),
    });
    return Promise.resolve({ ok: true, created: existing === undefined } as const);
  }

  openSecrets(
    tenant: TenantId,
    supplierCode: string,
    environment: SupplierEnvironment,
  ): Promise<SupplierAccountSecret | null> {
    const account = this.accounts.get(this.key(tenant, supplierCode, environment));
    return Promise.resolve(account === undefined ? null : { secrets: account.secrets });
  }
}
