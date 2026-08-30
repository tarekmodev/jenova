/**
 * Pure markup resolution engine (issue #62): resolve a supplier net into a
 * sell price + exact integer breakdown. NO IO on this path — rules, stored
 * FX rate and VAT treatment all arrive as inputs; the Nest module wraps this
 * with rule loading.
 *
 * Money discipline (CLAUDE.md rule 6): integer minor units end to end, all
 * arithmetic through @jenova/domain Money helpers. The only rounding points
 * are `multiplyByScalar` (documented half-away-from-zero, one step) and
 * `allocate` (largest-remainder — parts always sum exactly), so the
 * breakdown components always sum EXACTLY to the sell amount.
 *
 * FX: conversion happens only when the caller supplies a `SettlementSpec`
 * carrying a STORED rate + the tenant-configurable buffer — never a live
 * lookup inside pricing. Without a stored rate, currencies never mix: a
 * monetary rule in another currency throws PricingCurrencyError.
 *
 * VAT: the treatment hook carries taxable base vs VAT now (15% SA default,
 * per-tenant config); per-case fiscal treatment (domestic vs international
 * transport, agent vs merchant model — docs/06) lands with fiscal-sa in M4.
 */

import type { Money } from "@jenova/domain";
import { add, allocate, assertValidMoney, money, multiplyByScalar, subtract, zero } from "@jenova/domain";
import { PricingCurrencyError, PricingInputError, PricingRuleError } from "./errors";
import type { PricingContext, PricingRule } from "./rules";
import { selectRule } from "./rules";

const ISO_4217_RE = /^[A-Z]{3}$/;

/** How VAT participates in the sell price. */
export type VatMode = "inclusive" | "exclusive" | "exempt";

export interface VatTreatment {
  readonly mode: VatMode;
  /** e.g. 1500 = 15%. */
  readonly rateBps: number;
}

/** Saudi default: prices quoted VAT-inclusive at 15% (docs/06). */
export const SA_DEFAULT_VAT: VatTreatment = { mode: "inclusive", rateBps: 1500 };

/** A rate captured and stored earlier — pricing never looks one up live. */
export interface StoredFxRate {
  /** ISO 4217 code the rate converts FROM (must equal the net's currency). */
  readonly from: string;
  /** ISO 4217 code the rate converts TO (must equal the sell currency). */
  readonly to: string;
  /**
   * Decimal units of `to` per unit of `from` (e.g. 3.75 SAR/USD). Applied
   * via multiplyByScalar's exact-decimal decomposition.
   */
  readonly rate: number;
  /** ISO 8601 instant the rate was captured — stamped into the breakdown. */
  readonly asOf: string;
}

/** Requested sell currency + the stored rate and tenant buffer to reach it. */
export interface SettlementSpec {
  readonly currency: string;
  readonly rate: StoredFxRate;
  /**
   * Tenant-configurable FX protection margin in basis points, applied ON TOP
   * of the stored rate (raises the net basis in sell currency, so the tenant
   * is covered against rate movement between pricing and settlement).
   */
  readonly bufferBps: number;
}

export interface AppliedFx {
  /** The original supplier net, before conversion. */
  readonly supplierNet: Money;
  readonly rate: StoredFxRate;
  readonly bufferBps: number;
}

export type PriceComponentKind = "net" | "markup" | "vat";

export interface PriceComponent {
  readonly kind: PriceComponentKind;
  readonly amount: Money;
}

/** Exact split of the markup between the buying agency and the tenant. */
export interface CommissionSplit {
  readonly agencyCommission: Money;
  readonly tenantMargin: Money;
}

export interface PriceBreakdown {
  /** Net basis in the SELL currency (post-FX, post-buffer). */
  readonly net: Money;
  /** Applied markup (negative only when a rule explicitly discounts). */
  readonly markup: Money;
  /** Sell amount excluding VAT. taxableBase + vat === sell, always. */
  readonly taxableBase: Money;
  readonly vat: Money;
  readonly vatTreatment: VatTreatment;
  /** Always sums EXACTLY to the sell amount (integer math, no drift). */
  readonly components: readonly PriceComponent[];
  /** Present iff the fired rule carries commissionSplitBps; sums to markup. */
  readonly commissionSplit: CommissionSplit | null;
  /** Present iff a stored-rate conversion was applied. */
  readonly fx: AppliedFx | null;
}

