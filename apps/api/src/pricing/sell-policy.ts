/**
 * Agency-facing (SELL-side) cancellation policy (PR #107 review H1).
 *
 * Adapters normalize supplier policies with penalties in NET terms (the
 * supplier's own charge) — commercially confidential: sell − netPenalty is
 * the tenant's margin. Anything the AGENCY realm sees must therefore carry
 * penalties re-expressed on the sell side, derived here at pricing time:
 *
 *   sellPenalty = round_half_away_from_zero(netPenalty × sell / netBasis)
 *   capped at sell
 *
 * — the same half-away-from-zero commercial rounding documented on
 * @jenova/domain multiplyByScalar, computed with exact bigint arithmetic so
 * the sell/net ratio never passes through a float. Consequences:
 *   - a 100%-of-net penalty becomes EXACTLY 100%-of-sell;
 *   - a zero penalty stays exactly zero;
 *   - no sell-side penalty ever exceeds the sell price.
 *
 * The NET policy remains the internal truth: supplier settlement and ledger
 * penalty postings keep using it (booking-engine templates pass the supplier
 * penalty through 1:1 until penalty markup pricing lands with the credit
 * engine). This function only shapes what the agency surface displays and
 * what its refund math is computed from.
 */

import {
  assertValidCancellationPolicy,
  assertValidMoney,
  type CancellationPolicy,
  type Money,
} from "@jenova/domain";
import { PricingInputError } from "./errors";

function scaleHalfAwayFromZero(amount: number, sell: number, netBasis: number): number {
  const numerator = BigInt(amount) * BigInt(sell);
  const denominator = BigInt(netBasis);
  const sign = numerator < 0n !== denominator < 0n ? -1n : 1n;
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;
  const rounded = sign * ((2n * absNum + absDen) / (2n * absDen));
  const asNumber = Number(rounded);
  if (!Number.isSafeInteger(asNumber)) {
    throw new PricingInputError("sell-side penalty overflowed the safe integer range");
  }
  return asNumber;
}

/**
 * Re-expresses `policy`'s penalties on the sell side.
 *
 * @param netBasis the net the penalties were minted against, in the SAME
 *   currency the adapter priced them in (post-FX offers pass
 *   `breakdown.fx.supplierNet`; otherwise the offer net).
 * @param sell the server-resolved sell price; results take its currency.
 */
export function toSellCancellationPolicy(
  policy: CancellationPolicy,
  netBasis: Money,
  sell: Money,
): CancellationPolicy {
  assertValidCancellationPolicy(policy);
  assertValidMoney(netBasis);
  assertValidMoney(sell);

  const rules = policy.rules.map((rule) => {
    if (rule.penalty.currency !== netBasis.currency) {
      // Adapter invariant: penalties are minted in the supplier net
      // currency. A mismatch is a normalization bug, never a client state.
      throw new PricingInputError(
        `cancellation penalty currency ${rule.penalty.currency} does not match its net basis ${netBasis.currency}`,
      );
    }
    let amount: number;
    if (rule.penalty.amount === 0) {
      amount = 0;
    } else if (netBasis.amount <= 0) {
      // No meaningful ratio exists (free/zero-net stay with a non-zero
      // penalty would be supplier nonsense) — cap is all that remains.
      amount = Math.min(rule.penalty.amount, sell.amount);
    } else {
      amount = Math.min(
        scaleHalfAwayFromZero(rule.penalty.amount, sell.amount, netBasis.amount),
        sell.amount,
      );
    }
    return { fromUtc: rule.fromUtc, penalty: { amount, currency: sell.currency } };
  });

  return { refundable: policy.refundable, rules };
}
