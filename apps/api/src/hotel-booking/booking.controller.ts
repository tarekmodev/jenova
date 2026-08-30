/**
 * Agency-realm booking endpoints (issue #67) behind the gateway chain.
 * Thin binding only: verification, supplier calls, transitions and
 * persistence live in the services; scope comes from the verified request
 * context, never from the body (CLAUDE.md rule 2).
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { moneyAmountFrom } from "@jenova/booking-engine";
import { LOCALES, type Money } from "@jenova/domain";
import { RequiresRealm } from "../gateway/decorators";
import { ApiHttpError } from "../gateway/errors";
import {
  getRequestContext,
  requireRealm,
  type RequestContextCarrier,
  type ResolvedTenant,
  type VerifiedSessionAuth,
} from "../gateway/request-context";
import { toBookingHttpError } from "./errors";
import {
  HOTEL_BOOKING_SERVICE,
  type BookingListEntry,
  type CancelBookingResult,
  type CancellationPreview,
  type HotelBookingService,
} from "./booking.service";

const guestSchema = z.object({
  firstName: z.string().min(1).max(64),
  lastName: z.string().min(1).max(64),
  age: z.number().int().min(0).max(17).optional(),
});

const bookBody = z.object({
  offerToken: z.string().min(8).max(2_048),
  clientReference: z.string().min(1).max(64),
  holder: z.object({
    firstName: z.string().min(1).max(64),
    lastName: z.string().min(1).max(64),
    email: z.string().email().max(254),
    phone: z.string().min(5).max(32),
  }),
  rooms: z.array(z.object({ guests: z.array(guestSchema).min(1).max(9) })).min(1).max(9),
  locale: z.enum(LOCALES).optional(),
});

const bookingIdParam = z.string().uuid();

interface MoneyPayload {
  readonly amount: number;
  readonly currency: string;
}

function moneyPayload(value: Money): MoneyPayload {
  return { amount: value.amount, currency: value.currency };
}

function previewPayload(preview: CancellationPreview) {
  return {
    penalty: moneyPayload(preview.penalty),
    refund: preview.refund === null ? null : moneyPayload(preview.refund),
    refundable: preview.refundable,
    asOf: preview.asOf.toISOString(),
  };
}

function listPayload(row: BookingListEntry) {
  return {
    bookingId: row.bookingId,
    clientReference: row.clientReference,
    createdAt: row.createdAt.toISOString(),
    state: row.state,
    supplierCode: row.supplierCode,
    supplierReference: row.supplierReference,
    sell: moneyPayload(row.sell),
    escalated: row.escalated,
    cancellationRequestedAt: row.cancellationRequestedAt?.toISOString() ?? null,
  };
}

function cancelPayload(result: CancelBookingResult) {
  return {
    bookingId: result.bookingId,
    bookingItemId: result.bookingItemId,
    status: result.status,
    state: result.state,
    preview: previewPayload(result.preview),
  };
}

@ApiTags("bookings")
@Controller("bookings")
export class HotelBookingController {
  constructor(
    @Inject(HOTEL_BOOKING_SERVICE) private readonly service: HotelBookingService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequiresRealm("agency")
  @ApiOperation({
    summary: "Book a checked hotel offer",
    description:
      "Books through the signed-offer gate: the token must be verified, unexpired and " +
      "recently checked. clientReference is the idempotency key — retrying with the same " +
      "value returns the original booking (idempotentReplay: true) and can never double-book. " +
      "Result state: confirmed, pending_confirmation (worker polls the supplier), or failed.",
  })
  @ApiResponse({ status: 201, description: "Booking created (or idempotently replayed)." })
  @ApiResponse({ status: 404, description: "Unknown, tampered or foreign offer token." })
  @ApiResponse({ status: 409, description: "Offer not checked / check gone stale." })
  @ApiResponse({ status: 410, description: "Offer expired/withdrawn, or supplier sold out." })
  async book(@Req() request: RequestContextCarrier, @Body() body: unknown) {
    const { tenant, auth } = this.scope(request);
    const parsed = bookBody.safeParse(body);
    if (!parsed.success) {
      throw new ApiHttpError(
        "bad_request",
        "body must be { offerToken, clientReference, holder, rooms[{guests}], locale? }",
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      const result = await this.service.bookHotel(tenant.tenantId, {
        offerToken: parsed.data.offerToken,
        clientReference: parsed.data.clientReference,
        holder: parsed.data.holder,
        rooms: parsed.data.rooms.map((room) => ({
          guests: room.guests.map((guest) => ({
            firstName: guest.firstName,
            lastName: guest.lastName,
            ...(guest.age === undefined ? {} : { age: guest.age }),
          })),
        })),
        channel: "b2b",
        subTenantId: auth.principal.subTenantId,
        actor: { actorType: "agency_user", actorId: auth.principal.userId },
        ...(parsed.data.locale === undefined ? {} : { locale: parsed.data.locale }),
      });
      return {
        bookingId: result.bookingId,
        bookingItemId: result.bookingItemId,
        clientReference: result.clientReference,
        state: result.state,
        supplierReference: result.supplierReference,
        sell: moneyPayload(result.sell),
        idempotentReplay: result.idempotentReplay,
      };
    } catch (error) {
      throw toBookingHttpError(error);
    }
  }

  @Get()
  @RequiresRealm("agency")
  @ApiOperation({
    summary: "List the calling agency's bookings (newest first)",
    description:
      "Operational list for the Agent Portal (issue #98): persisted booking + item state and " +
      "sell amounts only. Financial reports remain ledger reads.",
  })
  async list(@Req() request: RequestContextCarrier) {
    const { tenant, auth } = this.scope(request);
    try {
      const rows = await this.service.listBookings(tenant.tenantId, {
        subTenantId: auth.principal.subTenantId,
      });
      return { bookings: rows.map((row) => listPayload(row)) };
    } catch (error) {
      throw toBookingHttpError(error);
    }
  }

  @Get(":bookingId")
  @RequiresRealm("agency")
  @ApiOperation({ summary: "Read one booking (scoped to the calling agency)" })
  async get(@Req() request: RequestContextCarrier, @Param("bookingId") bookingId: string) {
    const { tenant, auth } = this.scope(request);
    const id = this.parseId(bookingId);
    try {
      const scope = { subTenantId: auth.principal.subTenantId };
      const { booking, item } = await this.service.getBooking(tenant.tenantId, id, scope);
      const history = await this.service.getBookingHistory(tenant.tenantId, id, scope);
      return {
        bookingId: booking.id,
        clientReference: booking.clientReference,
        channel: booking.channel,
        paymentState: booking.paymentState,
        createdAt: booking.createdAt.toISOString(),
        item: {
          bookingItemId: item.id,
          state: item.state,
          supplierCode: item.supplierCode,
          supplierReference: item.supplierReference,
          sell: { amount: moneyAmountFrom(item.sellAmount, "sell_amount"), currency: item.currency },
          cancellationRequestedAt: item.cancellationRequestedAt?.toISOString() ?? null,
          escalated: item.escalatedAt !== null,
          // The stored normalized snapshot — what the fee preview resolves
          // against; display data for the portal's policy timeline (#98).
          policy: item.policySnapshot,
        },
        history: history.map((entry) => ({
          action: entry.action,
          fromState: entry.fromState,
          toState: entry.toState,
          occurredAt: entry.occurredAt.toISOString(),
        })),
      };
    } catch (error) {
      throw toBookingHttpError(error);
    }
  }

  @Get(":bookingId/cancellation-preview")
  @RequiresRealm("agency")
  @ApiOperation({
    summary: "Preview the cancellation fee from the stored policy — no supplier call",
  })
  async preview(@Req() request: RequestContextCarrier, @Param("bookingId") bookingId: string) {
    const { tenant, auth } = this.scope(request);
    const id = this.parseId(bookingId);
    try {
      const preview = await this.service.previewCancellation(tenant.tenantId, id, {
        subTenantId: auth.principal.subTenantId,
        actor: { actorType: "agency_user", actorId: auth.principal.userId },
      });
      return previewPayload(preview);
    } catch (error) {
      throw toBookingHttpError(error);
    }
  }

  @Post(":bookingId/cancel")
  @HttpCode(HttpStatus.OK)
  @RequiresRealm("agency")
  @ApiOperation({
    summary: "Cancel a booking",
    description:
      "The fee is previewed from the stored normalized policy before execution and returned " +
      "with the result. Suppliers that cancel asynchronously return status " +
      "cancellation_pending; the worker settles the item to cancelled when the supplier " +
      "reports it, posting the penalty quoted at request time.",
  })
  async cancel(@Req() request: RequestContextCarrier, @Param("bookingId") bookingId: string) {
    const { tenant, auth } = this.scope(request);
    const id = this.parseId(bookingId);
    try {
      const result = await this.service.cancelBooking(tenant.tenantId, id, {
        subTenantId: auth.principal.subTenantId,
        actor: { actorType: "agency_user", actorId: auth.principal.userId },
      });
      return cancelPayload(result);
    } catch (error) {
      throw toBookingHttpError(error);
    }
  }

  private scope(request: RequestContextCarrier): {
    tenant: ResolvedTenant;
    auth: VerifiedSessionAuth<"agency">;
  } {
    const context = getRequestContext(request);
    if (context === null || context.tenant === null) {
      throw ApiHttpError.internal("request context is missing its tenant");
    }
    return { tenant: context.tenant, auth: requireRealm(context.auth, "agency") };
  }

  private parseId(raw: string): string {
    const parsed = bookingIdParam.safeParse(raw);
    if (!parsed.success) {
      throw new ApiHttpError("booking_not_found", "unknown booking", HttpStatus.NOT_FOUND);
    }
    return parsed.data;
  }
}
