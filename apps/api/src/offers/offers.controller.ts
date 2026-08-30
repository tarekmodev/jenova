/**
 * Agency-realm offer endpoints (issue #65) behind the gateway chain:
 * tenant resolution → realm auth (@RequiresRealm default-deny) → rate limit.
 * The controller is a thin binding — verification, supplier calls and
 * persistence all live in the services; scope comes from the verified
 * request context, never from the body (CLAUDE.md rule 2).
 */

import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { LOCALES, type Money } from "@jenova/domain";
import { RequiresRealm } from "../gateway/decorators";
import { ApiHttpError } from "../gateway/errors";
import {
  getRequestContext,
  requireRealm,
  type RequestContextCarrier,
} from "../gateway/request-context";
import { OFFER_CHECK_SERVICE } from "./check.service";
import type { CheckOfferResult, OfferCheckService } from "./check.service";
import { toOfferHttpError } from "./errors";

const checkOfferBody = z.object({
  offerToken: z.string().min(8).max(2_048),
  locale: z.enum(LOCALES).optional(),
});

interface MoneyPayload {
  readonly amount: number;
  readonly currency: string;
}

type CheckOfferResponse =
  | {
      readonly status: "unchanged";
      readonly offerId: string;
      readonly offerToken: string;
      readonly sell: MoneyPayload;
      readonly expiresAt: string;
      readonly checkedAt: string;
    }
  | {
      readonly status: "price_changed";
      readonly oldSell: MoneyPayload;
      readonly newSell: MoneyPayload;
      readonly newOfferId: string;
      readonly newOfferToken: string;
      readonly newExpiresAt: string;
      readonly policyChanged: boolean;
    };

function moneyPayload(value: Money): MoneyPayload {
  return { amount: value.amount, currency: value.currency };
}

function toResponse(result: CheckOfferResult): CheckOfferResponse {
  if (result.status === "unchanged") {
    return {
      status: "unchanged",
      offerId: result.offerId,
      offerToken: result.offerToken,
      sell: moneyPayload(result.sell),
      expiresAt: result.expiresAt.toISOString(),
      checkedAt: result.checkedAt.toISOString(),
    };
  }
  return {
    status: "price_changed",
    oldSell: moneyPayload(result.oldSell),
    newSell: moneyPayload(result.newSell),
    newOfferId: result.newOfferId,
    newOfferToken: result.newOfferToken,
    newExpiresAt: result.newExpiresAt.toISOString(),
    policyChanged: result.policyChanged,
  };
}

const MONEY_SCHEMA = {
  type: "object",
  required: ["amount", "currency"],
  properties: {
    amount: { type: "integer", description: "Minor units (CLAUDE.md rule 6)" },
    currency: { type: "string", description: "ISO 4217" },
  },
};

@ApiTags("offers")
@Controller("offers")
export class OffersController {
  constructor(
    @Inject(OFFER_CHECK_SERVICE) private readonly checks: OfferCheckService,
  ) {}

  @Post("check")
  @HttpCode(HttpStatus.OK)
  @RequiresRealm("agency")
  @ApiOperation({
    summary: "Revalidate an offer against its supplier before booking",
    description:
      "Verifies the signed offer token (constant-time; tampered or foreign tokens are an opaque " +
      "offer_not_found, expiry is enforced against the server clock), calls the supplier's check, " +
      "and either opens the bookable window (status=unchanged — book with the returned offerToken) " +
      "or persists the supplier's new state as a NEW signed offer and returns the price delta " +
      "(status=price_changed — present newSell for re-approval; the old offer is invalidated).",
  })
  @ApiResponse({
    status: 200,
    description: "Check result — unchanged (bookable) or price_changed (re-approval needed).",
    schema: {
      oneOf: [
        {
          type: "object",
          required: ["status", "offerId", "offerToken", "sell", "expiresAt", "checkedAt"],
          properties: {
            status: { type: "string", enum: ["unchanged"] },
            offerId: { type: "string", format: "uuid" },
            offerToken: { type: "string" },
            sell: MONEY_SCHEMA,
            expiresAt: { type: "string", format: "date-time" },
            checkedAt: { type: "string", format: "date-time" },
          },
        },
        {
          type: "object",
          required: [
            "status",
            "oldSell",
            "newSell",
            "newOfferId",
            "newOfferToken",
            "newExpiresAt",
            "policyChanged",
          ],
          properties: {
            status: { type: "string", enum: ["price_changed"] },
            oldSell: MONEY_SCHEMA,
            newSell: MONEY_SCHEMA,
            newOfferId: { type: "string", format: "uuid" },
            newOfferToken: { type: "string" },
            newExpiresAt: { type: "string", format: "date-time" },
            policyChanged: { type: "boolean" },
          },
        },
      ],
    },
  })
  @ApiResponse({ status: 404, description: "Unknown, tampered or foreign offer token." })
  @ApiResponse({ status: 409, description: "Supplier rejected the exact rate (re-search)." })
  @ApiResponse({ status: 410, description: "Offer expired/withdrawn, or supplier sold out." })
  @ApiResponse({ status: 503, description: "No adapter deployed for this supplier." })
  async check(
    @Req() request: RequestContextCarrier,
    @Body() body: unknown,
  ): Promise<CheckOfferResponse> {
    const context = getRequestContext(request);
    if (context === null || context.tenant === null) {
      // The gateway chain populates both before any handler runs.
      throw ApiHttpError.internal("request context is missing its tenant");
    }
    const auth = requireRealm(context.auth, "agency");
    const parsed = checkOfferBody.safeParse(body);
    if (!parsed.success) {
      throw new ApiHttpError(
        "bad_request",
        "body must be { offerToken: string, locale?: \"ar\" | \"en\" }",
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      const result = await this.checks.checkOffer(context.tenant.tenantId, parsed.data.offerToken, {
        subTenantId: auth.principal.subTenantId,
        ...(parsed.data.locale === undefined ? {} : { locale: parsed.data.locale }),
      });
      return toResponse(result);
    } catch (error) {
      throw toOfferHttpError(error);
    }
  }
}
