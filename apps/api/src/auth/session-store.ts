/**
 * Server-side session records + the pluggable store behind them (issue #32).
 *
 * The store is keyed by H(secret) — the raw secret NEVER reaches the store,
 * so no store implementation (memory today, redis tomorrow) can leak a
 * presentable credential. Swapping in the redis-backed store is one
 * provider binding on SESSION_STORE; the record shape and this contract
 * do not change.
 */

import type { TenantId } from "@jenova/domain";
import type { InteractiveRealm, SessionPrincipal } from "../gateway/request-context";

export interface SessionRecord {
  /** SHA-256 hex of the session secret — the store's key, never the secret. */
  readonly tokenHash: string;
  readonly principal: SessionPrincipal;
  readonly issuedAtMs: number;
  /** Absolute expiry: past this instant the session is dead regardless of use. */
  readonly expiresAtMs: number;
  /** Sliding window: unused for longer than this ⇒ dead. */
  readonly idleTimeoutMs: number;
  readonly lastSeenAtMs: number;
}

export interface SessionStore {
  get(tokenHash: string): Promise<SessionRecord | null>;
  /** Insert or replace by tokenHash (used for issuance AND idle touches). */
  put(record: SessionRecord): Promise<void>;
  /** true if a record existed and is now gone. */
  delete(tokenHash: string): Promise<boolean>;
  /**
   * Revoke every session of one user in one realm/tenant scope ("log me out
   * everywhere", credential-compromise response). Returns how many died.
   */
  deleteAllForUser(
    realm: InteractiveRealm,
    userId: string,
    tenantId: TenantId | null,
  ): Promise<number>;
}

/** Nest injection token for the process-wide {@link SessionStore}. */
export const SESSION_STORE = Symbol("jenova.api.sessionStore");

/**
 * M0 default: per-process, lost on restart — fine while nothing interactive
 * ships. The redis-backed implementation binds to SESSION_STORE later.
 */
export class InMemorySessionStore implements SessionStore {
  private readonly records = new Map<string, SessionRecord>();

  get(tokenHash: string): Promise<SessionRecord | null> {
    return Promise.resolve(this.records.get(tokenHash) ?? null);
  }

  put(record: SessionRecord): Promise<void> {
    this.records.set(record.tokenHash, record);
    return Promise.resolve();
  }

  delete(tokenHash: string): Promise<boolean> {
    return Promise.resolve(this.records.delete(tokenHash));
  }

  deleteAllForUser(
    realm: InteractiveRealm,
    userId: string,
    tenantId: TenantId | null,
  ): Promise<number> {
    let deleted = 0;
    for (const [hash, record] of this.records) {
      const { principal } = record;
      if (
        principal.realm === realm &&
        principal.userId === userId &&
        principal.tenantId === tenantId
      ) {
        this.records.delete(hash);
        deleted += 1;
      }
    }
    return Promise.resolve(deleted);
  }
}
