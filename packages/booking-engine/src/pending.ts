/**
 * Pending-confirmation / pending-cancellation polling core (issue #68).
 *
 * Pure orchestration over seams: the WORKER composes this with the supplier
 * registry (retrieve) and the runner; every state change goes through the
 * runner ONLY. Two waits are polled:
 *
 * - confirmation: state = pending_confirmation — the supplier answered
 *   `pending` at book time; poll retrieve() until confirmed / cancelled /
 *   failed.
 * - cancellation: state = confirmed AND cancellation_requested_at set — the
 *   supplier accepted an async cancel (TBO CancellationInProgress); poll
 *   until the supplier reports cancelled, then post the penalty resolved AT
 *   REQUEST TIME (the fee the buyer was quoted).
 *
 * Backoff is exponential per item (poll_attempts / next_poll_at columns);
 * past `maxPendingAgeMs` the item is ESCALATED — automation stops and the
 * item surfaces in the core-workspace manual-intervention queue (modeled now
 * via escalated_at / escalation_reason + the booking_item.escalated event).
 */

import { and, asc, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { Money, TenantId } from "@jenova/domain";
import { resolvePenaltyAt, SupplierError, zero } from "@jenova/domain";
import { bookingItems, type TenantDbResolver } from "@jenova/db";
import type { HotelBookingRecord } from "@jenova/supplier-sdk";
import type { AuditActor, BookingItemRow, BookingTransitionRunner } from "./runner";

export interface PendingBackoffPolicy {
  /** First retry delay. */
  readonly baseMs: number;
  /** Exponential factor per attempt. */
  readonly factor: number;
  /** Delay ceiling. */
  readonly capMs: number;
  /** Age (from pending_since / cancellation_requested_at) that escalates. */
  readonly maxPendingAgeMs: number;
}

export const DEFAULT_PENDING_BACKOFF: PendingBackoffPolicy = {
  baseMs: 30_000,
  factor: 2,
  capMs: 600_000,
  maxPendingAgeMs: 1_800_000,
};

export function backoffDelayMs(policy: PendingBackoffPolicy, attempts: number): number {
  return Math.min(policy.capMs, Math.round(policy.baseMs * policy.factor ** Math.max(0, attempts)));
}

/** How the WORKER reaches the supplier: composed from registry + credentials. */
export type RetrieveBookingFn = (
  tenant: TenantId,
  supplierCode: string,
  supplierBookingReference: string,
) => Promise<HotelBookingRecord>;

export type PendingWaitKind = "confirmation" | "cancellation";

export interface PendingItemOutcome {
  readonly bookingItemId: string;
  readonly kind: PendingWaitKind;
  readonly outcome:
    | "transitioned_confirmed"
    | "transitioned_cancelled"
    | "transitioned_failed"
    | "still_pending"
    | "escalated"
    | "retrieve_failed";
  readonly detail?: string;
}

export interface PollReport {
  readonly due: number;
  readonly outcomes: readonly PendingItemOutcome[];
}

const WORKER_ACTOR: AuditActor = { actorType: "system", actorId: "worker:pending-confirmation" };

function waitKindOf(item: BookingItemRow): PendingWaitKind {
  return item.state === "pending_confirmation" ? "confirmation" : "cancellation";
}

function waitStartOf(item: BookingItemRow, kind: PendingWaitKind): Date {
  const anchor = kind === "confirmation" ? item.pendingSince : item.cancellationRequestedAt;
  // pending_since is stamped by the runner on entry; fall back to the row's
  // creation instant rather than updated_at (which poll bookkeeping moves).
  return anchor ?? item.createdAt;
}

/** Penalty in force for a cancellation settlement, from the STORED policy. */
function penaltyFor(item: BookingItemRow, at: Date): Money {
  const penalty = resolvePenaltyAt(item.policySnapshot, at);
  return penalty ?? zero(item.currency);
}

export class PendingConfirmationPoller {
  constructor(
    private readonly resolver: TenantDbResolver,
    private readonly runner: BookingTransitionRunner,
    private readonly retrieve: RetrieveBookingFn,
    private readonly policy: PendingBackoffPolicy = DEFAULT_PENDING_BACKOFF,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Items whose wait is due for a poll (never escalated ones). */
  async duePendingItems(tenant: TenantId, limit = 50): Promise<readonly BookingItemRow[]> {
    const db = await this.resolver.getTenantDb(tenant);
    const now = this.now();
    return db
      .select()
      .from(bookingItems)
      .where(
        and(
          or(
            eq(bookingItems.state, "pending_confirmation"),
            and(eq(bookingItems.state, "confirmed"), isNotNull(bookingItems.cancellationRequestedAt)),
          ),
          isNull(bookingItems.escalatedAt),
          or(isNull(bookingItems.nextPollAt), lte(bookingItems.nextPollAt, now)),
        ),
      )
      .orderBy(asc(sql`coalesce(${bookingItems.nextPollAt}, ${bookingItems.createdAt})`))
      .limit(limit);
  }

  /** One full poll pass over a tenant. */
  async pollTenant(tenant: TenantId, limit = 50): Promise<PollReport> {
    const due = await this.duePendingItems(tenant, limit);
    const outcomes: PendingItemOutcome[] = [];
    for (const item of due) {
      outcomes.push(await this.pollItem(tenant, item));
    }
    return { due: due.length, outcomes };
  }

  /** Polls ONE item: retrieve at the supplier, act through the runner. */
  async pollItem(tenant: TenantId, item: BookingItemRow): Promise<PendingItemOutcome> {
    const kind = waitKindOf(item);
    if (item.supplierReference === null) {
      // Unreachable by construction (only booked items enter these waits) —
      // but a poll loop must never crash on one bad row: escalate it.
      await this.runner.escalate(tenant, item.id, WORKER_ACTOR, "pending item has no supplier reference");
      return { bookingItemId: item.id, kind, outcome: "escalated", detail: "missing supplier reference" };
    }

    let record: HotelBookingRecord;
    try {
      record = await this.retrieve(tenant, item.supplierCode, item.supplierReference);
    } catch (error) {
      const detail = error instanceof SupplierError ? error.kind : "unexpected retrieve failure";
      const escalated = await this.deferOrEscalate(tenant, item, kind, `retrieve failed: ${detail}`);
      return {
        bookingItemId: item.id,
        kind,
        outcome: escalated ? "escalated" : "retrieve_failed",
        detail,
      };
    }

    if (kind === "confirmation") {
      return this.settleConfirmationWait(tenant, item, record);
    }
    return this.settleCancellationWait(tenant, item, record);
  }

  private async settleConfirmationWait(
    tenant: TenantId,
    item: BookingItemRow,
    record: HotelBookingRecord,
  ): Promise<PendingItemOutcome> {
    const kind: PendingWaitKind = "confirmation";
    switch (record.status) {
      case "confirmed": {
        await this.runner.transition(tenant, item.id, "confirmed", {
          expectedFrom: "pending_confirmation",
          actor: WORKER_ACTOR,
          reason: "supplier retrieve reports the booking confirmed",
          patch: { supplierReference: record.supplierBookingReference },
        });
        return { bookingItemId: item.id, kind, outcome: "transitioned_confirmed" };
      }
      case "cancelled": {
        // The supplier killed the pending booking. Nothing was recognized
        // (confirm never posted); the penalty in force now covers the
        // no-show/auto-cancel fee case, usually zero.
        await this.runner.transition(tenant, item.id, "cancelled", {
          expectedFrom: "pending_confirmation",
          actor: WORKER_ACTOR,
          reason: "supplier retrieve reports the pending booking cancelled supplier-side",
          penalty: penaltyFor(item, this.now()),
        });
        return { bookingItemId: item.id, kind, outcome: "transitioned_cancelled" };
      }
      case "pending": {
        const escalated = await this.deferOrEscalate(tenant, item, kind, "still pending at the supplier");
        return { bookingItemId: item.id, kind, outcome: escalated ? "escalated" : "still_pending" };
      }
    }
  }

  private async settleCancellationWait(
    tenant: TenantId,
    item: BookingItemRow,
    record: HotelBookingRecord,
  ): Promise<PendingItemOutcome> {
    const kind: PendingWaitKind = "cancellation";
    if (record.status === "cancelled") {
      const requestedAt = item.cancellationRequestedAt ?? this.now();
      await this.runner.transition(tenant, item.id, "cancelled", {
        expectedFrom: "confirmed",
        actor: WORKER_ACTOR,
        reason: "supplier retrieve reports the requested cancellation settled",
        // The fee the buyer was quoted WHEN CANCELLATION WAS REQUESTED —
        // settlement lag at the supplier must not move the penalty window.
        penalty: penaltyFor(item, requestedAt),
      });
      return { bookingItemId: item.id, kind, outcome: "transitioned_cancelled" };
    }
    // pending (CancellationInProgress) or still confirmed: keep waiting.
    const escalated = await this.deferOrEscalate(
      tenant,
      item,
      kind,
      `cancellation not settled (supplier reports ${record.status})`,
    );
    return { bookingItemId: item.id, kind, outcome: escalated ? "escalated" : "still_pending" };
  }

  /** Backoff another attempt, or escalate once the wait exceeds max age. */
  private async deferOrEscalate(
    tenant: TenantId,
    item: BookingItemRow,
    kind: PendingWaitKind,
    why: string,
  ): Promise<boolean> {
    const now = this.now();
    const ageMs = now.getTime() - waitStartOf(item, kind).getTime();
    if (ageMs > this.policy.maxPendingAgeMs) {
      await this.runner.escalate(
        tenant,
        item.id,
        WORKER_ACTOR,
        `${kind} wait exceeded ${String(this.policy.maxPendingAgeMs)}ms (${why}) — manual intervention required`,
      );
      return true;
    }
    const attempts = item.pollAttempts + 1;
    await this.runner.recordPollAttempt(
      tenant,
      item.id,
      attempts,
      new Date(now.getTime() + backoffDelayMs(this.policy, item.pollAttempts)),
    );
    return false;
  }
}
