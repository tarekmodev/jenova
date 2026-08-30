/**
 * THE booking-item state-machine runner (issue #66; CLAUDE.md rule 7).
 *
 * Every transition executes atomically in ONE tenant-database transaction:
 *
 *   1. legality  — BOOKING_ITEM_TRANSITIONS as data; an illegal edge throws
 *      the domain's typed IllegalTransitionError BEFORE any write.
 *   2. persist   — optimistic concurrency: UPDATE ... WHERE state =
 *      expectedFrom; anything but rowcount 1 is a typed
 *      TransitionConflictError and the transaction rolls back untouched.
 *   3. postings  — the edge's ledger template (templates as data, #69);
 *      the deferred DB trigger re-proves balance at COMMIT.
 *   4. audit     — append-only AuditEvent with actor and before/after.
 *   5. events    — outbox rows in the SAME transaction; published after
 *      commit by the dispatcher (see events.ts for the outbox-light choice).
 *
 * NO transition path exists outside this runner: it is the only module that
 * writes booking_item.state, and every caller (booking service, worker,
 * future sagas) goes through `transition`.
 */

import { and, eq, isNull } from "drizzle-orm";
import type { BookingItemState, CancellationPolicy, Money, SalesChannel, SubTenantId, TenantId, Vertical } from "@jenova/domain";
import { assertTransition, assertValidMoney } from "@jenova/domain";
import {
  auditEvents,
  bookingItems,
  bookings,
  type AuditActorType,
  type TenantDbResolver,
} from "@jenova/db";
import { BookingItemNotFoundError, BookingNotFoundError, TransitionConflictError } from "./errors";
import {
  insertOutboxEvents,
  NoopEventSink,
  OutboxDispatcher,
  type BookingDomainEvent,
  type DomainEventSink,
} from "./events";
import { postTransitionEntries, requirePostingTemplate } from "./ledger/service";
import { transitionEdge } from "./ledger/templates";
import type { TenantTx } from "./tx";

export type BookingRow = typeof bookings.$inferSelect;
export type BookingItemRow = typeof bookingItems.$inferSelect;

/** Who performed the change — recorded verbatim on the AuditEvent. */
export interface AuditActor {
  readonly actorType: AuditActorType;
  /** Realm-scoped user/key id; null for autonomous system actions. */
  readonly actorId: string | null;
}

/** Columns a transition may set alongside the state change. */
export interface TransitionPatch {
  readonly supplierReference?: string;
  /** Set when entering pending_confirmation — the escalation age anchor. */
  readonly pendingSince?: Date;
  /** First poll due-time when entering a polled state. */
  readonly nextPollAt?: Date | null;
  readonly cancellationRequestedAt?: Date;
}

export interface TransitionContext {
  /** Optimistic-concurrency guard: the state the caller believes it holds. */
  readonly expectedFrom: BookingItemState;
  readonly actor: AuditActor;
  /** Why — lands in the audit event and the outbox payload. */
  readonly reason: string;
  readonly patch?: TransitionPatch;
  /**
   * Cancellation penalty resolved BEFORE execution (resolvePenaltyAt on the
   * stored policy). Required (null = resolved as free) on penalty-posting
   * edges; ignored elsewhere.
   */
  readonly penalty?: Money | null;
  /** Extra structured context for the audit `after` and event payload. */
  readonly details?: Record<string, unknown>;
}

export interface TransitionResult {
  readonly bookingId: string;
  readonly bookingItemId: string;
  readonly from: BookingItemState;
  readonly to: BookingItemState;
  /** null when the edge posts nothing (memo-only edges). */
  readonly transactionGroupId: string | null;
  readonly journalEntryCount: number;
  readonly events: readonly BookingDomainEvent[];
}

export interface CreateHotelBookingInput {
  /** Caller idempotency key — UNIQUE: one clientReference, one booking, ever. */
  readonly clientReference: string;
  readonly channel: SalesChannel;
  readonly agencyId: SubTenantId | null;
  readonly supplierCode: string;
  readonly vertical: Vertical;
  readonly offerId: string | null;
  readonly net: Money;
  readonly sell: Money;
  readonly policySnapshot: CancellationPolicy;
  readonly actor: AuditActor;
}

