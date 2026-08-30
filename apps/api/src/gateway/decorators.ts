/**
 * Route metadata decorators the gateway chain reads (issue #31).
 */

import { SetMetadata, type CustomDecorator } from "@nestjs/common";
import type { AppKey } from "@jenova/domain";

export const REQUIRES_APP_METADATA = "jenova:requiresApp";
export const SKIP_GATEWAY_METADATA = "jenova:skipGateway";

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
