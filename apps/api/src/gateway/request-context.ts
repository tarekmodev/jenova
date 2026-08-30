/**
 * The single typed per-request context the gateway chain populates
 * (issue #31; docs/02-architecture.md "API gateway" layer).
 *
 * One object per request, created by the request-context middleware and
 * filled progressively by the gateway stages IN ORDER: tenant resolution →
 * auth realm → entitlement → rate limit. Everything downstream (engine
 * services from M1) reads scope from here — never from raw headers.
 */

import type { TenantId } from "@jenova/domain";

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
 * Product of the auth stage. The union SHAPE is final; M0 produces only the
 * first two members — session verification (#32) adds a `verified` member
 * carrying the realm-bound session, and until then nothing is trusted.
 */
export type AuthContext =
  | { readonly state: "anonymous" }
  | {
      /** A realm-tagged bearer token was PARSED — not verified (crypto lands with #32). */
      readonly state: "unverified";
      readonly realm: AuthRealm;
      /** Opaque credential exactly as presented; never logged. */
      readonly credential: string;
    };

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