export interface CreateHotelBookingResult {
  /** False = the clientReference already existed; `booking`/`item` are the ORIGINAL rows. */
  readonly created: boolean;
  readonly booking: BookingRow;
  readonly item: BookingItemRow;
}

export class BookingTransitionRunner {
  private readonly dispatcher: OutboxDispatcher;

  constructor(
    private readonly resolver: TenantDbResolver,
    sink: DomainEventSink = new NoopEventSink(),
  ) {
    this.dispatcher = new OutboxDispatcher(resolver, sink);
  }

  /** The dispatcher, exposed for the worker's redelivery sweep. */
  get outbox(): OutboxDispatcher {
    return this.dispatcher;
  }

  /**
   * Creates the Booking + its quoted BookingItem atomically, with audit and
   * outbox events. Idempotent on clientReference: a duplicate returns the
   * EXISTING booking untouched (`created: false`) — a retried call can never
   * mint a second booking (CLAUDE.md rule 8).
   */
  async createHotelBooking(
    tenant: TenantId,
    input: CreateHotelBookingInput,
  ): Promise<CreateHotelBookingResult> {
    assertValidMoney(input.net);
    assertValidMoney(input.sell);
    if (input.net.currency !== input.sell.currency) {
      throw new Error("booking item is single-currency: net and sell must agree");
    }
    if (input.clientReference.length === 0) {
      throw new Error("clientReference must be non-empty — it is the idempotency key");
    }
    const db = await this.resolver.getTenantDb(tenant);
    const created = await db.transaction(async (tx) => {
      const [booking] = await tx
        .insert(bookings)
        .values({
          clientReference: input.clientReference,
          channel: input.channel,
          agencyId: input.agencyId,
          totalAmount: BigInt(input.sell.amount),
          currency: input.sell.currency,
        })
        .onConflictDoNothing({ target: bookings.clientReference })
        .returning();
      if (booking === undefined) {
        return null; // duplicate clientReference — resolved outside the tx
      }
      const [item] = await tx
        .insert(bookingItems)
        .values({
          bookingId: booking.id,
          vertical: input.vertical,
          state: "quoted",
          supplierCode: input.supplierCode,
          offerId: input.offerId,
          netAmount: BigInt(input.net.amount),
          sellAmount: BigInt(input.sell.amount),
          currency: input.sell.currency,
          policySnapshot: input.policySnapshot,
        })
        .returning();
      if (item === undefined) {
        throw new Error("booking item insert returned no row");
      }
      await tx.insert(auditEvents).values({
        actorType: input.actor.actorType,
        actorId: input.actor.actorId,
        entityType: "booking",
        entityId: booking.id,
        action: "booking.created",
        before: null,
        after: {
          clientReference: input.clientReference,
          channel: input.channel,
          agencyId: input.agencyId,
          bookingItemId: item.id,
          state: item.state,
          supplierCode: input.supplierCode,
          net: { amount: input.net.amount, currency: input.net.currency },
          sell: { amount: input.sell.amount, currency: input.sell.currency },
          offerId: input.offerId,
        },
      });
      const events = await insertOutboxEvents(tx, [
        {
          eventType: "booking.created",
          bookingId: booking.id,
          bookingItemId: item.id,
          payload: {
            clientReference: input.clientReference,
            channel: input.channel,
            state: item.state,
            supplierCode: input.supplierCode,
          },
        },
      ]);
      return { booking, item, events };
    });

    if (created !== null) {
      await this.dispatcher.dispatch(tenant, created.events);
      return { created: true, booking: created.booking, item: created.item };
    }

    // Duplicate clientReference: hand back the original, never a second booking.
    const existing = await db
      .select()
      .from(bookings)
      .where(eq(bookings.clientReference, input.clientReference))
      .limit(1);
    const booking = existing[0];
    if (booking === undefined) {
      throw new BookingNotFoundError(input.clientReference);
    }
    const items = await db
      .select()
      .from(bookingItems)
      .where(eq(bookingItems.bookingId, booking.id))
      .limit(1);
    const item = items[0];
    if (item === undefined) {
      throw new BookingItemNotFoundError(`of booking ${booking.id}`);
    }
    return { created: false, booking, item };
  }

