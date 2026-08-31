/**
 * Tenant-staff user store (M2 dashboard, issue #89) — the per-tenant user
 * store behind the tenant_staff realm (docs/08-security.md).
 *
 * Same seam idiom as hotel-search/supplier-accounts.ts: an interface, a
 * Drizzle implementation that reaches tenant data ONLY through the
 * @jenova/db resolver (CLAUDE.md rule 1), and an in-memory implementation
 * for supertest suites. Secrets never appear here in plaintext columns —
 * the TOTP secret travels as a sealed blob + key id (tenancy/secret-box).
 */

import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { TenantId } from "@jenova/domain";
import { staffPolicy, staffUsers, type StaffUserStatus, type TenantDbResolver } from "@jenova/db";

/** Dashboard staff roles — stored as text; the vocabulary lives here. */
export const STAFF_ROLES = ["admin", "operations", "finance", "viewer"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

export type StaffUserRecord = typeof staffUsers.$inferSelect;

/** Serializable projection — NEVER carries hashes or sealed secrets. */
export function staffProfileRowOf(user: StaffUserRecord): {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: string;
  readonly status: string;
  readonly totpEnrolled: boolean;
  readonly createdAt: string;
} {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    totpEnrolled: user.totpSecretEncrypted !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

export interface CreateStaffUserInput {
  readonly email: string;
  readonly displayName: string;
  readonly role: StaffRole;
  /** argon2id PHC string — hashing happens in the caller, never here. */
  readonly passwordHash: string;
}

export interface StaffPolicyRecord {
  readonly enforceTotp: boolean;
}

/** Nest injection token for the process-wide {@link StaffUserStore}. */
export const STAFF_USER_STORE = Symbol("jenova.api.staffUserStore");

export interface StaffUserStore {
  findByEmail(tenant: TenantId, email: string): Promise<StaffUserRecord | null>;
  findById(tenant: TenantId, id: string): Promise<StaffUserRecord | null>;
  list(tenant: TenantId): Promise<readonly StaffUserRecord[]>;
  /** Rejects (unique email) bubbling as a db error — callers pre-check. */
  create(tenant: TenantId, input: CreateStaffUserInput): Promise<StaffUserRecord>;
  updateProfile(
    tenant: TenantId,
    id: string,
    patch: {
      readonly displayName?: string | undefined;
      readonly role?: StaffRole | undefined;
    },
  ): Promise<StaffUserRecord | null>;
  setStatus(tenant: TenantId, id: string, status: StaffUserStatus): Promise<StaffUserRecord | null>;
  /** Upgrade-on-login rehash (password.ts `passwordNeedsRehash`). */
  updatePasswordHash(tenant: TenantId, id: string, passwordHash: string): Promise<void>;
  setPendingTotp(tenant: TenantId, id: string, sealed: Uint8Array, keyId: string): Promise<void>;
  /**
   * Promote the pending secret to the active one atomically; false when no
   * pending enrollment exists (nothing to activate).
   */
  activateTotp(tenant: TenantId, id: string, at: Date): Promise<boolean>;
  getPolicy(tenant: TenantId): Promise<StaffPolicyRecord>;
  setPolicy(tenant: TenantId, policy: StaffPolicyRecord): Promise<StaffPolicyRecord>;
}

export class DrizzleStaffUserStore implements StaffUserStore {
  constructor(private readonly resolver: TenantDbResolver) {}

  async findByEmail(tenant: TenantId, email: string): Promise<StaffUserRecord | null> {
    const db = await this.resolver.getTenantDb(tenant);
    const rows = await db
      .select()
      .from(staffUsers)
      .where(eq(staffUsers.email, email.toLowerCase()))
      .limit(1);
    return rows[0] ?? null;
  }

  async findById(tenant: TenantId, id: string): Promise<StaffUserRecord | null> {
    const db = await this.resolver.getTenantDb(tenant);
    const rows = await db.select().from(staffUsers).where(eq(staffUsers.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async list(tenant: TenantId): Promise<readonly StaffUserRecord[]> {
    const db = await this.resolver.getTenantDb(tenant);
    return db.select().from(staffUsers).orderBy(staffUsers.createdAt);
  }

  async create(tenant: TenantId, input: CreateStaffUserInput): Promise<StaffUserRecord> {
    const db = await this.resolver.getTenantDb(tenant);
    const rows = await db
      .insert(staffUsers)
      .values({
        email: input.email.toLowerCase(),
        displayName: input.displayName,
        role: input.role,
        passwordHash: input.passwordHash,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error("staff_user insert returned no row");
    }
    return row;
  }

  async updateProfile(
    tenant: TenantId,
    id: string,
    patch: { readonly displayName?: string; readonly role?: StaffRole },
  ): Promise<StaffUserRecord | null> {
    const db = await this.resolver.getTenantDb(tenant);
    const rows = await db
      .update(staffUsers)
      .set({
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        updatedAt: new Date(),
      })
      .where(eq(staffUsers.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async setStatus(
    tenant: TenantId,
    id: string,
    status: StaffUserStatus,
  ): Promise<StaffUserRecord | null> {
    const db = await this.resolver.getTenantDb(tenant);
    const rows = await db
      .update(staffUsers)
      .set({ status, updatedAt: new Date() })
      .where(eq(staffUsers.id, id))
      .returning();
    return rows[0] ?? null;
  }

  async updatePasswordHash(tenant: TenantId, id: string, passwordHash: string): Promise<void> {
    const db = await this.resolver.getTenantDb(tenant);
    await db
      .update(staffUsers)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(staffUsers.id, id));
  }

  async setPendingTotp(
    tenant: TenantId,
    id: string,
    sealed: Uint8Array,
    keyId: string,
  ): Promise<void> {
    const db = await this.resolver.getTenantDb(tenant);
    await db
      .update(staffUsers)
      .set({
        totpPendingSecretEncrypted: sealed,
        totpPendingSecretKeyId: keyId,
        updatedAt: new Date(),
      })
      .where(eq(staffUsers.id, id));
  }

  async activateTotp(tenant: TenantId, id: string, at: Date): Promise<boolean> {
    const db = await this.resolver.getTenantDb(tenant);
    // One statement: pending → active, pending cleared — no window where
    // both or neither slot is set (the SQL check pairs stay satisfied).
    const rows = await db
      .update(staffUsers)
      .set({
        totpSecretEncrypted: sql`totp_pending_secret_encrypted`,
        totpSecretKeyId: sql`totp_pending_secret_key_id`,
        totpPendingSecretEncrypted: null,
        totpPendingSecretKeyId: null,
        totpEnrolledAt: at,
        updatedAt: at,
      })
      .where(and(eq(staffUsers.id, id), isNotNull(staffUsers.totpPendingSecretEncrypted)))
      .returning({ id: staffUsers.id });
    return rows.length > 0;
  }

  async getPolicy(tenant: TenantId): Promise<StaffPolicyRecord> {
    const db = await this.resolver.getTenantDb(tenant);
    const rows = await db.select().from(staffPolicy).limit(1);
    return { enforceTotp: rows[0]?.enforceTotp ?? false };
  }

  async setPolicy(tenant: TenantId, policy: StaffPolicyRecord): Promise<StaffPolicyRecord> {
    const db = await this.resolver.getTenantDb(tenant);
    await db
      .insert(staffPolicy)
      .values({ id: 1, enforceTotp: policy.enforceTotp, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: staffPolicy.id,
        set: { enforceTotp: policy.enforceTotp, updatedAt: new Date() },
      });
    return { enforceTotp: policy.enforceTotp };
  }
}

/** Per-process store for supertest suites — empty until seeded. */
export class InMemoryStaffUserStore implements StaffUserStore {
  private readonly usersByTenant = new Map<TenantId, Map<string, StaffUserRecord>>();
  private readonly policyByTenant = new Map<TenantId, StaffPolicyRecord>();
  private nextId = 1;

  private users(tenant: TenantId): Map<string, StaffUserRecord> {
    let map = this.usersByTenant.get(tenant);
    if (map === undefined) {
      map = new Map();
      this.usersByTenant.set(tenant, map);
    }
    return map;
  }

  findByEmail(tenant: TenantId, email: string): Promise<StaffUserRecord | null> {
    const lower = email.toLowerCase();
    for (const user of this.users(tenant).values()) {
      if (user.email === lower) return Promise.resolve(user);
    }
    return Promise.resolve(null);
  }

  findById(tenant: TenantId, id: string): Promise<StaffUserRecord | null> {
    return Promise.resolve(this.users(tenant).get(id) ?? null);
  }

  list(tenant: TenantId): Promise<readonly StaffUserRecord[]> {
    return Promise.resolve(
      [...this.users(tenant).values()].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      ),
    );
  }

  create(tenant: TenantId, input: CreateStaffUserInput): Promise<StaffUserRecord> {
    const now = new Date();
    const record: StaffUserRecord = {
      id: `staff-${String(this.nextId++)}`,
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      role: input.role,
      status: "active",
      passwordHash: input.passwordHash,
      totpSecretEncrypted: null,
      totpSecretKeyId: null,
      totpPendingSecretEncrypted: null,
      totpPendingSecretKeyId: null,
      totpEnrolledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.users(tenant).set(record.id, record);
    return Promise.resolve(record);
  }

  updateProfile(
    tenant: TenantId,
    id: string,
    patch: { readonly displayName?: string; readonly role?: StaffRole },
  ): Promise<StaffUserRecord | null> {
    const user = this.users(tenant).get(id);
    if (user === undefined) return Promise.resolve(null);
    const updated: StaffUserRecord = {
      ...user,
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      updatedAt: new Date(),
    };
    this.users(tenant).set(id, updated);
    return Promise.resolve(updated);
  }

  setStatus(
    tenant: TenantId,
    id: string,
    status: StaffUserStatus,
  ): Promise<StaffUserRecord | null> {
    const user = this.users(tenant).get(id);
    if (user === undefined) return Promise.resolve(null);
    const updated: StaffUserRecord = { ...user, status, updatedAt: new Date() };
    this.users(tenant).set(id, updated);
    return Promise.resolve(updated);
  }

  updatePasswordHash(tenant: TenantId, id: string, passwordHash: string): Promise<void> {
    const user = this.users(tenant).get(id);
    if (user !== undefined) {
      this.users(tenant).set(id, { ...user, passwordHash, updatedAt: new Date() });
    }
    return Promise.resolve();
  }

  setPendingTotp(tenant: TenantId, id: string, sealed: Uint8Array, keyId: string): Promise<void> {
    const user = this.users(tenant).get(id);
    if (user !== undefined) {
      this.users(tenant).set(id, {
        ...user,
        totpPendingSecretEncrypted: sealed,
        totpPendingSecretKeyId: keyId,
        updatedAt: new Date(),
      });
    }
    return Promise.resolve();
  }

  activateTotp(tenant: TenantId, id: string, at: Date): Promise<boolean> {
    const user = this.users(tenant).get(id);
    if (user === undefined || user.totpPendingSecretEncrypted === null) {
      return Promise.resolve(false);
    }
    this.users(tenant).set(id, {
      ...user,
      totpSecretEncrypted: user.totpPendingSecretEncrypted,
      totpSecretKeyId: user.totpPendingSecretKeyId,
      totpPendingSecretEncrypted: null,
      totpPendingSecretKeyId: null,
      totpEnrolledAt: at,
      updatedAt: at,
    });
    return Promise.resolve(true);
  }

  getPolicy(tenant: TenantId): Promise<StaffPolicyRecord> {
    return Promise.resolve(this.policyByTenant.get(tenant) ?? { enforceTotp: false });
  }

  setPolicy(tenant: TenantId, policy: StaffPolicyRecord): Promise<StaffPolicyRecord> {
    this.policyByTenant.set(tenant, policy);
    return Promise.resolve(policy);
  }
}
