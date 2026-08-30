/**
 * Agency-realm voucher re-download (issue #100): GET the bilingual voucher
 * PDF for a confirmed booking. Scope comes from the verified request
 * context — the booking is loaded through the SAME scoped read the booking
 * endpoints use, so another agency's booking stays an opaque 404.
 */

import {
  Controller,
  Get,
  HttpStatus,
  Inject,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { LOCALES, type Locale } from "@jenova/domain";
import { DocumentRenderError, VoucherDataError, type DocumentsService } from "@jenova/documents";
import { RequiresRealm } from "../gateway/decorators";
import { ApiHttpError } from "../gateway/errors";
import {
  getRequestContext,
  requireRealm,
  type RequestContextCarrier,
  type ResolvedTenant,
  type VerifiedSessionAuth,
} from "../gateway/request-context";
import { toBookingHttpError } from "../hotel-booking/errors";
import {
  HOTEL_BOOKING_SERVICE,
  type HotelBookingService,
} from "../hotel-booking/booking.service";
import { DOCUMENTS_SERVICE } from "./documents.tokens";

const bookingIdParam = z.string().uuid();
const localeParam = z.enum(LOCALES);

function toVoucherHttpError(error: unknown): ApiHttpError | null {
  if (error instanceof VoucherDataError) {
    switch (error.kind) {
      case "booking_not_found":
        return new ApiHttpError("booking_not_found", "unknown booking", HttpStatus.NOT_FOUND);
      case "voucher_not_available":
        return new ApiHttpError("voucher_not_available", error.message, HttpStatus.CONFLICT);
      case "voucher_data_incomplete":
        return new ApiHttpError(
          "voucher_data_incomplete",
          error.message,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
    }
  }
  if (error instanceof DocumentRenderError) {
    return ApiHttpError.internal("voucher rendering failed");
  }
  return null;
}

@ApiTags("documents")
@Controller("bookings")
export class VoucherController {
  constructor(
    @Inject(DOCUMENTS_SERVICE) private readonly documents: DocumentsService | null,
    @Inject(HOTEL_BOOKING_SERVICE) private readonly bookings: HotelBookingService,
  ) {}

  @Get(":bookingId/voucher")
  @RequiresRealm("agency")
  @ApiOperation({
    summary: "Download the bilingual voucher PDF for a confirmed booking",
    description:
      "Arabic-primary bilingual document (English mirror always included); `locale` selects " +
      "which language section leads. Served from the object store when already rendered, " +
      "otherwise rendered on demand (rendering is deterministic).",
  })
  @ApiResponse({ status: 200, description: "The voucher PDF." })
  @ApiResponse({ status: 404, description: "Unknown booking (or out of the caller's scope)." })
  @ApiResponse({ status: 409, description: "The booking has no voucher (not confirmed)." })
  @ApiResponse({ status: 503, description: "Documents are not configured on this deployment." })
  async voucher(
    @Req() request: RequestContextCarrier,
    @Param("bookingId") bookingId: string,
    @Query("locale") locale: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { tenant, auth } = this.scope(request);
    if (this.documents === null) {
      throw new ApiHttpError(
        "documents_unavailable",
        "document rendering is not configured on this deployment",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const id = bookingIdParam.safeParse(bookingId);
    if (!id.success) {
      throw new ApiHttpError("booking_not_found", "unknown booking", HttpStatus.NOT_FOUND);
    }
    let leading: Locale = "ar";
    if (locale !== undefined) {
      const parsed = localeParam.safeParse(locale);
      if (!parsed.success) {
        throw new ApiHttpError(
          "bad_request",
          `locale must be one of: ${LOCALES.join(", ")}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      leading = parsed.data;
    }
    try {
      // Scope gate first (opaque 404 outside the caller's agency) — the same
      // read every booking endpoint uses.
      await this.bookings.getBooking(tenant.tenantId, id.data, {
        subTenantId: auth.principal.subTenantId,
      });
      const voucher = await this.documents.voucherPdf(tenant.tenantId, id.data, leading);
      response.setHeader("Content-Type", "application/pdf");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="voucher-${id.data}.${leading}.pdf"`,
      );
      return new StreamableFile(voucher.bytes);
    } catch (error) {
      const mapped = toVoucherHttpError(error);
      if (mapped !== null) {
        throw mapped;
      }
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
}
