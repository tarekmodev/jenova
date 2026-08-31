/**
 * @jenova/booking-engine — the booking-item state-machine runner, ledger
 * posting core, outbox events, and pending-confirmation polling core
 * (M1 issues #66/#68/#69).
 *
 * A shared PACKAGE (not api code) because BOTH engine processes execute
 * transitions — the api's booking service and the worker's pending poller —
 * and apps may only import shared packages, never each other
 * (docs/07-tech-stack.md). Every transition, wherever it originates, goes
 * through BookingTransitionRunner: no other write path to
 * booking_item.state exists.
 */

export {
  BookingItemNotFoundError,
  BookingNotFoundError,
  LedgerImbalanceError,
  MissingPenaltyResolutionError,
  MissingPostingTemplateError,
  TransitionConflictError,
} from "./errors";

export {
  CHART_OF_ACCOUNTS,
  LEDGER_ACCOUNT_KEYS,
  ledgerAccountCode,
  type LedgerAccountKey,
} from "./ledger/chart";

export {
  POSTING_TEMPLATES,
  assertTemplatesBalanced,
  templateUsesPenalty,
  transitionEdge,
  type PostingAmountSource,
  type PostingDirection,
  type PostingLine,
  type PostingTemplate,
  type TransitionEdge,
} from "./ledger/templates";

export {
  accountBalance,
  assertLedgerBalanced,
  journalEntriesOfBooking,
  journalEntriesOfGroup,
  requirePostingTemplate,
  trialBalance,
  unbalancedTransactionGroups,
  type AccountBalance,
  type BookingJournalLine,
  type PostingAmounts,
  type UnbalancedGroup,
} from "./ledger/service";

export {
  NoopEventSink,
  OutboxDispatcher,
  type BookingDomainEvent,
  type DomainEventSink,
  type NewDomainEvent,
} from "./events";

export {
  BookingTransitionRunner,
  loadBookingWithItems,
  moneyAmountFrom,
  type AuditActor,
  type BookingItemRow,
  type BookingRow,
  type CreateHotelBookingInput,
  type CreateHotelBookingResult,
  type TransitionContext,
  type TransitionPatch,
  type TransitionResult,
} from "./runner";

export {
  DEFAULT_PENDING_BACKOFF,
  PendingConfirmationPoller,
  backoffDelayMs,
  type PendingBackoffPolicy,
  type PendingItemOutcome,
  type PendingWaitKind,
  type PollReport,
  type RetrieveBookingFn,
} from "./pending";