  /**
   * Executes one legal state transition atomically — see the module header
   * for the five steps. Throws IllegalTransitionError (no writes),
   * TransitionConflictError (rolled back), MissingPostingTemplateError /
   * MissingPenaltyResolutionError (rolled back).
   */
  async transition(
    tenant: TenantId,
    bookingItemId: string,
    to: BookingItemState,
    ctx: TransitionContext,
  ): Promise<TransitionResult> {
    const from = ctx.expectedFrom;
    // Steps that must refuse BEFORE any write: legality and template presence.
    assertTransition(from, to);
    requirePostingTemplate(transitionEdge(from, to));

    const db = await this.resolver.getTenantDb(tenant);
    const now = new Date();
    const outcome = await db.transaction(async (tx) => {
      const found = await tx
        .select()
        .from(bookingItems)
        .where(eq(bookingItems.id, bookingItemId))
        .limit(1);
      const item = found[0];
      if (item === undefined) {
        throw new BookingItemNotFoundError(bookingItemId);
      }
      if (item.state !== from) {
        throw new TransitionConflictError(bookingItemId, from, item.state);
      }

      // Optimistic concurrency: the WHERE clause is the arbiter. Under a
      // concurrent transition the second UPDATE re-evaluates against the
      // winner's committed state, matches nothing, and the whole transaction
      // rolls back with a typed conflict.
      const patch = ctx.patch ?? {};
      const updated = await tx
        .update(bookingItems)
        .set({
          state: to,
          updatedAt: now,
          ...(patch.supplierReference === undefined
            ? {}
            : { supplierReference: patch.supplierReference }),
          ...(patch.pendingSince === undefined ? {} : { pendingSince: patch.pendingSince }),
          ...(patch.nextPollAt === undefined ? {} : { nextPollAt: patch.nextPollAt }),
          ...(patch.cancellationRequestedAt === undefined
            ? {}
            : { cancellationRequestedAt: patch.cancellationRequestedAt }),
          // Leaving a polled wait: nothing is due any more.
          ...(to === "pending_confirmation" ? {} : { nextPollAt: patch.nextPollAt ?? null }),
        })
        .where(and(eq(bookingItems.id, bookingItemId), eq(bookingItems.state, from)))
        .returning({ id: bookingItems.id });
      if (updated.length !== 1) {
        throw new TransitionConflictError(bookingItemId, from, null);
      }

      const posted = await postTransitionEntries(
        tx,
        transitionEdge(from, to),
        { bookingId: item.bookingId, bookingItemId: item.id },
        {
          sell: { amount: Number(item.sellAmount), currency: item.currency },
          net: { amount: Number(item.netAmount), currency: item.currency },
          ...(ctx.penalty === undefined ? {} : { penalty: ctx.penalty }),
        },
        now,
      );

      await tx.insert(auditEvents).values({
        actorType: ctx.actor.actorType,
        actorId: ctx.actor.actorId,
        entityType: "booking_item",
        entityId: item.id,
        action: "booking_item.transition",
        before: { state: from, supplierReference: item.supplierReference },
        after: {
          state: to,
          reason: ctx.reason,
          supplierReference: patch.supplierReference ?? item.supplierReference,
          transactionGroupId: posted.transactionGroupId,
          ...(ctx.penalty === undefined || ctx.penalty === null
            ? {}
            : { penalty: { amount: ctx.penalty.amount, currency: ctx.penalty.currency } }),
          ...(ctx.details === undefined ? {} : { details: ctx.details }),
        },
      });

      const events = await insertOutboxEvents(tx, [
        {
          eventType: `booking_item.${to}`,
          bookingId: item.bookingId,
          bookingItemId: item.id,
          payload: {
            from,
            to,
            reason: ctx.reason,
            transactionGroupId: posted.transactionGroupId,
            ...(ctx.details === undefined ? {} : { details: ctx.details }),
          },
        },
      ]);

      return {
        bookingId: item.bookingId,
        bookingItemId: item.id,
        from,
        to,
        transactionGroupId: posted.transactionGroupId,
        journalEntryCount: posted.entryCount,
        events,
      };
    });

    await this.dispatcher.dispatch(tenant, outcome.events);
    return outcome;
  }

