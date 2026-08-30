/**
 * Voucher delivery consumer (issue #100): consumes `booking_item.confirmed`
 * outbox events — render voucher → email it — with durable bookkeeping in
 * `document_delivery`.
 *
 * DESIGN — own consumption cursor, not `published_at`: the outbox stamps
 * `published_at` for the in-process dispatch path, so a NEW consumer cannot
 * key off it without racing the api's post-commit dispatcher. Instead the
 * sweep anti-joins `booking_event` against `document_delivery`: the UNIQUE
 * `booking_event_id` claim makes consumption at-least-once with exactly-one
 * delivery row per event — two racing sweeps insert once, deliver once.
 *
 * Failures retry with exponential backoff on the row; a terminal failure
 * flips the row to `failed` AND escalates the booking item, so the miss
 * surfaces in the manual-intervention queue (escalated_at + outbox event)
 * that the core workspace reads.
 */

import { and, eq, isNull, lte } from "drizzle-orm";
import type { TenantId } from "@jenova/domain";
import {
  bookingEvents,
  bookingItems,
  documentDeliveries,
  type TenantDbResolver,
} from "@jenova/db";
import type { AuditActor, BookingTransitionRunner } from "@jenova/booking-engine";
import { buildVoucherEmail } from "./email";
import type { MailSender } from "./mail";
import type { DocumentsService } from "./documents-service";

const CONSUMED_EVENT_TYPE = "booking_item.confirmed";

const DELIVERY_ACTOR: AuditActor = {
  actorType: "system",
  actorId: "worker:document-delivery",
};

export interface VoucherDeliveryOptions {
  /** Attempts before the delivery is terminal (default 5). */
  readonly maxAttempts?: number;
  /** First-retry delay; doubles per attempt (default 60s). */
  readonly backoffBaseMs?: number;
  /** Rows claimed/processed per sweep pass (default 50). */
  readonly batchSize?: number;
  readonly now?: () => Date;
}

export interface VoucherDeliveryDeps {
  readonly resolver: TenantDbResolver;
  readonly documents: DocumentsService;
  readonly mail: MailSender;
  /** Escalation path into the manual-intervention queue. */
  readonly runner: BookingTransitionRunner;
}

export interface DeliveryReport {
  /** New confirmed events claimed into delivery rows this pass. */
  readonly claimed: number;
  readonly sent: number;
  /** Failures that will retry with backoff. */
  readonly retried: number;
  /** Terminal failures (escalated). */
  readonly failed: number;
}

export class VoucherDeliveryConsumer {
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly batchSize: number;
  private readonly now: () => Date;

  constructor(
    private readonly deps: VoucherDeliveryDeps,
    options: VoucherDeliveryOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.backoffBaseMs = options.backoffBaseMs ?? 60_000;
    this.batchSize = options.batchSize ?? 50;
    this.now = options.now ?? (() => new Date());
  }

  async sweepTenant(tenant: TenantId): Promise<DeliveryReport> {
    const claimed = await this.claimNewEvents(tenant);
    const { sent, retried, failed } = await this.processDue(tenant);
    return { claimed, sent, retried, failed };
  }

