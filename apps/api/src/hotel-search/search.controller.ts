/**
 * Hotel search SSE endpoint (issue #60): POST /hotel-search under the
 * agency realm, streaming `text/event-stream` through the SAME gateway
 * chain as every JSON route (tenant resolution → realm auth → rate limit
 * — the chain completes before the stream opens, so nothing buffers it).
 *
 * Event order on the wire:
 *   search.started    → { searchId, supplierCodes }
 *   supplier.results  → per-supplier batch of offer summaries, each with a
 *                       SIGNED offer token (the only bookable thing, rule 8)
 *   supplier.failed   → { supplierCode, kind } — unified taxonomy (rule 4)
 *   search.completed  → { status: complete | budget_exhausted, counters }
 *   search.failed     → only when the orchestrator itself dies mid-stream
 *
 * Streaming mechanics: headers are flushed immediately, `Cache-Control:
 * no-cache, no-transform` + `X-Accel-Buffering: no` keep proxies from
 * buffering, and comment heartbeats (`: keep-alive`) flow while lanes are
 * pending so idle-connection timeouts never cut a slow search. Client
 * disconnect tears the orchestrator down (generator return).
 *
 * Errors BEFORE the stream opens (bad body, auth) use the standard error
 * envelope; once streaming, failures are events — a 200 with a
 * `search.failed` frame, never a half-written JSON envelope.
 */

