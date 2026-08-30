/**
 * EntitlementSource — whether a tenant has an app installed (apps are
 * entitlement flags checked at the gateway, CLAUDE.md rule 3).
 *
 * Local interface for the same reason as TenantDirectory: the real source is
 * the control-plane AppInstallation table, which lives in @jenova/db (PR #42,
 * unmerged when this landed). A follow-up wiring task binds it to
 * ENTITLEMENT_SOURCE; this contract stays put.
 */

import type { AppKey, TenantId } from "@jenova/domain";

export interface EntitlementSource {
  isInstalled(tenantId: TenantId, appKey: AppKey): Promise<boolean>;
}

/** Nest injection token for the process-wide {@link EntitlementSource}. */
export const ENTITLEMENT_SOURCE = Symbol("jenova.api.entitlementSource");

/**
 * M0 default: deny everything, so an app-gated route can never open by
 * accident before the AppInstallation-backed source is wired (post-#42).
 */
export class DenyAllEntitlementSource implements EntitlementSource {
  isInstalled(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