export interface PriceResolution {
  readonly sell: Money;
  readonly breakdown: PriceBreakdown;
  /** Id of the markup_rule that fired — stored on the Offer for audit. */
  readonly firedRuleId: string | null;
}

export interface ResolveOptions {
  /** Sell-currency conversion via stored rate; omit to sell in net currency. */
  readonly settlement?: SettlementSpec;
  /** Defaults to SA_DEFAULT_VAT; per-tenant config plumbs in here. */
  readonly vat?: VatTreatment;
}

function assertValidVat(vat: VatTreatment): void {
  if (!Number.isSafeInteger(vat.rateBps) || vat.rateBps < 0 || vat.rateBps > 10_000) {
    throw new PricingInputError("vat rateBps must be an integer in 0..10000");
  }
}

function assertValidSettlement(settlement: SettlementSpec, netCurrency: string): void {
  if (!ISO_4217_RE.test(settlement.currency)) {
    throw new PricingInputError("settlement currency must be a 3-letter ISO 4217 code");
  }
  if (settlement.currency === netCurrency) {
    throw new PricingInputError(
      "settlement must be omitted when the sell currency equals the net currency — no conversion to apply",
    );
  }
  const { rate } = settlement;
  if (rate.from !== netCurrency || rate.to !== settlement.currency) {
    throw new PricingCurrencyError(
      `stored rate ${rate.from}->${rate.to} does not cover ${netCurrency}->${settlement.currency}`,
    );
  }
  if (!Number.isFinite(rate.rate) || rate.rate <= 0) {
    throw new PricingInputError("stored FX rate must be a finite number > 0");
  }
  if (
    !Number.isSafeInteger(settlement.bufferBps) ||
    settlement.bufferBps < 0 ||
    settlement.bufferBps > 10_000
  ) {
    throw new PricingInputError("FX bufferBps must be an integer in 0..10000");
  }
}

/** Positive quantity required by per_night / per_pax rules. */
function requireQuantity(value: number | null, field: "nights" | "paxCount", ruleId: string): number {
  if (value === null || !Number.isSafeInteger(value) || value < 1) {
    throw new PricingInputError(
      `rule ${ruleId} is ${field === "nights" ? "per_night" : "per_pax"} but context.${field} is not a positive integer`,
    );
  }
  return value;
}

/** allocate() with two weights always yields two parts; narrow the types. */
function allocatePair(total: Money, weights: readonly [number, number]): [Money, Money] {
  const [a, b] = allocate(total, [weights[0], weights[1]]);
  if (a === undefined || b === undefined) {
    throw new PricingInputError("allocate returned fewer parts than weights"); // unreachable
  }
  return [a, b];
}

function ruleMinorUnits(rule: PricingRule): number {
  const value = Number(rule.value);
  if (!Number.isSafeInteger(value)) {
    throw new PricingRuleError(`rule ${rule.id}: value exceeds the safe integer range`);
  }
  return value;
}

/** Markup for the fired rule, in the sell currency. Negative = discount. */
function ruleMarkup(rule: PricingRule, net: Money, context: PricingContext): Money {
  switch (rule.valueType) {
    case "percent":
      // Basis points: exactly one documented rounding, half away from zero.
      return multiplyByScalar(net, ruleMinorUnits(rule) / 10_000);
    case "fixed":
    case "per_night":
    case "per_pax": {
      if (rule.currency !== net.currency) {
        throw new PricingCurrencyError(
          `rule ${rule.id} is priced in ${String(rule.currency)} but the sell currency is ${net.currency} — currencies never mix without a stored rate`,
        );
      }
      const unit = money(ruleMinorUnits(rule), net.currency);
      if (rule.valueType === "fixed") return unit;
      const quantity =
        rule.valueType === "per_night"
          ? requireQuantity(context.nights, "nights", rule.id)
          : requireQuantity(context.paxCount, "paxCount", rule.id);
      // Integer scalar: exact bigint multiply, no rounding at all.
      return multiplyByScalar(unit, quantity);
    }
  }
}