import { Body, Controller, Inject, Post, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiProduces, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { LOCALES, type Money } from "@jenova/domain";
import { RequiresRealm } from "../gateway/decorators";
import { ApiHttpError } from "../gateway/errors";
import {
  getRequestContext,
  requireRealm,
  type RequestContextCarrier,
} from "../gateway/request-context";
import {
  HOTEL_SEARCH_SERVICE,
  type HotelSearchEvent,
  type HotelSearchRequest,
  type HotelOfferSummary,
  type HotelSearchService,
} from "./search.service";

/** Comment-frame heartbeat cadence while supplier lanes are pending. */
const HEARTBEAT_MS = 10_000;

const searchBody = z.object({
  target: z.union([
    z.object({
      kind: z.literal("properties"),
      canonicalPropertyIds: z.array(z.string().min(1).max(128)).min(1).max(100),
    }),
    z.object({
      kind: z.literal("location"),
      canonicalLocationId: z.string().min(1).max(128),
    }),
  ]),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rooms: z
    .array(
      z.object({
        adults: z.number().int().min(1).max(9),
        childAges: z.array(z.number().int().min(0).max(17)).max(6).default([]),
      }),
    )
    .min(1)
    .max(9),
  nationality: z.string().regex(/^[A-Z]{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  locale: z.enum(LOCALES).default("en"),
});

interface MoneyPayload {
  readonly amount: number;
  readonly currency: string;
}

function moneyPayload(value: Money): MoneyPayload {
  return { amount: value.amount, currency: value.currency };
}

function offerPayload(offer: HotelOfferSummary): Record<string, unknown> {
  return {
    offerId: offer.offerId,
    offerToken: offer.offerToken,
    expiresAt: offer.expiresAt.toISOString(),
    supplierCode: offer.supplierCode,
    canonicalPropertyId: offer.canonicalPropertyId,
    supplierRoomName: offer.supplierRoomName,
    boardBasis: offer.boardBasis,
    sell: moneyPayload(offer.sell),
    refundable: offer.refundable,
  };
}

/** One SSE frame: named event + single-line JSON data. */
function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function eventFrame(event: HotelSearchEvent): string {
  switch (event.type) {
    case "search.started":
      return frame("search.started", {
        searchId: event.searchId,
        supplierCodes: event.supplierCodes,
      });
    case "supplier.results":
      return frame("supplier.results", {
        searchId: event.searchId,
        supplierCode: event.supplierCode,
        offers: event.offers.map(offerPayload),
      });
    case "supplier.failed":
      return frame("supplier.failed", {
        searchId: event.searchId,
        supplierCode: event.supplierCode,
        kind: event.kind,
      });
    case "search.completed":
      return frame("search.completed", {
        searchId: event.searchId,
        status: event.status,
        suppliersQueried: event.suppliersQueried,
        suppliersSucceeded: event.suppliersSucceeded,
        suppliersFailed: event.suppliersFailed,
        offerCount: event.offerCount,
      });
  }
}

const MONEY_SCHEMA = {
  type: "object",
  required: ["amount", "currency"],
  properties: {
    amount: { type: "integer", description: "Minor units (CLAUDE.md rule 6)" },
    currency: { type: "string", description: "ISO 4217" },
  },
};

const OFFER_SUMMARY_SCHEMA = {
  type: "object",
  required: [
    "offerId",
    "offerToken",
    "expiresAt",
    "supplierCode",
    "canonicalPropertyId",
    "supplierRoomName",
    "boardBasis",
    "sell",
    "refundable",
  ],
  properties: {
    offerId: { type: "string", format: "uuid" },
    offerToken: {
      type: "string",
      description: "Signed short-lived offer token — the ONLY bookable thing; check it before booking.",
    },
    expiresAt: { type: "string", format: "date-time" },
    supplierCode: { type: "string" },
    canonicalPropertyId: { type: "string" },
    supplierRoomName: { type: "string" },
    boardBasis: { type: "string", enum: ["RO", "BB", "HB", "FB", "AI"] },
    sell: MONEY_SCHEMA,
    refundable: { type: "boolean" },
  },
};

@ApiTags("hotel-search")
@Controller("hotel-search")
export class HotelSearchController {
  constructor(
    @Inject(HOTEL_SEARCH_SERVICE) private readonly searches: HotelSearchService,
  ) {}

  @Post()
  @RequiresRealm("agency")
  @ApiOperation({
    summary: "Stream a hotel search across the tenant's enabled suppliers (SSE)",
    description:
      "Fans out to every enabled supplier account in parallel under a hard time budget and streams " +
      "results as suppliers respond, as Server-Sent Events. Swagger cannot execute SSE — consume with " +
      "an EventSource-style client. Frames, in order: `search.started` {searchId, supplierCodes}; " +
      "per supplier ONE of `supplier.results` {supplierCode, offers[]} (each offer carries a signed " +
      "offerToken — server-priced, the only bookable thing) or `supplier.failed` {supplierCode, kind} " +
      "(unified taxonomy: sold_out · price_changed · invalid_request · supplier_timeout · " +
      "supplier_rejected · auth_failed · rate_limited, plus supplier_unavailable when the supplier " +
      "could not be consulted at all); finally `search.completed` {status: complete|budget_exhausted, " +
      "counters} — budget_exhausted flags a partial result set. `search.failed` {reason} is emitted " +
      "only if the search itself dies mid-stream. Comment frames (`: keep-alive`) are heartbeats — " +
      "ignore them. Nationality is REQUIRED: GCC rates vary by it (CLAUDE.md rule 9).",
  })
  @ApiProduces("text/event-stream")
  @ApiResponse({
    status: 200,
    description:
      "SSE stream (text/event-stream). Data payloads per event are documented in this schema's properties.",
    schema: {
      type: "object",
      description: "NOT a JSON body — each property documents one SSE event's `data` payload.",
      properties: {
        "search.started": {
          type: "object",
          required: ["searchId", "supplierCodes"],
          properties: {
            searchId: { type: "string", format: "uuid" },
            supplierCodes: { type: "array", items: { type: "string" } },
          },
        },
        "supplier.results": {
          type: "object",
          required: ["searchId", "supplierCode", "offers"],
          properties: {
            searchId: { type: "string", format: "uuid" },
            supplierCode: { type: "string" },
            offers: { type: "array", items: OFFER_SUMMARY_SCHEMA },
          },
        },
        "supplier.failed": {
          type: "object",
          required: ["searchId", "supplierCode", "kind"],
          properties: {
            searchId: { type: "string", format: "uuid" },
            supplierCode: { type: "string" },
            kind: {
              type: "string",
              enum: [
                "sold_out",
                "price_changed",
                "invalid_request",
                "supplier_timeout",
                "supplier_rejected",
                "auth_failed",
                "rate_limited",
                "supplier_unavailable",
              ],
            },
          },
        },
        "search.completed": {
          type: "object",
          required: [
            "searchId",
            "status",
            "suppliersQueried",
            "suppliersSucceeded",
            "suppliersFailed",
            "offerCount",
          ],
          properties: {
            searchId: { type: "string", format: "uuid" },
            status: { type: "string", enum: ["complete", "budget_exhausted"] },
            suppliersQueried: { type: "integer" },
            suppliersSucceeded: { type: "integer" },
            suppliersFailed: { type: "integer" },
            offerCount: { type: "integer" },
          },
        },
        "search.failed": {
          type: "object",
          required: ["reason"],
          properties: { reason: { type: "string", enum: ["internal_error"] } },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: "Malformed search request (standard error envelope)." })
  @ApiResponse({ status: 401, description: "Missing/invalid agency session (standard error envelope)." })
  async search(
    @Req() request: RequestContextCarrier,
    @Body() rawBody: unknown,
    @Res() response: Response,
  ): Promise<void> {
    const context = getRequestContext(request);
    if (context === null || context.tenant === null) {
      // The gateway chain populates both before any handler runs.
      throw ApiHttpError.internal("request context is missing its tenant");
    }
    const auth = requireRealm(context.auth, "agency");
    const parsed = searchBody.safeParse(rawBody);
    if (!parsed.success) {
      throw new ApiHttpError(
        "bad_request",
        "body must be { target, checkIn, checkOut, rooms, nationality, currency, locale? }",
        400,
      );
    }
    const body = parsed.data;
    const searchRequest: HotelSearchRequest = {
      query: {
        target:
          body.target.kind === "properties"
            ? { kind: "properties", canonicalPropertyIds: body.target.canonicalPropertyIds }
            : { kind: "location", canonicalLocationId: body.target.canonicalLocationId },
        checkIn: body.checkIn,
        checkOut: body.checkOut,
        rooms: body.rooms,
      },
      nationality: body.nationality,
      currency: body.currency,
      locale: body.locale,
      subTenantId: auth.principal.subTenantId,
      channel: "b2b",
    };

    // Open the stream only once the request is fully validated — everything
    // before this line still gets the standard JSON error envelope.
    response.status(200);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    // Disable proxy response buffering (nginx and compatibles).
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();
    response.write(": connected\n\n");

    const heartbeat = setInterval(() => {
      if (!response.writableEnded) {
        response.write(": keep-alive\n\n");
      }
    }, HEARTBEAT_MS);

    const stream = this.searches.search(context.tenant.tenantId, searchRequest);
    let clientGone = false;
    const onClose = (): void => {
      clientGone = true;
      // Tear the orchestrator down; abandoned lanes abort at their deadline.
      void stream.return(undefined);
    };
    response.on("close", onClose);

    try {
      for await (const event of stream) {
        if (clientGone) {
          break;
        }
        response.write(eventFrame(event));
      }
    } catch {
      // Mid-stream orchestrator failure: the transport is already committed
      // to text/event-stream, so the failure is a frame, not an envelope.
      // No detail crosses the wire (same policy as the 500 envelope).
      if (!clientGone && !response.writableEnded) {
        response.write(frame("search.failed", { reason: "internal_error" }));
      }
    } finally {
      clearInterval(heartbeat);
      response.off("close", onClose);
      if (!response.writableEnded) {
        response.end();
      }
    }
  }
}
