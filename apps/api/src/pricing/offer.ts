/**
 * PricedOffer assembly (issue #63): stamps the pricing breakdown + fired
 * MarkupRule id onto the Offer payload shape (docs/03-domain-model.md
 * "SearchSession / Offer"; `offer` row in the tenant schema).
 *
 * The offer STORE (TTL cache, signed price hash, check-revalidation) is
 * workstream D — these exported types and this pure assembly function are
 * the coordination contract it consumes; there is no dependency on its code.
 *
 * The offer row is single-currency (net_amount + sell_amount share
 * `currency`): the offer's net is the SELL-currency net basis (post
 * stored-rate FX + buffer); the original supplier net stays available in
 * `breakdown.fx.supplierNet` for audit.
 */

import type { CancellationPolicy, Vertical } from "@jenova/domain";
import { isVertical } from "@jenova/domain";
import { PricingInputError } from "./errors";
import { toSellCancellationPolicy } from "./sell-policy";
import type { PriceBreakdown, PriceResolution } from "./resolve";

/** What the search layer knows about the product being offered. */
export interface OfferAssemblyInput {
  readonly supplierCode: string;
  readonly vertical: Vertical;
  /** Normalized policy captured at pricing time; null when none applies. */
  readonly policySnapshot: CancellationPolicy | null;
  /** TTL boundary the offer store enforces (UTC). */
  readonly expiresAt: Date;
}

/**
 * The server-priced payload the offer store persists and signs — the ONLY
 * bookable thing (CLAUDE.md rule 8). Field-compatible with the `offer`
 * tenant-schema row; `breakdown` is the audit trail of HOW sell was reached.
 */
export interface PricedOffer {
  readonly supplierCode: string;
  readonly vertical: Vertical;
  /** Net basis in the sell currency (see header comment). */
  readonly net: PriceBreakdown["net"];
  readonly sell: PriceResolution["sell"];
  /** ISO 4217 — always equal to net.currency and sell.currency. */
  readonly currency: string;
  /** markup_rule id that fired; null when no rule matched. */
  readonly markupRuleId: string | null;
  readonly breakdown: PriceBreakdown;
  /** NET-side policy — internal truth (supplier settlement, ledger). */
  readonly policySnapshot: CancellationPolicy | null;
  /**
   * SELL-side policy — the ONLY policy any agency-facing surface may
   * serialize (review H1: net penalties disclose the tenant's buy rate).
   * Derived once here at pricing time; see pricing/sell-policy.ts.
   */
  readonly sellPolicySnapshot: CancellationPolicy | null;
  readonly expiresAt: Date;
}

/**
 * Pure assembly of a PricedOffer from a resolution. Validates coherence
 * (the offer row's single-currency invariant, non-empty supplier code,
 * a real expiry instant); freshness/TTL enforcement belongs to the store.
 */
export function assemblePricedOffer(
  input: OfferAssemblyInput,
  resolution: PriceResolution,
): PricedOffer {
  if (input.supplierCode.length === 0) {
    throw new PricingInputError("offer supplierCode must be non-empty");
  }
  if (!isVertical(input.vertical)) {
    throw new PricingInputError(`offer vertical is not a known vertical: ${String(input.vertical)}`);
  }
  if (Number.isNaN(input.expiresAt.getTime())) {
    throw new PricingInputError("offer expiresAt must be a valid instant");
  }
  const { sell, breakdown, firedRuleId } = resolution;
  if (breakdown.net.currency !== sell.currency) {
    // Unreachable for resolvePrice output; guards hand-built resolutions.
    throw new PricingInputError(
      `offer is single-currency: net ${breakdown.net.currency} vs sell ${sell.currency}`,
    );
  }
  return {
    supplierCode: input.supplierCode,
    vertical: input.vertical,
    net: breakdown.net,
    sell,
    currency: sell.currency,
    markupRuleId: firedRuleId,
    breakdown,
    policySnapshot: input.policySnapshot,
    sellPolicySnapshot:
      input.policySnapshot === null ? null : sellPolicyFor(input.policySnapshot, breakdown, sell),
    expiresAt: input.expiresAt,
  };
}

/**
 * Scaling basis for the sell-side policy (review H1): the net figure minted
 * in the SAME currency as the policy's penalties — the pre-FX supplier net
 * when a stored rate applied, otherwise the sell-currency net basis. A
 * penalty currency matching neither is a normalization bug.
 */
function sellPolicyFor(
  policy: CancellationPolicy,
  breakdown: PriceBreakdown,
  sell: PriceResolution["sell"],
): CancellationPolicy {
  const penaltyCurrency = policy.rules[0]?.penalty.currency ?? breakdown.net.currency;
  const basis =
    breakdown.fx !== null && breakdown.fx.supplierNet.currency === penaltyCurrency
      ? breakdown.fx.supplierNet
      : breakdown.net;
  return toSellCancellationPolicy(policy, basis, sell);
}
