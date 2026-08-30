/**
 * MarkupRule shapes + most-specific-wins selection (issue #62;
 * docs/03-domain-model.md "MarkupRule"; docs/milestones/M01-engine-spine.md).
 *
 * PURE data and pure functions — nothing in the resolution path performs IO.
 * The Nest module (pricing.module.ts) wraps this library with rule loading.
 *
 * `PricingRule` mirrors the `markup_rule` row of the tenant schema
 * (packages/db/src/tenant/schema.ts / migrations/tenant/0001_tenant_v1.sql)
 * one-to-one: every scope column is nullable and null means "matches any";
 * `value` is basis points for percent rules and MINOR UNITS (with `currency`)
 * for fixed / per-night / per-pax rules.
 *
 * ## Specificity ordering (documented, deterministic)
 *
 * The scope chain — tenant default → agency/corporate → channel → vertical →
 * supplier → destination → date band — runs from broadest to narrowest, so a
 * rule's specificity is a 6-bit number whose MOST significant bit is the most
 * specific dimension:
 *
 *     date band (32) > destination (16) > supplier (8) >
 *     vertical (4)   > channel (2)      > agency (1)    > tenant default (0)
 *
 * Higher specificity wins. Because the bits are unique powers of two, a rule
 * constrained on a more specific dimension beats ANY combination of strictly
 * less specific ones (date band alone = 32 beats agency+channel+vertical+
 * supplier+destination = 31), and equal specificity implies the exact same
 * set of constrained dimensions.
 *
 * ## Ties and their tiebreak
 *
 * Two matching rules with the same specificity (i.e. the same scope shape)
 * are ordered by the tenant's explicit `priority` column — LOWER value wins.
 * If both specificity and priority tie, the lexicographically smallest rule
 * id wins: resolution must be a pure function, so the ordering is total and
 * never depends on input array order.
 */

import type { SalesChannel, SubTenantId, Vertical } from "@jenova/domain";
import type { MarkupValueType } from "@jenova/db";
import { PricingRuleError } from "./errors";

export type { MarkupValueType };

/**
 * Runtime list for validation/tooling; `satisfies` pins it to the db type,
 * and the exhaustive switch in resolve.ts fails to compile on drift.
 */
export const MARKUP_VALUE_TYPES = [
  "percent",
  "fixed",
  "per_night",
  "per_pax",
] as const satisfies readonly MarkupValueType[];

/** Calendar date in ISO `YYYY-MM-DD` form (Gregorian — CLAUDE.md rule 9). */
export type IsoDate = string;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_4217_RE = /^[A-Z]{3}$/;

export function isIsoDate(value: string): boolean {
  return ISO_DATE_RE.test(value);
}

/** In-memory mirror of one `markup_rule` row. */
export interface PricingRule {
  readonly id: string;
  /** Tenant's explicit ordering — lower wins within one specificity. */
  readonly priority: number;
  readonly agencyId: SubTenantId | null;
  readonly channel: SalesChannel | null;
  readonly vertical: Vertical | null;
  readonly supplierCode: string | null;
  readonly destination: string | null;
  readonly travelFrom: IsoDate | null;
  readonly travelTo: IsoDate | null;
  readonly valueType: MarkupValueType;
  /** Basis points (percent) or minor units (fixed/per_night/per_pax). */
  readonly value: bigint;
  /** Required for monetary value types, null for percent (SQL check). */
  readonly currency: string | null;
  /** Share of the markup credited to the agency, 0..10000; null = no split. */
  readonly commissionSplitBps: number | null;
  readonly active: boolean;
}

/**
 * The sale being priced. Scope dimensions mirror the rule columns; the
 * quantity fields feed per_night / per_pax rules. Tenant scope is NOT here:
 * the rules passed to `selectRule`/`resolvePrice` are already loaded from one
 * tenant's database (explicit TenantId argument on the service).
 */
export interface PricingContext {
  /** Buying agency/corporate (sub-tenant); null for direct (b2c/internal). */
  readonly subTenantId: SubTenantId | null;
  readonly channel: SalesChannel;
  readonly vertical: Vertical;
  readonly supplierCode: string;
  /** Canonical destination code; null when the product has none. */
  readonly destination: string | null;
  /** Travel start (check-in / departure), for date-band rules. */
  readonly travelDate: IsoDate | null;
  /** Number of nights — required only when a per_night rule fires. */
  readonly nights: number | null;
  /** Number of travellers — required only when a per_pax rule fires. */
  readonly paxCount: number | null;
}

