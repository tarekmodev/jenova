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

/**
 * ATOMICITY CONTRACT (every implementation, redis included, inherits it):
 * revocation must win every race. `touch` is a CONDITIONAL update — it
 * updates iff the record still exists and returns false otherwise; it must
 * never re-create a deleted record (a blind SET after a concurrent revoke
 * would resurrect the session). `delete` returns whether THIS call removed
 * the record — concurrent deleters see true exactly once, which is what
 * lets rotation refuse to mint a replacement for a concurrently revoked
 * credential. In redis terms: touch is a conditional write (WATCH/Lua),
 * delete's result is DEL's returned count.
 */
export interface SessionStore {
  get(tokenHash: string): Promise<SessionRecord | null>;
  /** Insert a NEW record at issuance (never used to update an existing one). */
  put(record: SessionRecord): Promise<void>;
  /**
   * Conditionally set lastSeenAtMs iff the record exists; false = it is
   * gone (revoked/expired-and-deleted) and MUST be treated as revoked.
   */
  touch(tokenHash: string, lastSeenAtMs: number): Promise<boolean>;
  /** true iff THIS call removed the record (exactly one winner per record). */
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

  touch(tokenHash: string, lastSeenAtMs: number): Promise<boolean> {
    // Map read+write with no await between them: atomic on the event loop,
    // and a missing record is NEVER re-created (see interface contract).
    const record = this.records.get(tokenHash);
    if (record === undefined) {
      return Promise.resolve(false);
    }
    this.records.set(tokenHash, { ...record, lastSeenAtMs });
    return Promise.resolve(true);
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
