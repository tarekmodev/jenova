/**
 * Booking item state machine as data + normalized cancellation policy
 * (docs/03-domain-model.md).
 *
 * Legal transitions are DATA, not code: the runner validates against
 * BOOKING_ITEM_TRANSITIONS and performs every transition atomically
 * (persist + ledger postings + AuditEvent + event emission). This module
 * only encodes legality — pure, zero IO.
 */

import { assertValidMoney, type Money } from "./money";

export const BOOKING_ITEM_STATES = [
  "quoted",
  "reserved",
  "pending_confirmation",
  "confirmed",
  "issued",
  "amendment_pending",
  "completed",
  "cancelled",
  "failed",
] as const;
export type BookingItemState = (typeof BOOKING_ITEM_STATES)[number];

/**
 * Encodes the diagram in docs/03-domain-model.md:
 *
 *   quoted → reserved → (pending_confirmation) → confirmed → issued → completed
 *                │               │                   │          │
 *                └── failed      └── failed/cancel   ├── amendment_pending ⇄
 *                                                    └── cancelled
 *
 * pending_confirmation is optional (async suppliers only), so reserved may
 * go straight to confirmed. amendment_pending is bidirectional with both
 * confirmed and issued. completed/cancelled/failed are terminal.
 */
export const BOOKING_ITEM_TRANSITIONS: Readonly<
  Record<BookingItemState, readonly BookingItemState[]>
> = {
  quoted: ["reserved"],
  reserved: ["pending_confirmation", "confirmed", "failed"],
  pending_confirmation: ["confirmed", "failed", "cancelled"],
  confirmed: ["issued", "amendment_pending", "cancelled"],
  issued: ["completed", "amendment_pending", "cancelled"],
  amendment_pending: ["confirmed", "issued"],
  completed: [],
  cancelled: [],
  failed: [],
};

export class IllegalTransitionError extends Error {
  constructor(
    readonly from: BookingItemState,
    readonly to: BookingItemState,
  ) {
    super(`illegal booking item transition: ${from} → ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function canTransition(from: BookingItemState, to: BookingItemState): boolean {
  return BOOKING_ITEM_TRANSITIONS[from].includes(to);
}

/** Throws `IllegalTransitionError` unless `from → to` is a legal transition. */
export function assertTransition(from: BookingItemState, to: BookingItemState): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
}

export function isTerminalState(state: BookingItemState): boolean {
  return BOOKING_ITEM_TRANSITIONS[state].length === 0;
}

/**
 * Normalized cancellation policy — the canonical form every supplier's
 * encoding is translated into at the adapter boundary. Rules are ordered by
 * `fromUtc` ascending; each rule's penalty applies from its instant until
 * the next rule takes over. Adapters resolve supplier-local deadlines to
 * UTC and penalty encodings (percent, nights, fixed) to Money at
 * translation time. A non-refundable item is `refundable: false` with a
 * full-price penalty rule from the moment of booking.
 */
export interface CancellationPolicyRule {
  /** UTC instant (ISO 8601) from which `penalty` applies. */
  readonly fromUtc: string;
  readonly penalty: Money;
}

export interface CancellationPolicy {
  readonly refundable: boolean;
  readonly rules: readonly CancellationPolicyRule[];
}

export class InvalidCancellationPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCancellationPolicyError";
  }
}

function parseUtcInstant(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new InvalidCancellationPolicyError(`not a parseable UTC instant: ${JSON.stringify(iso)}`);
  }
  return ms;
}

/** Throws unless rules are valid Money penalties ordered by fromUtc ascending. */
export function assertValidCancellationPolicy(policy: CancellationPolicy): void {
  let previous = -Infinity;
  for (const rule of policy.rules) {
    assertValidMoney(rule.penalty);
    const ms = parseUtcInstant(rule.fromUtc);
    if (ms < previous) {
      throw new InvalidCancellationPolicyError(
        `rules must be ordered by fromUtc ascending; ${rule.fromUtc} is out of order`,
      );
    }
    previous = ms;
  }
}

/**
 * The penalty in force at `instant`: the latest rule whose `fromUtc` is at
 * or before it. Returns `undefined` when `instant` precedes every rule
 * (cancellation is free at that moment) — including for a policy with no
 * rules at all.
 */
export function resolvePenaltyAt(policy: CancellationPolicy, instant: Date): Money | undefined {
  assertValidCancellationPolicy(policy);
  const at = instant.getTime();
  if (Number.isNaN(at)) {
    throw new InvalidCancellationPolicyError("instant must be a valid Date");
  }
  let inForce: Money | undefined;
  for (const rule of policy.rules) {
    if (parseUtcInstant(rule.fromUtc) <= at) {
      inForce = rule.penalty;
    } else {
      break;
    }
  }
  return inForce;
}
