/**
 * The single typed per-request context the gateway chain populates
 * (issue #31; docs/02-architecture.md "API gateway" layer).
 *
 * One object per request, created by the request-context middleware and
 * filled progressively by the gateway stages IN ORDER: tenant resolution →
 * auth realm → entitlement → rate limit. Everything downstream (engine
 * services from M1) reads scope from here — never from raw headers.
 */

import type { SubTenantId, TenantId } from "@jenova/domain";
import { ApiHttpError } from "./errors";

/** Auth realms, strictly separated — docs/08-security.md. */
export const AUTH_REALMS = [
  "platform",
  "tenant_staff",
  "agency",
  "corporate",
  "consumer",
  "machine",
] as const;
export type AuthRealm = (typeof AUTH_REALMS)[number];

export function isAuthRealm(value: string): value is AuthRealm {
  return (AUTH_REALMS as readonly string[]).includes(value);
}

/**
 * The five realms whose principals are people holding revocable server-side
 * sessions. The machine realm authenticates with key + HMAC signatures
 * instead — no session, nothing to idle out or rotate.
 */
export type InteractiveRealm = Exclude<AuthRealm, "machine">;
export const INTERACTIVE_REALMS = AUTH_REALMS.filter(
  (realm): realm is InteractiveRealm => realm !== "machine",
);

/**
 * Who a verified session speaks for. The realm TYPE parameter is the
 * structural half of realm-boundness: a service that demands
 * `SessionPrincipal<"agency">` cannot be handed a corporate principal —
 * that is a compile error, not a runtime surprise.
 */
export interface SessionPrincipal<R extends InteractiveRealm = InteractiveRealm> {
  readonly realm: R;
  /** User id within this realm's user store (per-tenant except platform). */
  readonly userId: string;
  /** null ONLY in the platform realm — platform staff exist above tenancy. */
  readonly tenantId: TenantId | null;
  /** Agency/CorporatePartner scope where the realm has one; otherwise null. */
  readonly subTenantId: SubTenantId | null;
}

/** Who a verified machine credential speaks for (Partner API keys). */
export interface MachinePrincipal {
  readonly realm: "machine";
  readonly keyId: string;
  /** Machine keys are ALWAYS tenant-scoped (docs/08-security.md). */
  readonly tenantId: TenantId;
  readonly subTenantId: SubTenantId | null;
}

/** A cryptographically verified, realm-bound session (issue #32). */
export interface VerifiedSessionAuth<R extends InteractiveRealm = InteractiveRealm> {
  readonly state: "verified";
  readonly realm: R;
  readonly principal: SessionPrincipal<R>;
  /**
   * SHA-256 of the presented session secret — the safe handle for logging,
   * correlation, and targeted revocation. The secret itself exists only in
   * the client's hands and is never stored or logged.
   */
  readonly sessionTokenHash: string;
}

/** A verified HMAC machine credential (Partner API — issue #32 skeleton). */
export interface VerifiedMachineAuth {
  readonly state: "verified";
  readonly realm: "machine";
  readonly principal: MachinePrincipal;
}

export type VerifiedAuth = VerifiedSessionAuth | VerifiedMachineAuth;

/**
 * Runtime half of realm-boundness: downstream code that serves exactly one
 * realm narrows with this — anything else (anonymous, other realm) is the
 * same generic 401 the gateway uses, leaking nothing about why.
 */
export function requireRealm<R extends InteractiveRealm>(
  auth: AuthContext | null,
  realm: R,
): VerifiedSessionAuth<R> {
  if (auth === null || auth.state !== "verified" || auth.realm !== realm) {
    throw ApiHttpError.unauthorized();
  }
  return auth as VerifiedSessionAuth<R>;
}

export function requireMachineAuth(auth: AuthContext | null): VerifiedMachineAuth {
  if (auth === null || auth.state !== "verified" || auth.realm !== "machine") {
    throw ApiHttpError.unauthorized();
  }
  return auth;
}

/** Product of tenant resolution: which tenant this host serves. */
export interface ResolvedTenant {
  readonly tenantId: TenantId;
  /**
   * The tenant's dedicated database name. Carried so the @jenova/db tenant
   * resolver (the ONLY door to a tenant connection) can open the right DB
   * once the #42 wiring lands; nothing in apps/api dials it directly.
   */
  readonly dbName: string;
  /** Normalized (lowercase, port-stripped) host the tenant was resolved from. */
  readonly host: string;
}

/**
 * Product of the auth stage. `unverified` is only the PARSE intermediate —
 * the auth stage either upgrades it to `verified` through the session /
 * machine-key verifiers or refuses the request with a 401; it never lands
 * in a served request's context.
 */
export type AuthContext =
  | { readonly state: "anonymous" }
  | {
      /** A realm-tagged bearer token was PARSED — not yet verified. */
      readonly state: "unverified";
      readonly realm: AuthRealm;
      /** Opaque credential exactly as presented; never logged. */
      readonly credential: string;
    }
  | VerifiedAuth;

export interface RequestContext {
  readonly requestId: string;
  /** null until the tenant-resolution stage ran (or for @SkipGateway routes). */
  tenant: ResolvedTenant | null;
  /** null until the auth-realm stage ran. */
  auth: AuthContext | null;
}

/** Symbol key the context hangs off the platform request object under. */
export const REQUEST_CONTEXT: unique symbol = Symbol("jenova.requestContext");

/** Anything a RequestContext can be attached to (the express request). */
export interface RequestContextCarrier {
  [REQUEST_CONTEXT]?: RequestContext;
}

export function createRequestContext(requestId: string): RequestContext {
  return { requestId, tenant: null, auth: null };
}

export function attachRequestContext(
  carrier: RequestContextCarrier,
  context: RequestContext,
): void {
  carrier[REQUEST_CONTEXT] = context;
}

export function getRequestContext(carrier: RequestContextCarrier): RequestContext | null {
  return carrier[REQUEST_CONTEXT] ?? null;
}
