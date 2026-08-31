/**
 * Core workspace — bookings (issue #92): the staff-side queue over ALL
 * bookings (docs/apps/core-workspace.md) and the full detail read:
 * items, per-item state history from AuditEvents, and the ledger postings
 * panel as a LEDGER READ (journalEntriesOfBooking — never recomputed,
 * CLAUDE.md rule 7). Documents links arrive with Documents v1 (separate
 * M2 workstream) — the field ships empty, shape stable.
 */

import { Controller, Get, Inject, Param, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { and, desc, eq, gte, inArray, lte, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { BOOKING_ITEM_STATES } from "@jenova/domain";
import { auditEvents, bookingItems, bookings, type TenantDbResolver } from "@jenova/db";
import { journalEntriesOfBooking, moneyAmountFrom } from "@jenova/booking-engine";
import { RequiresRealm } from "../gateway/decorators";
import { ApiHttpError } from "../gateway/errors";
import {
  getRequestContext,
  requireRealm,
  type RequestContextCarrier,
  type ResolvedTenant,
} from "../gateway/request-context";
import { TENANT_DB_RESOLVER } from "../tenancy/tenant-db.module";

const listQuery = z.object({
  state: z.enum(BOOKING_ITEM_STATES).optional(),
  supplier: z.string().min(1).max(64).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const bookingIdParam = z.string().uuid();

function moneyPayload(amount: bigint, currency: string, field: string): Record<string, unknown> {
  return { amount: moneyAmountFrom(amount, field), currency };
}

@ApiTags("staff-workspace")
@Controller("staff/bookings")
@RequiresRealm("tenant_staff")
export class StaffBookingsController {
  constructor(@Inject(TENANT_DB_RESOLVER) private readonly resolver: TenantDbResolver) {}

  @Get()
  @ApiOperation({
    summary: "Bookings queue — item-level rows across every surface",
    description:
      "Filters: state (booking-item state machine), supplier, travel-agnostic created date range " +
      "(from/to, UTC calendar dates), limit. Newest first.",
  })
  async list(
    @Req() request: RequestContextCarrier,
    @Query() rawQuery: unknown,
  ): Promise<Record<string, unknown>> {
    const tenant = this.tenant(request);
    const parsed = listQuery.safeParse(rawQuery);
    if (!parsed.success) {
      throw new ApiHttpError("bad_request", "invalid list filters", 400);
    }
    const query = parsed.data;
    const db = await this.resolver.getTenantDb(tenant.tenantId);

    const conditions: SQL[] = [];
    if (query.state !== undefined) conditions.push(eq(bookingItems.state, query.state));
    if (query.supplier !== undefined) conditions.push(eq(bookingItems.supplierCode, query.supplier));
    if (query.from !== undefined) {
      conditions.push(gte(bookingItems.createdAt, new Date(`${query.from}T00:00:00Z`)));
    }
    if (query.to !== undefined) {
      conditions.push(lte(bookingItems.createdAt, new Date(`${query.to}T23:59:59.999Z`)));
    }

    const rows = await db
      .select({
        bookingId: bookings.id,
        bookingItemId: bookingItems.id,
        clientReference: bookings.clientReference,
        channel: bookings.channel,
        state: bookingItems.state,
        supplierCode: bookingItems.supplierCode,
        supplierReference: bookingItems.supplierReference,
        sellAmount: bookingItems.sellAmount,
        currency: bookingItems.currency,
        escalatedAt: bookingItems.escalatedAt,
        createdAt: bookingItems.createdAt,
      })
      .from(bookingItems)
      .innerJoin(bookings, eq(bookingItems.bookingId, bookings.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(bookingItems.createdAt))
      .limit(query.limit);

    return {
      bookings: rows.map((row) => ({
        bookingId: row.bookingId,
        bookingItemId: row.bookingItemId,
        clientReference: row.clientReference,
        channel: row.channel,
        state: row.state,
        supplierCode: row.supplierCode,
        supplierReference: row.supplierReference,
        sell: moneyPayload(row.sellAmount, row.currency, "booking_item.sell_amount"),
        escalated: row.escalatedAt !== null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  @Get(":bookingId")
  @ApiOperation({
    summary: "Full booking detail: items, audit trail, ledger postings, documents",
  })
  async detail(
    @Req() request: RequestContextCarrier,
    @Param("bookingId") rawId: string,
  ): Promise<Record<string, unknown>> {
    const tenant = this.tenant(request);
    const parsedId = bookingIdParam.safeParse(rawId);
    if (!parsedId.success) {
      throw new ApiHttpError("booking_not_found", "unknown booking", 404);
    }
    const bookingId = parsedId.data;
    const db = await this.resolver.getTenantDb(tenant.tenantId);

    const bookingRows = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    const booking = bookingRows[0];
    if (booking === undefined) {
      throw new ApiHttpError("booking_not_found", "unknown booking", 404);
    }
    const items = await db
      .select()
      .from(bookingItems)
      .where(eq(bookingItems.bookingId, bookingId))
      .orderBy(bookingItems.createdAt);

    // Two-key audit read: the booking's own events + every item's events
    // (audit rows key on entity, not booking — rides audit_event_entity_ix).
    const itemIds = items.map((item) => item.id);
    const trail = await db
      .select()
      .from(auditEvents)
      .where(
        or(
          and(eq(auditEvents.entityType, "booking"), eq(auditEvents.entityId, bookingId)),
          itemIds.length > 0
            ? and(
                eq(auditEvents.entityType, "booking_item"),
                inArray(auditEvents.entityId, itemIds),
              )
            : undefined,
        ),
      )
      .orderBy(auditEvents.occurredAt, auditEvents.id);

    const ledger = await journalEntriesOfBooking(db, bookingId);

    return {
      booking: {
        bookingId: booking.id,
        clientReference: booking.clientReference,
        channel: booking.channel,
        agencyId: booking.agencyId,
        paymentState: booking.paymentState,
        total: moneyPayload(booking.totalAmount, booking.currency, "booking.total_amount"),
        createdAt: booking.createdAt.toISOString(),
      },
      items: items.map((item) => ({
        bookingItemId: item.id,
        vertical: item.vertical,
        state: item.state,
        supplierCode: item.supplierCode,
        supplierReference: item.supplierReference,
        net: moneyPayload(item.netAmount, item.currency, "booking_item.net_amount"),
        sell: moneyPayload(item.sellAmount, item.currency, "booking_item.sell_amount"),
        policySnapshot: item.policySnapshot,
        cancellationRequestedAt: item.cancellationRequestedAt?.toISOString() ?? null,
        escalated: item.escalatedAt !== null,
        escalationReason: item.escalationReason,
        createdAt: item.createdAt.toISOString(),
      })),
      auditTrail: trail.map((event) => ({
        id: String(event.id),
        actorType: event.actorType,
        actorId: event.actorId,
        entityType: event.entityType,
        entityId: event.entityId,
        action: event.action,
        before: event.before,
        after: event.after,
        occurredAt: event.occurredAt.toISOString(),
      })),
      ledger: ledger.map((line) => ({
        id: line.id,
        transactionGroupId: line.transactionGroupId,
        accountCode: line.accountCode,
        accountName: line.accountName,
        amount: moneyPayload(line.amount, line.currency, "journal_entry.amount"),
        bookingItemId: line.bookingItemId,
        memo: line.memo,
        postedAt: line.postedAt.toISOString(),
      })),
      // Documents v1 (bilingual voucher PDFs) is a parallel M2 workstream;
      // the field is stable and fills in when api/documents lands.
      documents: [],
    };
  }

  private tenant(request: RequestContextCarrier): ResolvedTenant {
    const context = getRequestContext(request);
    if (context === null || context.tenant === null) {
      throw ApiHttpError.internal("request context is missing its tenant");
    }
    requireRealm(context.auth, "tenant_staff");
    return context.tenant;
  }
}