  /**
   * Records that a supplier ACCEPTED a cancellation that settles
   * asynchronously (e.g. TBO CancellationInProgress). NOT a state
   * transition — the item keeps its state; the worker polls until the
   * supplier reports cancelled and then transitions through `transition`.
   * Audited and evented like every state change.
   */
  async markCancellationRequested(
    tenant: TenantId,
    bookingItemId: string,
    actor: AuditActor,
    requestedAt: Date,
  ): Promise<void> {
    const db = await this.resolver.getTenantDb(tenant);
    const events = await db.transaction(async (tx) => {
      const updated = await tx
        .update(bookingItems)
        .set({
          cancellationRequestedAt: requestedAt,
          nextPollAt: requestedAt,
          updatedAt: requestedAt,
        })
        .where(
          and(
            eq(bookingItems.id, bookingItemId),
            eq(bookingItems.state, "confirmed"),
            isNull(bookingItems.cancellationRequestedAt),
          ),
        )
        .returning({ id: bookingItems.id, bookingId: bookingItems.bookingId });
      const row = updated[0];
      if (row === undefined) {
        throw new TransitionConflictError(bookingItemId, "confirmed", null);
      }
      await tx.insert(auditEvents).values({
        actorType: actor.actorType,
        actorId: actor.actorId,
        entityType: "booking_item",
        entityId: bookingItemId,
        action: "booking_item.cancellation_requested",
        before: { cancellationRequestedAt: null },
        after: { cancellationRequestedAt: requestedAt.toISOString() },
      });
      return insertOutboxEvents(tx, [
        {
          eventType: "booking_item.cancellation_requested",
          bookingId: row.bookingId,
          bookingItemId,
          payload: { requestedAt: requestedAt.toISOString() },
        },
      ]);
    });
    await this.dispatcher.dispatch(tenant, events);
  }

  /**
   * Escalates a stuck item to manual intervention: automation stops polling
   * it and it surfaces in the core-workspace queue (reads escalated_at /
   * escalation_reason and the outbox event). Idempotent: escalating an
   * already-escalated item is a no-op.
   */
  async escalate(
    tenant: TenantId,
    bookingItemId: string,
    actor: AuditActor,
    reason: string,
  ): Promise<boolean> {
    const db = await this.resolver.getTenantDb(tenant);
    const now = new Date();
    const events = await db.transaction(async (tx) => {
      const updated = await tx
        .update(bookingItems)
        .set({ escalatedAt: now, escalationReason: reason, updatedAt: now })
        .where(and(eq(bookingItems.id, bookingItemId), isNull(bookingItems.escalatedAt)))
        .returning({ id: bookingItems.id, bookingId: bookingItems.bookingId });
      const row = updated[0];
      if (row === undefined) {
        return null;
      }
      await tx.insert(auditEvents).values({
        actorType: actor.actorType,
        actorId: actor.actorId,
        entityType: "booking_item",
        entityId: bookingItemId,
        action: "booking_item.escalated",
        before: { escalatedAt: null },
        after: { escalatedAt: now.toISOString(), reason },
      });
      return insertOutboxEvents(tx, [
        {
          eventType: "booking_item.escalated",
          bookingId: row.bookingId,
          bookingItemId,
          payload: { reason, escalatedAt: now.toISOString() },
        },
      ]);
    });
    if (events === null) {
      return false;
    }
    await this.dispatcher.dispatch(tenant, events);
    return true;
  }

  /**
   * Worker poll bookkeeping — scheduling state only, deliberately WITHOUT an
   * audit event (a row per poll would drown the audit trail; polls change no
   * business state). Guarded so an item that transitioned or escalated
   * concurrently is left alone.
   */
  async recordPollAttempt(
    tenant: TenantId,
    bookingItemId: string,
    attempts: number,
    nextPollAt: Date,
  ): Promise<void> {
    const db = await this.resolver.getTenantDb(tenant);
    await db
      .update(bookingItems)
      .set({ pollAttempts: attempts, nextPollAt })
      .where(and(eq(bookingItems.id, bookingItemId), isNull(bookingItems.escalatedAt)));
  }
}

/** Read helper shared by the booking service and worker (never writes). */
export async function loadBookingWithItems(
  tx: TenantTx | Awaited<ReturnType<TenantDbResolver["getTenantDb"]>>,
  bookingId: string,
): Promise<{ booking: BookingRow; items: readonly BookingItemRow[] } | null> {
  const found = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  const booking = found[0];
  if (booking === undefined) {
    return null;
  }
  const items = await tx
    .select()
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, bookingId));
  return { booking, items };
}
