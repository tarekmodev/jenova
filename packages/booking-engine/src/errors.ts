/**
 * Typed failures of the booking transition runner and ledger core
 * (issues #66/#69). Every kind is distinguishable by class so callers key
 * behavior off types, never off message text.
 */

import type { BookingItemState } from "@jenova/domain";

/** The addressed booking item does not exist in this tenant's database. */
export class BookingItemNotFoundError extends Error {
  constructor(readonly bookingItemId: string) {
    super(`booking item ${bookingItemId} does not exist`);
    this.name = "BookingItemNotFoundError";
  }
}

/** The addressed booking does not exist in this tenant's database. */
export class BookingNotFoundError extends Error {
  constructor(readonly bookingId: string) {
    super(`booking ${bookingId} does not exist`);
    this.name = "BookingNotFoundError";
  }
}

/**
 * Optimistic-concurrency refusal: the item was not in the expected `from`
 * state when the guarded UPDATE ran (a concurrent transition won the race,
 * or the caller acted on stale state). NOTHING was written — the whole
 * transaction rolled back. Retry by re-reading current state.
 */
export class TransitionConflictError extends Error {
  constructor(
    readonly bookingItemId: string,
    readonly expectedFrom: BookingItemState,
    readonly actualState: BookingItemState | null,
  ) {
    super(
      `booking item ${bookingItemId} is not in state ${expectedFrom}` +
        (actualState === null ? "" : ` (found ${actualState})`) +
        " — a concurrent transition won, or the caller holds stale state",
    );
    this.name = "TransitionConflictError";
  }
}

/**
 * The transition is legal in the domain state machine but M1 defines no
 * posting template for it (e.g. issued/amendment edges land in later
 * milestones). Refusing loudly beats posting nothing silently: an edge
 * without an explicit financial meaning must not move money-bearing state.
 */
export class MissingPostingTemplateError extends Error {
  constructor(readonly edge: string) {
    super(`no ledger posting template is defined for transition ${edge}`);
    this.name = "MissingPostingTemplateError";
  }
}

/** The ledger invariant checker found unbalanced transaction groups. */
export class LedgerImbalanceError extends Error {
  constructor(
    readonly groups: readonly { transactionGroupId: string; currency: string; total: bigint }[],
  ) {
    super(
      `ledger invariant violated — unbalanced transaction groups: ${groups
        .map((g) => `${g.transactionGroupId} (${String(g.total)} ${g.currency})`)
        .join(", ")}`,
    );
    this.name = "LedgerImbalanceError";
  }
}

/**
 * A cancel-family transition was attempted without resolving the penalty
 * first. The fee preview (resolvePenaltyAt over the stored normalized
 * policy) is MANDATORY before execution — passing `penalty: null` asserts
 * "resolved: free cancellation", omitting it asserts nothing.
 */
export class MissingPenaltyResolutionError extends Error {
  constructor(readonly edge: string) {
    super(
      `transition ${edge} posts penalty entries — resolve the cancellation penalty ` +
        "(resolvePenaltyAt on the stored policy) and pass it explicitly (null = resolved as free)",
    );
    this.name = "MissingPenaltyResolutionError";
  }
}