/**
 * Resolve a supplier net into the sell price for this context.
 *
 * Guarantees (property-tested):
 * - sell >= net basis unless the fired rule explicitly discounts
 *   (rule.value < 0), and sell is never below zero (discounts clamp at 0);
 * - breakdown components sum exactly to sell; taxableBase + vat === sell;
 *   commission split sums exactly to markup;
 * - deterministic: same inputs, identical resolution;
 * - single currency throughout, converted only via the stored settlement rate.
 */
export function resolvePrice(
  net: Money,
  context: PricingContext,
  rules: readonly PricingRule[],
  options: ResolveOptions = {},
): PriceResolution {
  assertValidMoney(net);
  if (net.amount < 0) {
    throw new PricingInputError("supplier net must not be negative");
  }
  const vatTreatment = options.vat ?? SA_DEFAULT_VAT;
  assertValidVat(vatTreatment);

  // 1. Sell-currency basis: stored-rate conversion + tenant buffer, or the
  //    net as-is. Two documented rounding steps (rate, then buffer).
  let netBasis = net;
  let fx: AppliedFx | null = null;
  const settlement = options.settlement;
  if (settlement !== undefined) {
    assertValidSettlement(settlement, net.currency);
    const converted = money(multiplyByScalar(net, settlement.rate.rate).amount, settlement.currency);
    netBasis =
      settlement.bufferBps === 0
        ? converted
        : multiplyByScalar(converted, 1 + settlement.bufferBps / 10_000);
    fx = { supplierNet: net, rate: settlement.rate, bufferBps: settlement.bufferBps };
  }
  const sellCurrency = netBasis.currency;

  // 2. Most-specific-wins rule selection (ordering documented in rules.ts).
  const rule = selectRule(rules, context);

  // 3. Markup — clamped so an explicit discount can never sell below zero;
  //    after clamping the components still sum (markup becomes -netBasis).
  let markup = rule === null ? zero(sellCurrency) : ruleMarkup(rule, netBasis, context);
  let preTax = add(netBasis, markup);
  if (preTax.amount < 0) {
    preTax = zero(sellCurrency);
    markup = subtract(preTax, netBasis);
  }

  // 4. VAT treatment: inclusive carves the tax out of the sell (allocate —
  //    exact), exclusive adds it on top, exempt carries zero.
  let sell: Money;
  let taxableBase: Money;
  let vat: Money;
  switch (vatTreatment.mode) {
    case "inclusive": {
      sell = preTax;
      [taxableBase, vat] = allocatePair(sell, [10_000, vatTreatment.rateBps]);
      break;
    }
    case "exclusive": {
      vat = multiplyByScalar(preTax, vatTreatment.rateBps / 10_000);
      taxableBase = preTax;
      sell = add(preTax, vat);
      break;
    }
    case "exempt": {
      sell = preTax;
      taxableBase = preTax;
      vat = zero(sellCurrency);
      break;
    }
  }

  // 5. Commission split — exact allocation of the markup, agency share first.
  let commissionSplit: CommissionSplit | null = null;
  if (rule !== null && rule.commissionSplitBps !== null) {
    const [agencyCommission, tenantMargin] = allocatePair(markup, [
      rule.commissionSplitBps,
      10_000 - rule.commissionSplitBps,
    ]);
    commissionSplit = { agencyCommission, tenantMargin };
  }

  // 6. Components sum exactly to sell: net+markup(+vat when added on top).
  const components: PriceComponent[] = [
    { kind: "net", amount: netBasis },
    { kind: "markup", amount: markup },
  ];
  if (vatTreatment.mode === "exclusive") {
    components.push({ kind: "vat", amount: vat });
  }

  return {
    sell,
    firedRuleId: rule === null ? null : rule.id,
    breakdown: {
      net: netBasis,
      markup,
      taxableBase,
      vat,
      vatTreatment,
      components,
      commissionSplit,
      fx,
    },
  };
}
