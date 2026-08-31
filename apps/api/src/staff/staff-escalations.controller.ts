/**
 * Core workspace — manual-intervention queue (issue #92): items automation
 * escalated (escalated_at/escalation_reason from the M1 poller). The only
 * actions offered are the ones the item's state allows (docs/apps/
 * core-workspace.md acceptance heuristic): retry_poll for supplier-wait
 * states with a reference, resolve always. Retry runs ONE forced poll
 * through the SAME poller/runner the worker uses — no second transition
 * path exists (booking-engine header contract).
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { asc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import type { TenantId } from "@jenova/domain";
import { bookingItems, bookings, type TenantDbResolver } from "@jenova/db";
import {
  BookingTransitionRunner,
  PendingConfirmationPoller,
  moneyAmountFrom,
  type AuditActor,
  type BookingItemRow,
  type RetrieveBookingFn,
} from "@jenova/booking-engine";
import type { AdapterCallContext } from "@jenova/supplier-sdk";
import {
  SUPPLIER_CREDENTIALS_SOURCE,
  SUPPLIER_REGISTRY,
  type SupplierCredentialsSource,
  type SupplierRegistry,
} from "@jenova/supplier-registry";
import { BOOKING_TRANSITION_RUNNER } from "../hotel-booking/booking.service";
import { RequiresRealm } from "../gateway/decorators";
import { ApiHttpError } from "../gateway/errors";
import {
  getRequestContext,
  requireRealm,
  type RequestContextCarrier,
  type ResolvedTenant,
  type VerifiedSessionAuth,
} from "../gateway/request-context";
import { TENANT_DB_RESOLVER } from "../tenancy/tenant-db.module";

const itemIdParam = z.string().uuid();
const resolveBody = z.object({ note: z.string().min(1).max(500) });

/** One manual retrieve hop — bounded like the worker's. */
const RETRIEVE_DEADLINE_MS = 25_000;

export type EscalationAction = "retry_poll" | "resolve";

/** The state machine decides what a human may do — never the UI. */
export function allowedEscalationActions(
  item: Pick<BookingItemRow, "state" | "supplierReference" | "cancellationRequestedAt">,
): readonly EscalationAction[] {
  const retryable =
    item.supplierReference !== null &&
    (item.state === "pending_confirmation" ||
      (item.state === "confirmed" && item.cancellationRequestedAt !== null));
  return retryable ? ["retry_poll", "resolve"] : ["resolve"];
}

