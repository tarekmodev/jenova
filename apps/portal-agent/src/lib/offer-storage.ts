"use client";

/**
 * Hand-off between the results list and the offer page (sessionStorage).
 * What is stored is display context + the SIGNED offer token; the server
 * re-verifies the token on check and book — nothing stored here is trusted
 * for money (CLAUDE.md rule 8).
 */

import type { StoredOfferContext } from "./types";

const KEY_PREFIX = "jenova.agent.offer.";

export function storeOfferContext(context: StoredOfferContext): void {
  try {
    sessionStorage.setItem(KEY_PREFIX + context.offer.offerId, JSON.stringify(context));
  } catch {
    // Storage unavailable: the offer page will show its "offer unavailable"
    // state and send the agent back to search.
  }
}

export function loadOfferContext(offerId: string): StoredOfferContext | null {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + offerId);
    if (raw === null) {
      return null;
    }
    return JSON.parse(raw) as StoredOfferContext;
  } catch {
    return null;
  }
}
