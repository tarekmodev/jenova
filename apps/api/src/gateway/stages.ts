/**
 * The gateway middleware chain (issue #31; docs/02-architecture.md).
 *
 * EXACT order, enforced by GatewayPipeline's constructor:
 *   1. tenant_resolution — Host header → tenant (docs/08: tenant resolution
 *      happens BEFORE authentication, so realm lookup knows whose user store)
 *   2. auth_realm       — parse + VERIFY the realm-tagged bearer token (#32)
 *   3. entitlement      — @RequiresApp(appKey) route metadata vs installed apps
 *   4. rate_limit       — seam only at M0
 *
 * Stages are framework-free: they see only the RequestContext and a plain
 * GatewayRequestInfo, so the chain is unit-testable without Nest and the
 * guard stays a thin binding.
 */

import type { AppKey } from "@jenova/domain";
import type { MachineCredentialVerifier } from "../auth/machine-auth";
import type { SessionVerifier } from "../auth/session-service";
import { ApiHttpError } from "./errors";
import {
  isAuthRealm,
  type AuthContext,
  type AuthRealm,
  type RequestContext,
} from "./request-context";
import type { EntitlementSource } from "./entitlement-source";
import type { RateLimiter } from "./rate-limiter";
import type { TenantDirectory } from "./tenant-directory";

/** What the chain may see of a request — extracted once by the guard. */
export interface GatewayRequestInfo {
  /** Raw Host header (may carry a port and any casing); null if absent. */
  readonly host: string | null;
  /** Raw Authorization header; null if absent. */
  readonly authorization: string | null;
  /** AppKey from @RequiresApp route metadata; null = route not app-gated. */
  readonly requiredApp: AppKey | null;
  /** Realms from @RequiresRealm route metadata; null = none declared. */
  readonly allowedRealms: readonly AuthRealm[] | null;
  /** @AllowAnonymous route metadata — the deliberate opt-out of default-deny. */
  readonly allowAnonymous: boolean;
}

export const GATEWAY_STAGE_ORDER = [
  "tenant_resolution",
  "auth_realm",
  "entitlement",
  "rate_limit",
] as const;
export type GatewayStageName = (typeof GATEWAY_STAGE_ORDER)[number];

export interface GatewayStage {
  readonly name: GatewayStageName;
  /** Populates its slice of the context, or throws an ApiHttpError to refuse. */
  run(context: RequestContext, request: GatewayRequestInfo): Promise<void>;
}

/** Lowercase and strip the port — tenants bind to hostnames, not host:port. */
export function normalizeHost(rawHost: string): string {
  const host = rawHost.trim().toLowerCase();
  // IPv6 literals keep their brackets ([::1]:3000 → [::1]).
  const portStart = host.startsWith("[") ? host.indexOf("]:") + 1 : host.indexOf(":");
  return portStart > 0 ? host.slice(0, portStart) : host;
}

/** Stage 1: unknown host ⇒ 404 tenant_not_found. */
export class TenantResolutionStage implements GatewayStage {
  readonly name = "tenant_resolution";

  constructor(private readonly directory: TenantDirectory) {}

  async run(context: RequestContext, request: GatewayRequestInfo): Promise<void> {
    if (request.host === null || request.host.trim() === "") {
      throw ApiHttpError.tenantNotFound(null);
    }
    const host = normalizeHost(request.host);
    const entry = await this.directory.resolveByHost(host);
    if (entry === null) {
      throw ApiHttpError.tenantNotFound(host);
    }
    context.tenant = { tenantId: entry.tenantId, dbName: entry.dbName, host };
  }
}

/**
 * Stage 2: auth realm + verification (issue #32; docs/08-security.md).
 *
 * Parses the realm-tagged bearer shape `Authorization: Bearer <realm>.<credential>`
 * and verifies it: interactive realms through the realm-bound session
 * verifier, the machine realm through the HMAC key verifier. Fails closed —
 * a PRESENT Authorization header that does not verify is a 401, never
 * silently anonymous — and every refusal is the same generic 401 (no
 * oracle over why). The realm gate is DEFAULT-DENY: only @RequiresRealm
 * (matching realm) or an explicit @AllowAnonymous lets a request through;
 * an undecorated route refuses everyone, so a forgotten decorator ships a
 * dead route, never an open one.
 */
export class AuthRealmStage implements GatewayStage {
  readonly name = "auth_realm";

  constructor(
    private readonly sessions: SessionVerifier,
    private readonly machineKeys: MachineCredentialVerifier,
  ) {}

