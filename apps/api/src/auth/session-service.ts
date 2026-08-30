/**
 * Realm-bound session lifecycle (issue #32; docs/08-security.md).
 *
 * Issuance, verification, expiry + idle timeout, rotation on privilege
 * change, and revocation (one session / all sessions of a user). Sessions
 * are realm-bound BOTH ways: the credential carries a realm tag the
 * gateway parses, and the server record pins the realm the session was
 * issued for — presenting a token under any other realm tag is refused.
 * Rejection reasons are internal diagnostics only; every failure surfaces
 * as the same generic 401 at the gateway.
 */

import type { TenantId } from "@jenova/domain";
import type {
  InteractiveRealm,
  SessionPrincipal,
  VerifiedSessionAuth,
} from "../gateway/request-context";
import { constantTimeEquals, generateOpaqueSecret, hashOpaqueSecret } from "./tokens";
import type { SessionStore } from "./session-store";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface RealmSessionPolicy {
  readonly ttlMs: number;
  readonly idleTimeoutMs: number;
}

/**
 * Per-realm lifetimes. Platform is deliberately the shortest (docs/08:
 * "short sessions" for Jenova staff); consumers get the longest — a
 * storefront that logs you out daily loses bookings, not attackers.
 */
export const DEFAULT_REALM_SESSION_POLICIES: Readonly<
  Record<InteractiveRealm, RealmSessionPolicy>
> = {
  platform: { ttlMs: 12 * HOUR_MS, idleTimeoutMs: 15 * MINUTE_MS },
  tenant_staff: { ttlMs: 12 * HOUR_MS, idleTimeoutMs: HOUR_MS },
  agency: { ttlMs: DAY_MS, idleTimeoutMs: 2 * HOUR_MS },
  corporate: { ttlMs: DAY_MS, idleTimeoutMs: 2 * HOUR_MS },
  consumer: { ttlMs: 30 * DAY_MS, idleTimeoutMs: 7 * DAY_MS },
};

export interface IssuedSession {
  /**
   * The full realm-tagged bearer credential `<realm>.<secret>` — exactly
   * what the gateway parses from `Authorization: Bearer …`. Handed to the
   * client ONCE; never stored, never logged (only its hash is).
   */
  readonly token: string;
  readonly realm: InteractiveRealm;
  /** SHA-256 of the secret — safe handle for logs and targeted revocation. */
  readonly tokenHash: string;
  readonly expiresAtMs: number;
}

export type SessionRejectionReason =
  | "malformed"
  | "unknown_token"
  | "realm_mismatch"
  | "tenant_mismatch"
  | "expired"
  | "idle_timeout";

export type SessionVerification =
  | { readonly ok: true; readonly auth: VerifiedSessionAuth }
  | { readonly ok: false; readonly reason: SessionRejectionReason };

/** What the gateway's auth stage needs — the service implements it. */
export interface SessionVerifier {
  verifySession(
    realm: InteractiveRealm,
    credential: string,
    expectedTenantId: TenantId | null,
  ): Promise<SessionVerification>;
}

export type SessionRotation =
  | { readonly ok: true; readonly session: IssuedSession }
  | { readonly ok: false; readonly reason: SessionRejectionReason };

export interface SessionServiceOptions {
  /** Injected clock (ms since epoch) so tests own time. Defaults to Date.now. */
  readonly clock?: () => number;
  readonly policies?: Readonly<Record<InteractiveRealm, RealmSessionPolicy>>;
}

/** Nest injection token for the process-wide {@link SessionService}. */
export const SESSION_SERVICE = Symbol("jenova.api.sessionService");

export class SessionService implements SessionVerifier {
  private readonly clock: () => number;
  private readonly policies: Readonly<Record<InteractiveRealm, RealmSessionPolicy>>;

  constructor(
    private readonly store: SessionStore,
    options: SessionServiceOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
    this.policies = options.policies ?? DEFAULT_REALM_SESSION_POLICIES;
  }

