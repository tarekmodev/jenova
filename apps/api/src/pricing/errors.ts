/** Pricing error taxonomy — all pure-library failures extend PricingError. */

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A malformed markup rule (would violate the tenant-schema SQL checks). */
export class PricingRuleError extends PricingError {}

/** A malformed or insufficient pricing input (context / net / settlement). */
export class PricingInputError extends PricingError {}

/**
 * Currencies would mix without an explicit stored rate (CLAUDE.md rule 6:
 * FX only via a stored rate — never implicit, never a live lookup here).
 */
export class PricingCurrencyError extends PricingError {}
