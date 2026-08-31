/**
 * Client-side result filtering/sorting over STREAMED offers (issue #96).
 * Pure and unit-tested. Filters only ever hide server-priced offers — they
 * never compute or alter a price.
 */

import type { OfferSummary } from "./types";

export type BoardBasis = OfferSummary["boardBasis"];

export interface OfferFilters {
  readonly refundableOnly: boolean;
  /** Empty = all boards. */
  readonly boards: readonly BoardBasis[];
  /** Inclusive cap in MINOR units of the result currency; null = no cap. */
  readonly maxSellMinor: number | null;
}

export const NO_FILTERS: OfferFilters = { refundableOnly: false, boards: [], maxSellMinor: null };

export function applyOfferFilters(
  offers: readonly OfferSummary[],
  filters: OfferFilters,
): readonly OfferSummary[] {
  return offers.filter((offer) => {
    if (filters.refundableOnly && !offer.refundable) {
      return false;
    }
    if (filters.boards.length > 0 && !filters.boards.includes(offer.boardBasis)) {
      return false;
    }
    if (filters.maxSellMinor !== null && offer.sell.amount > filters.maxSellMinor) {
      return false;
    }
    return true;
  });
}

/** Cheapest first; stable for equal amounts (arrival order preserved). */
export function sortBySellAscending(offers: readonly OfferSummary[]): readonly OfferSummary[] {
  return [...offers].sort((a, b) => a.sell.amount - b.sell.amount);
}