  /**
   * Issue a fresh session for a principal. Tenancy invariants are enforced
   * here — a violation is a programming error in the calling login flow,
   * not a client-triggerable 4xx.
   */
  async issue<R extends InteractiveRealm>(principal: SessionPrincipal<R>): Promise<IssuedSession> {
    if (principal.realm === "platform" && principal.tenantId !== null) {
      throw new Error("platform sessions exist above tenancy — tenantId must be null");
    }
    if (principal.realm !== "platform" && principal.tenantId === null) {
      throw new Error(`${principal.realm} sessions must be tenant-scoped — tenantId is required`);
    }

    const secret = generateOpaqueSecret();
    const tokenHash = hashOpaqueSecret(secret);
    const now = this.clock();
    const policy = this.policies[principal.realm];
    await this.store.put({
      tokenHash,
      principal,
      issuedAtMs: now,
      expiresAtMs: now + policy.ttlMs,
      idleTimeoutMs: policy.idleTimeoutMs,
      lastSeenAtMs: now,
    });
    return {
      token: `${principal.realm}.${secret}`,
      realm: principal.realm,
      tokenHash,
      expiresAtMs: now + policy.ttlMs,
    };
  }

  async verifySession(
    realm: InteractiveRealm,
    credential: string,
    expectedTenantId: TenantId | null,
  ): Promise<SessionVerification> {
    if (credential.length === 0 || credential.trim() !== credential) {
      return { ok: false, reason: "malformed" };
    }
    const tokenHash = hashOpaqueSecret(credential);
    const record = await this.store.get(tokenHash);
    // Defense in depth: even if a store implementation matched keys loosely,
    // the presented secret's hash must equal the stored one — compared in
    // constant time.
    if (record === null || !constantTimeEquals(record.tokenHash, tokenHash)) {
      return { ok: false, reason: "unknown_token" };
    }
    if (record.principal.realm !== realm) {
      // Realm-bound: an agency token presented under the tenant_staff tag
      // (or any other) is refused — no token crosses realms (docs/08).
      return { ok: false, reason: "realm_mismatch" };
    }
    if (record.principal.tenantId !== null && record.principal.tenantId !== expectedTenantId) {
      // Tenant-bound: a session from tenant A is dead on tenant B's host.
      return { ok: false, reason: "tenant_mismatch" };
    }
    const now = this.clock();
    if (now >= record.expiresAtMs) {
      await this.store.delete(tokenHash);
      return { ok: false, reason: "expired" };
    }
    if (now - record.lastSeenAtMs > record.idleTimeoutMs) {
      await this.store.delete(tokenHash);
      return { ok: false, reason: "idle_timeout" };
    }
    // Conditional touch, never a re-insert: if a revocation landed between
    // our `get` and here, touch returns false and the revocation WINS — a
    // blind put would resurrect the revoked record.
    if (!(await this.store.touch(tokenHash, now))) {
      return { ok: false, reason: "unknown_token" };
    }
    return {
      ok: true,
      auth: {
        state: "verified",
        realm: record.principal.realm,
        principal: record.principal,
        sessionTokenHash: tokenHash,
      },
    };
  }

  /**
   * Rotation on privilege change (login-adjacent step-up, role grant,
   * impersonation entry): the old credential is verified, killed, and a
   * fresh secret issued — optionally for an updated principal in the SAME
   * realm. Any session-fixation value the old token had dies with it.
   */
  async rotate<R extends InteractiveRealm>(
    realm: R,
    credential: string,
    expectedTenantId: TenantId | null,
    nextPrincipal?: SessionPrincipal<R>,
  ): Promise<SessionRotation> {
    const verified = await this.verifySession(realm, credential, expectedTenantId);
    if (!verified.ok) {
      return verified;
    }
    // The delete must be OURS: false means a concurrent revoke (or the
    // other of two racing rotations) got there first — minting a
    // replacement then would hand a fresh session to a dead credential.
    if (!(await this.store.delete(verified.auth.sessionTokenHash))) {
      return { ok: false, reason: "unknown_token" };
    }
    const principal = nextPrincipal ?? (verified.auth.principal as SessionPrincipal<R>);
    return { ok: true, session: await this.issue(principal) };
  }

  /** Revoke ONE session by its presented credential. true = it existed. */
  async revoke(realm: InteractiveRealm, credential: string): Promise<boolean> {
    const tokenHash = hashOpaqueSecret(credential);
    const record = await this.store.get(tokenHash);
    if (record === null || record.principal.realm !== realm) {
      return false;
    }
    return this.store.delete(tokenHash);
  }

  /** Revoke ONE session by its hash (admin tooling — the secret is long gone). */
  revokeByHash(tokenHash: string): Promise<boolean> {
    return this.store.delete(tokenHash);
  }

  /** Revoke EVERY session of a user in a realm/tenant scope. */
  revokeAllForUser(
    realm: InteractiveRealm,
    userId: string,
    tenantId: TenantId | null,
  ): Promise<number> {
    return this.store.deleteAllForUser(realm, userId, tenantId);
  }
}