  async run(context: RequestContext, request: GatewayRequestInfo): Promise<void> {
    const expectedTenantId = context.tenant?.tenantId ?? null;
    const parsed = parseRealmTaggedBearer(request.authorization);

    if (parsed.state === "anonymous") {
      if (request.authorization !== null) {
        // A credential was OFFERED but is not a well-formed realm-tagged
        // bearer (wrong scheme, unknown realm, missing secret): refuse.
        throw ApiHttpError.unauthorized();
      }
      context.auth = parsed;
    } else if (parsed.realm === "machine") {
      const result = await this.machineKeys.verifyMachineCredential(
        parsed.credential,
        expectedTenantId,
      );
      if (!result.ok) {
        throw ApiHttpError.unauthorized();
      }
      context.auth = result.auth;
    } else {
      const result = await this.sessions.verifySession(
        parsed.realm,
        parsed.credential,
        expectedTenantId,
      );
      if (!result.ok) {
        throw ApiHttpError.unauthorized();
      }
      context.auth = result.auth;
    }

    // Route realm gate, default-deny (F2). @RequiresRealm wins over
    // @AllowAnonymous when both are present.
    if (request.allowedRealms !== null) {
      // Cross-realm use of a perfectly valid session is still a 401 —
      // realm-bound tokens never cross (docs/08).
      if (
        context.auth.state !== "verified" ||
        !request.allowedRealms.includes(context.auth.realm)
      ) {
        throw ApiHttpError.unauthorized();
      }
    } else if (!request.allowAnonymous) {
      // Undecorated route: refused for anonymous AND verified callers
      // alike, with the same indistinguishable 401.
      throw ApiHttpError.unauthorized();
    }
  }
}

const BEARER_PREFIX = /^bearer\s+/i;

/** Parse product: never `verified` — only the auth stage's verifiers mint that. */
export type ParsedBearer = Extract<AuthContext, { state: "anonymous" | "unverified" }>;

export function parseRealmTaggedBearer(authorization: string | null): ParsedBearer {
  if (authorization === null || !BEARER_PREFIX.test(authorization)) {
    return { state: "anonymous" };
  }
  const token = authorization.replace(BEARER_PREFIX, "").trim();
  const separator = token.indexOf(".");
  if (separator <= 0 || separator === token.length - 1) {
    return { state: "anonymous" };
  }
  const realm = token.slice(0, separator);
  if (!isAuthRealm(realm)) {
    return { state: "anonymous" };
  }
  return { state: "unverified", realm, credential: token.slice(separator + 1) };
}

/** Stage 3: app entitlement — missing entitlement ⇒ 403 app_not_installed. */
export class EntitlementStage implements GatewayStage {
  readonly name = "entitlement";

  constructor(private readonly source: EntitlementSource) {}

  async run(context: RequestContext, request: GatewayRequestInfo): Promise<void> {
    if (request.requiredApp === null) {
      return; // Route not app-gated (core workspace surfaces).
    }
    if (context.tenant === null) {
      // The pipeline guarantees tenant resolution ran first; reaching here
      // without a tenant means the chain was mis-assembled.
      throw ApiHttpError.internal("gateway chain ran entitlement before tenant resolution");
    }
    const installed = await this.source.isInstalled(
      context.tenant.tenantId,
      request.requiredApp,
    );
    if (!installed) {
      throw ApiHttpError.appNotInstalled(request.requiredApp);
    }
  }
}

/** Stage 4: rate-limit hook seam (no-op limiter at M0). */
export class RateLimitStage implements GatewayStage {
  readonly name = "rate_limit";

  constructor(private readonly limiter: RateLimiter) {}

  run(context: RequestContext): Promise<void> {
    return this.limiter.check(context);
  }
}

/** Nest injection token for the assembled {@link GatewayPipeline}. */
export const GATEWAY_PIPELINE = Symbol("jenova.api.gatewayPipeline");

/** Runs the stages strictly in {@link GATEWAY_STAGE_ORDER}. */
export class GatewayPipeline {
  constructor(private readonly stages: readonly GatewayStage[]) {
    const names = stages.map((stage) => stage.name);
    if (
      names.length !== GATEWAY_STAGE_ORDER.length ||
      GATEWAY_STAGE_ORDER.some((name, i) => names[i] !== name)
    ) {
      throw new Error(
        `gateway pipeline must be exactly [${GATEWAY_STAGE_ORDER.join(" → ")}], got [${names.join(" → ")}]`,
      );
    }
  }

  async run(context: RequestContext, request: GatewayRequestInfo): Promise<void> {
    for (const stage of this.stages) {
      await stage.run(context, request);
    }
  }
}