/** Mirrors the SQL checks so bad rows fail loudly, not silently mis-price. */
export function assertValidPricingRule(rule: PricingRule): void {
  if (rule.id.length === 0) {
    throw new PricingRuleError("rule id must be non-empty");
  }
  if (!Number.isSafeInteger(rule.priority)) {
    throw new PricingRuleError(`rule ${rule.id}: priority must be a safe integer`);
  }
  const isPercent = rule.valueType === "percent";
  if (isPercent !== (rule.currency === null)) {
    throw new PricingRuleError(
      `rule ${rule.id}: currency must be present exactly when value type is monetary (markup_rule_value_is_money)`,
    );
  }
  if (rule.currency !== null && !ISO_4217_RE.test(rule.currency)) {
    throw new PricingRuleError(`rule ${rule.id}: currency must be a 3-letter ISO 4217 code`);
  }
  if (rule.travelFrom !== null && !isIsoDate(rule.travelFrom)) {
    throw new PricingRuleError(`rule ${rule.id}: travelFrom must be YYYY-MM-DD`);
  }
  if (rule.travelTo !== null && !isIsoDate(rule.travelTo)) {
    throw new PricingRuleError(`rule ${rule.id}: travelTo must be YYYY-MM-DD`);
  }
  if (rule.travelFrom !== null && rule.travelTo !== null && rule.travelFrom > rule.travelTo) {
    throw new PricingRuleError(`rule ${rule.id}: travelFrom must not exceed travelTo (markup_rule_date_band)`);
  }
  if (
    rule.commissionSplitBps !== null &&
    (!Number.isSafeInteger(rule.commissionSplitBps) ||
      rule.commissionSplitBps < 0 ||
      rule.commissionSplitBps > 10_000)
  ) {
    throw new PricingRuleError(`rule ${rule.id}: commissionSplitBps must be an integer in 0..10000`);
  }
}

/** True when every constrained dimension of `rule` matches `context`. */
export function ruleMatchesContext(rule: PricingRule, context: PricingContext): boolean {
  if (!rule.active) return false;
  if (rule.agencyId !== null && rule.agencyId !== context.subTenantId) return false;
  if (rule.channel !== null && rule.channel !== context.channel) return false;
  if (rule.vertical !== null && rule.vertical !== context.vertical) return false;
  if (rule.supplierCode !== null && rule.supplierCode !== context.supplierCode) return false;
  if (rule.destination !== null && rule.destination !== context.destination) return false;
  if (rule.travelFrom !== null || rule.travelTo !== null) {
    // A date-banded rule needs a travel date to match; ISO strings compare
    // correctly lexicographically. Band endpoints are inclusive; a missing
    // endpoint leaves that side open.
    if (context.travelDate === null) return false;
    if (rule.travelFrom !== null && context.travelDate < rule.travelFrom) return false;
    if (rule.travelTo !== null && context.travelDate > rule.travelTo) return false;
  }
  return true;
}

/** Bit weights per the documented ordering (header comment). */
export function ruleSpecificity(rule: PricingRule): number {
  let bits = 0;
  if (rule.agencyId !== null) bits |= 1;
  if (rule.channel !== null) bits |= 2;
  if (rule.vertical !== null) bits |= 4;
  if (rule.supplierCode !== null) bits |= 8;
  if (rule.destination !== null) bits |= 16;
  if (rule.travelFrom !== null || rule.travelTo !== null) bits |= 32;
  return bits;
}

/**
 * The single winning rule for this context, or null when nothing matches
 * (then the sale carries no markup — sell equals the net basis).
 * Deterministic regardless of the input array's order.
 */
export function selectRule(
  rules: readonly PricingRule[],
  context: PricingContext,
): PricingRule | null {
  let winner: PricingRule | null = null;
  let winnerSpecificity = -1;
  for (const rule of rules) {
    assertValidPricingRule(rule);
    if (!ruleMatchesContext(rule, context)) continue;
    const specificity = ruleSpecificity(rule);
    if (
      winner === null ||
      specificity > winnerSpecificity ||
      (specificity === winnerSpecificity &&
        (rule.priority < winner.priority ||
          (rule.priority === winner.priority && rule.id < winner.id)))
    ) {
      winner = rule;
      winnerSpecificity = specificity;
    }
  }
  return winner;
}