  /** Anti-join claim: one delivery row per confirmed event, exactly once. */
  private async claimNewEvents(tenant: TenantId): Promise<number> {
    const db = await this.deps.resolver.getTenantDb(tenant);
    const unclaimed = await db
      .select({
        eventId: bookingEvents.id,
        bookingItemId: bookingItems.id,
        guests: bookingItems.guests,
      })
      .from(bookingEvents)
      .innerJoin(bookingItems, eq(bookingEvents.bookingItemId, bookingItems.id))
      .leftJoin(documentDeliveries, eq(documentDeliveries.bookingEventId, bookingEvents.id))
      .where(and(eq(bookingEvents.eventType, CONSUMED_EVENT_TYPE), isNull(documentDeliveries.id)))
      .orderBy(bookingEvents.occurredAt)
      .limit(this.batchSize);

    let claimed = 0;
    const now = this.now();
    for (const event of unclaimed) {
      const recipient = event.guests?.holder.email ?? null;
      if (recipient === null || recipient.length === 0) {
        // Undeliverable from birth: record the terminal row and surface the
        // booking in the manual queue — silence is not an option on a
        // customer-facing document.
        const inserted = await db
          .insert(documentDeliveries)
          .values({
            bookingEventId: event.eventId,
            bookingItemId: event.bookingItemId,
            channel: "email",
            recipient: "",
            state: "failed",
            attempts: 0,
            lastError: "no recipient: booking item carries no guests snapshot / holder email",
          })
          .onConflictDoNothing({ target: documentDeliveries.bookingEventId })
          .returning({ id: documentDeliveries.id });
        if (inserted.length === 1) {
          await this.deps.runner.escalate(
            tenant,
            event.bookingItemId,
            DELIVERY_ACTOR,
            "voucher delivery impossible: no holder email on the booking item",
          );
        }
        continue;
      }
      const inserted = await db
        .insert(documentDeliveries)
        .values({
          bookingEventId: event.eventId,
          bookingItemId: event.bookingItemId,
          channel: "email",
          recipient,
          state: "pending",
          attempts: 0,
          nextAttemptAt: now,
        })
        .onConflictDoNothing({ target: documentDeliveries.bookingEventId })
        .returning({ id: documentDeliveries.id });
      claimed += inserted.length;
    }
    return claimed;
  }

  private async processDue(
    tenant: TenantId,
  ): Promise<{ sent: number; retried: number; failed: number }> {
    const db = await this.deps.resolver.getTenantDb(tenant);
    const now = this.now();
    const due = await db
      .select({
        id: documentDeliveries.id,
        bookingItemId: documentDeliveries.bookingItemId,
        recipient: documentDeliveries.recipient,
        attempts: documentDeliveries.attempts,
        bookingId: bookingItems.bookingId,
      })
      .from(documentDeliveries)
      .innerJoin(bookingItems, eq(documentDeliveries.bookingItemId, bookingItems.id))
      .where(
        and(eq(documentDeliveries.state, "pending"), lte(documentDeliveries.nextAttemptAt, now)),
      )
      .orderBy(documentDeliveries.nextAttemptAt)
      .limit(this.batchSize);

    let sent = 0;
    let retried = 0;
    let failed = 0;
    for (const delivery of due) {
      try {
        const rendered = await this.deps.documents.renderVoucher(tenant, delivery.bookingId);
        const email = buildVoucherEmail(rendered.data);
        await this.deps.mail.send({
          to: delivery.recipient,
          subject: email.subject,
          text: email.text,
          attachments: [
            {
              filename: email.attachmentFilename,
              contentType: "application/pdf",
              bytes: rendered.bytes,
            },
          ],
        });
        // Guarded settle: a racing sweep that already sent leaves this a
        // no-op — at-least-once consumption, at-most-one recorded send.
        await db
          .update(documentDeliveries)
          .set({
            state: "sent",
            documentId: rendered.document.id,
            sentAt: this.now(),
            updatedAt: this.now(),
          })
          .where(
            and(eq(documentDeliveries.id, delivery.id), eq(documentDeliveries.state, "pending")),
          );
        sent += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const attempts = delivery.attempts + 1;
        if (attempts >= this.maxAttempts) {
          await db
            .update(documentDeliveries)
            .set({
              state: "failed",
              attempts,
              lastError: message,
              nextAttemptAt: null,
              updatedAt: this.now(),
            })
            .where(
              and(eq(documentDeliveries.id, delivery.id), eq(documentDeliveries.state, "pending")),
            );
          await this.deps.runner.escalate(
            tenant,
            delivery.bookingItemId,
            DELIVERY_ACTOR,
            `voucher delivery failed terminally after ${String(attempts)} attempts: ${message}`,
          );
          failed += 1;
        } else {
          const delayMs = this.backoffBaseMs * 2 ** (attempts - 1);
          await db
            .update(documentDeliveries)
            .set({
              attempts,
              lastError: message,
              nextAttemptAt: new Date(this.now().getTime() + delayMs),
              updatedAt: this.now(),
            })
            .where(
              and(eq(documentDeliveries.id, delivery.id), eq(documentDeliveries.state, "pending")),
            );
          retried += 1;
        }
      }
    }
    return { sent, retried, failed };
  }
}
