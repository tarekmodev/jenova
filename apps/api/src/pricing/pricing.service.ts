/**
 * IO wrapper around the pure resolution library: loads the tenant's active
 * markup rules, then delegates to resolvePrice. The resolution path itself
 * (rules.ts / resolve.ts) never performs IO.
 *
 * Tenant scope is an explicit TenantId argument (CLAUDE.md rule 1); the rule
 * source hides HOW rules are fetched, never WHOSE.
 */

import type { Money, TenantId } from "@jenova/domain";
import type { PricingContext, PricingRule } from "./rules";
import type { PriceResolution, ResolveOptions } from "./resolve";
import { resolvePrice } from "./resolve";

export const MARKUP_RULE_SOURCE = Symbol("jenova.api.markupRuleSource");
export const PRICING_SERVICE = Symbol("jenova.api.pricingService");

/**
 * Where a tenant's active markup rules come from. The Drizzle-backed source
 * (tenant resolver → markup_rule, priority index) binds here once the api's
 * tenant-db wiring lands with the booking workstream; nothing else changes.
 */
export interface MarkupRuleSource {
  loadActiveRules(tenant: TenantId): Promise<readonly PricingRule[]>;
}

/** Per-process source for tests and pre-db wiring — empty at boot. */
export class InMemoryMarkupRuleSource implements MarkupRuleSource {
  private readonly rulesByTenant = new Map<TenantId, readonly PricingRule[]>();

  setRules(tenant: TenantId, rules: readonly PricingRule[]): void {
    this.rulesByTenant.set(tenant, [...rules]);
  }

  loadActiveRules(tenant: TenantId): Promise<readonly PricingRule[]> {
    return Promise.resolve(this.rulesByTenant.get(tenant) ?? []);
  }
}

export class PricingService {
  constructor(private readonly ruleSource: MarkupRuleSource) {}

  async price(
    tenant: TenantId,
    net: Money,
    context: PricingContext,
    options: ResolveOptions = {},
  ): Promise<PriceResolution> {
    const rules = await this.ruleSource.loadActiveRules(tenant);
    return resolvePrice(net, context, rules, options);
  }
}
