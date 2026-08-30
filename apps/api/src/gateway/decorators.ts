/**
 * Route metadata decorators the gateway chain reads (issue #31).
 */

import { SetMetadata, type CustomDecorator } from "@nestjs/common";
import type { AppKey } from "@jenova/domain";
import type { AuthRealm } from "./request-context";

export const REQUIRES_APP_METADATA = "jenova:requiresApp";
export const REQUIRES_REALM_METADATA = "jenova:requiresRealm";
export const ALLOW_ANONYMOUS_METADATA = "jenova:allowAnonymous";
export const SKIP_GATEWAY_METADATA = "jenova:skipGateway";

/**
 * Declares which auth realm(s) may reach a route (or whole controller).
 * The gateway's auth stage refuses everything else — anonymous requests
 * and verified sessions of any OTHER realm alike — with the one generic
 * 401 (sessions are realm-bound tokens; no token crosses realms, docs/08).
 * Method metadata overrides class metadata.
 *
 * The gate is DEFAULT-DENY: a route that declares neither @RequiresRealm
 * nor @AllowAnonymous is refused with the same 401 for everyone — a
 * forgotten decorator ships a dead route, never an open one. Handlers
 * still narrow with `requireRealm` before trusting the context.
 */
export function RequiresRealm(
  ...realms: readonly [AuthRealm, ...AuthRealm[]]
): CustomDecorator<string> {
  return SetMetadata(REQUIRES_REALM_METADATA, realms);
}

/**
 * The DELIBERATE opt-out of default-deny: this route (or controller) is
 * reachable without a verified session — e.g. tenant-facing public
 * surfaces such as B2C storefront search. A credential that IS presented
 * still gets fully verified (present-but-invalid stays 401), and
 * @RequiresRealm on the same target takes precedence over this.
 *
 * Not for liveness/readiness probes — those exist below tenancy and use
 * @SkipGateway; the dev-only OpenAPI page is express middleware outside
 * routing and never reaches the gateway either.
 */
export function AllowAnonymous(): CustomDecorator<string> {
  return SetMetadata(ALLOW_ANONYMOUS_METADATA, true);
}

/**
 * Marks a route (or whole controller) as belonging to an installable app.
 * The gateway's entitlement stage refuses the request with a 403
 * `app_not_installed` envelope unless the resolved tenant has the app
 * installed (apps are entitlements, not codebases — CLAUDE.md rule 3).
 * Method metadata overrides class metadata.
 */
export function RequiresApp(appKey: AppKey): CustomDecorator<string> {
  return SetMetadata(REQUIRES_APP_METADATA, appKey);
}

/**
 * Exempts a route (or controller) from the gateway chain entirely —
 * ONLY for platform surfaces that exist below tenancy: liveness/readiness
 * probes and the dev OpenAPI spec. Everything else goes through the chain.
 */
export function SkipGateway(): CustomDecorator<string> {
  return SetMetadata(SKIP_GATEWAY_METADATA, true);
}