@ApiTags("staff-workspace")
@Controller("staff/escalations")
@RequiresRealm("tenant_staff")
export class StaffEscalationsController {
  constructor(
    @Inject(TENANT_DB_RESOLVER) private readonly resolver: TenantDbResolver,
    @Inject(BOOKING_TRANSITION_RUNNER) private readonly runner: BookingTransitionRunner,
    @Inject(SUPPLIER_REGISTRY) private readonly registry: SupplierRegistry,
    @Inject(SUPPLIER_CREDENTIALS_SOURCE) private readonly credentials: SupplierCredentialsSource,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Manual-intervention queue: escalated items with reason, age and legal actions",
  })
  async list(@Req() request: RequestContextCarrier): Promise<Record<string, unknown>> {
    const { tenant } = this.scope(request);
    const db = await this.resolver.getTenantDb(tenant.tenantId);
    const rows = await db
      .select({ item: bookingItems, clientReference: bookings.clientReference })
      .from(bookingItems)
      .innerJoin(bookings, eq(bookingItems.bookingId, bookings.id))
      .where(isNotNull(bookingItems.escalatedAt))
      .orderBy(asc(bookingItems.escalatedAt));
    return {
      escalations: rows.map(({ item, clientReference }) => ({
        bookingId: item.bookingId,
        bookingItemId: item.id,
        clientReference,
        state: item.state,
        supplierCode: item.supplierCode,
        supplierReference: item.supplierReference,
        sell: {
          amount: moneyAmountFrom(item.sellAmount, "booking_item.sell_amount"),
          currency: item.currency,
        },
        reason: item.escalationReason,
        escalatedAt: item.escalatedAt?.toISOString() ?? null,
        allowedActions: allowedEscalationActions(item),
      })),
    };
  }

  @Post(":itemId/retry-poll")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Run ONE forced supplier poll for an escalated item",
    description:
      "Retrieves at the supplier and settles through the state-machine runner exactly like the " +
      "worker's sweep; a still-pending answer never re-escalates. When the retry settles the item " +
      "(confirmed/cancelled/failed) the escalation auto-resolves.",
  })
  async retryPoll(
    @Req() request: RequestContextCarrier,
    @Param("itemId") rawId: string,
  ): Promise<Record<string, unknown>> {
    const { tenant, auth } = this.scope(request);
    const item = await this.escalatedItem(tenant.tenantId, rawId);
    if (!allowedEscalationActions(item).includes("retry_poll")) {
      throw new ApiHttpError(
        "action_not_allowed",
        "the item's state does not allow a supplier poll",
        HttpStatus.CONFLICT,
      );
    }
    const poller = new PendingConfirmationPoller(this.resolver, this.runner, this.retrieveFn());
    const outcome = await poller.pollItem(tenant.tenantId, item, { force: true });

    let resolved = false;
    if (
      outcome.outcome === "transitioned_confirmed" ||
      outcome.outcome === "transitioned_cancelled" ||
      outcome.outcome === "transitioned_failed"
    ) {
      resolved = await this.runner.resolveEscalation(
        tenant.tenantId,
        item.id,
        this.actor(auth),
        `manual retry settled the item (${outcome.outcome})`,
      );
    }
    return {
      outcome: outcome.outcome,
      ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
      resolved,
    };
  }

  @Post(":itemId/resolve")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Mark an escalation resolved (a human dealt with it)",
  })
  async resolve(
    @Req() request: RequestContextCarrier,
    @Param("itemId") rawId: string,
    @Body() rawBody: unknown,
  ): Promise<Record<string, unknown>> {
    const { tenant, auth } = this.scope(request);
    const item = await this.escalatedItem(tenant.tenantId, rawId);
    const parsed = resolveBody.safeParse(rawBody);
    if (!parsed.success) {
      throw new ApiHttpError("bad_request", "body must be { note: string }", HttpStatus.BAD_REQUEST);
    }
    const resolved = await this.runner.resolveEscalation(
      tenant.tenantId,
      item.id,
      this.actor(auth),
      parsed.data.note,
    );
    if (!resolved) {
      // Concurrent resolution won — same terminal outcome for the caller.
      throw new ApiHttpError("not_escalated", "the item is no longer escalated", HttpStatus.CONFLICT);
    }
    return { ok: true };
  }

  /** Same composition the worker sweeps with (apps never import adapters). */
  private retrieveFn(): RetrieveBookingFn {
    return async (tenant, target) => {
      const adapter = this.registry.hotelAdapter(target.supplierCode);
      if (adapter === null) {
        throw new Error(`no adapter deployed for supplier ${target.supplierCode}`);
      }
      const ctx: AdapterCallContext = {
        credentials: await this.credentials.credentialsFor(tenant, target.supplierCode),
        deadline: new Date(Date.now() + RETRIEVE_DEADLINE_MS),
        // Retrieval addresses an existing reservation; currency echoes the
        // item's own — no constants on a money path.
        nationality: "SA",
        currency: target.currency,
        locale: "en",
      };
      return adapter.retrieve(ctx, target.supplierBookingReference);
    };
  }

  private actor(auth: VerifiedSessionAuth<"tenant_staff">): AuditActor {
    return { actorType: "staff_user", actorId: auth.principal.userId };
  }

  private async escalatedItem(tenant: TenantId, rawId: string): Promise<BookingItemRow> {
    const parsed = itemIdParam.safeParse(rawId);
    if (!parsed.success) {
      throw new ApiHttpError("escalation_not_found", "unknown escalated item", HttpStatus.NOT_FOUND);
    }
    const db = await this.resolver.getTenantDb(tenant);
    const rows = await db
      .select()
      .from(bookingItems)
      .where(eq(bookingItems.id, parsed.data))
      .limit(1);
    const item = rows[0];
    if (item === undefined || item.escalatedAt === null) {
      throw new ApiHttpError("escalation_not_found", "unknown escalated item", HttpStatus.NOT_FOUND);
    }
    return item;
  }

  private scope(request: RequestContextCarrier): {
    tenant: ResolvedTenant;
    auth: VerifiedSessionAuth<"tenant_staff">;
  } {
    const context = getRequestContext(request);
    if (context === null || context.tenant === null) {
      throw ApiHttpError.internal("request context is missing its tenant");
    }
    return { tenant: context.tenant, auth: requireRealm(context.auth, "tenant_staff") };
  }
}
