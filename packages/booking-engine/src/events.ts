/**
 * Outbox-light domain events (issue #66).
 *
 * DECISION — events table over a bare post-commit hook: the runner INSERTs
 * every event into `booking_event` inside the SAME transaction that moves
 * state, posts the ledger and appends the AuditEvent, then the dispatcher
 * publishes AFTER commit and stamps `published_at`. Why the table:
 *
 * - Durability on the money path: a crash between commit and emit loses a
 *   hook's event forever; an unpublished row survives and the worker sweep
 *   re-dispatches it (at-least-once — consumers must be idempotent, which
 *   webhooks/notifications must be anyway).
 * - Observability: "what was emitted for this booking" is a query, exactly
 *   like the audit trail.
 * - The full broker is not paid for: M1 consumers are in-process; when
 *   webhooks/connectors land (M4+) they subscribe to the sink seam without
 *   touching the runner.
 */

import { and, eq, isNull, lte } from "drizzle-orm";
import type { TenantId } from "@jenova/domain";
import { bookingEvents, type TenantDbResolver } from "@jenova/db";
import type { TenantTx } from "./tx";

export interface BookingDomainEvent {
  /** booking_event row id. */
  readonly id: string;
  readonly eventType: string;
  readonly bookingId: string;
  readonly bookingItemId: string | null;
  readonly payload: Record<string, unknown>;
  readonly occurredAt: Date;
}

export interface NewDomainEvent {
  readonly eventType: string;
  readonly bookingId: string;
  readonly bookingItemId: string | null;
  readonly payload: Record<string, unknown>;
}

/** Inserts events into the outbox WITHIN the runner's transaction. */
export async function insertOutboxEvents(
  tx: TenantTx,
  events: readonly NewDomainEvent[],
): Promise<readonly BookingDomainEvent[]> {
  if (events.length === 0) return [];
  const rows = await tx
    .insert(bookingEvents)
    .values(events.map((event) => ({ ...event })))
    .returning({
      id: bookingEvents.id,
      eventType: bookingEvents.eventType,
      bookingId: bookingEvents.bookingId,
      bookingItemId: bookingEvents.bookingItemId,
      payload: bookingEvents.payload,
      occurredAt: bookingEvents.occurredAt,
    });
  return rows;
}

/**
 * Where published events go. M1 in-process consumers (and tests) implement
 * this; webhooks/notifications/connector sync subscribe here from M4.
 * Publish failures MUST throw — the dispatcher then leaves the row
 * unpublished for redelivery.
 */
export interface DomainEventSink {
  publish(tenant: TenantId, event: BookingDomainEvent): Promise<void>;
}

/** Default sink until real consumers exist: accept and forget (rows still stamp). */
export class NoopEventSink implements DomainEventSink {
  publish(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Publishes committed outbox rows and stamps `published_at`. Dispatch
 * failures are contained: the transition that produced the events has
 * already committed and MUST NOT be failed retroactively — unpublished rows
 * simply wait for the next sweep.
 */
export class OutboxDispatcher {
  constructor(
    private readonly resolver: TenantDbResolver,
    private readonly sink: DomainEventSink,
  ) {}

  /** Post-commit dispatch of the events one transition just produced. */
  async dispatch(tenant: TenantId, events: readonly BookingDomainEvent[]): Promise<void> {
    const db = await this.resolver.getTenantDb(tenant);
    for (const event of events) {
      try {
        await this.sink.publish(tenant, event);
      } catch {
        continue; // stays unpublished; the sweep redelivers
      }
      await db
        .update(bookingEvents)
        .set({ publishedAt: new Date() })
        .where(and(eq(bookingEvents.id, event.id), isNull(bookingEvents.publishedAt)));
    }
  }

  /**
   * Redelivery sweep (worker): publish every unpublished event older than
   * `olderThan`. The age guard keeps the sweep from racing the in-line
   * post-commit dispatch of a transition that JUST committed.
   */
  async republishUnpublished(
    tenant: TenantId,
    olderThan: Date,
    limit = 100,
  ): Promise<number> {
    const db = await this.resolver.getTenantDb(tenant);
    const rows = await db
      .select({
        id: bookingEvents.id,
        eventType: bookingEvents.eventType,
        bookingId: bookingEvents.bookingId,
        bookingItemId: bookingEvents.bookingItemId,
        payload: bookingEvents.payload,
        occurredAt: bookingEvents.occurredAt,
      })
      .from(bookingEvents)
      .where(and(isNull(bookingEvents.publishedAt), lte(bookingEvents.occurredAt, olderThan)))
      .orderBy(bookingEvents.occurredAt)
      .limit(limit);
    await this.dispatch(tenant, rows);
    return rows.length;
  }
}
