/**
 * TBO Holidays hotel adapter — implements the HotelSupplierAdapter lifecycle
 * over the TBO HotelAPI (docs/05-suppliers.md #1 on the roadmap).
 *
 * Lifecycle mapping: search → PreBook(check) → Book → BookingDetail(retrieve)
 * → Cancel. Normalization is this package's whole job: canonical Money,
 * UTC cancellation deadlines, board basis, and the unified error taxonomy —
 * no TBO shape crosses this boundary (CLAUDE.md rule 4).
 */

import { SupplierError } from "@jenova/domain";
import {
  parseJsonWith,
  type AdapterCallContext,
  type HotelBookingRecord,
  type HotelOffer,
  type HotelSearchQuery,
  type HotelSupplierAdapter,
  type Transport,
  type TransportResponse,
} from "@jenova/supplier-sdk";
import { TBO_SUPPLIER_CODE, TboClient } from "./client";
import {
  supplierErrorFromHttp,
  supplierErrorFromStatus,
  TBO_STATUS_NO_ROOMS,
  TBO_STATUS_OK,
} from "./errors";
import { mapRoomToOffer, toTboHotelCode } from "./mapping";
import { tboSearchResponseSchema } from "./schemas";

export interface TboHotelAdapterOptions {
  /** The wired transport seam (createTboTransport: live, record or replay). */
  readonly transport: Transport;
}

/**
 * TBO caps its own search processing time via the ResponseTime request field
 * (seconds). Fixed at TBO's documented maximum — the caller's real budget is
 * ctx.deadline, which the transport enforces by aborting.
 */
const TBO_SEARCH_RESPONSE_TIME_SECONDS = 23.0;

function assertHttpOk(response: TransportResponse, operation: string): void {
  if (response.status < 200 || response.status >= 300) {
    throw supplierErrorFromHttp(response, operation);
  }
}

class TboHotelAdapter implements HotelSupplierAdapter {
  readonly supplierCode = TBO_SUPPLIER_CODE;
  readonly vertical = "hotel" as const;
  readonly client: TboClient;

  constructor(options: TboHotelAdapterOptions) {
    this.client = new TboClient(options.transport);
  }

  async search(
    ctx: AdapterCallContext,
    query: HotelSearchQuery,
  ): Promise<readonly HotelOffer[]> {
    if (query.target.kind !== "properties") {
      // TBO searches by hotel codes; canonical-location fan-out arrives with
      // the M3 mapping service (docs/05-suppliers.md, "Hotel content mapping").
      throw new SupplierError(
        "invalid_request",
        "TBO search requires canonical property ids (location search lands with the M3 mapping service)",
      );
    }
    const payload = {
      CheckIn: query.checkIn,
      CheckOut: query.checkOut,
      HotelCodes: query.target.canonicalPropertyIds.map(toTboHotelCode).join(","),
      GuestNationality: ctx.nationality,
      PaxRooms: query.rooms.map((room) => ({
        Adults: room.adults,
        Children: room.childAges.length,
        ChildrenAges: [...room.childAges],
      })),
      ResponseTime: TBO_SEARCH_RESPONSE_TIME_SECONDS,
      IsDetailedResponse: true,
    };
    const response = await this.client.call(ctx, "search", payload);
    assertHttpOk(response, "search");
    const body = parseJsonWith(tboSearchResponseSchema, response.body, {
      supplierCode: TBO_SUPPLIER_CODE,
    });
    if (body.Status.Code === TBO_STATUS_NO_ROOMS) {
      // "No Available rooms for given criteria": an empty result for a broad
      // search — sold_out is reserved for a specific rate dying (check/book).
      return [];
    }
    if (body.Status.Code !== TBO_STATUS_OK) {
      throw supplierErrorFromStatus(body.Status, "search");
    }
    const offers: HotelOffer[] = [];
    for (const hotel of body.HotelResult ?? []) {
      for (const room of hotel.Rooms) {
        const offer = mapRoomToOffer(room, hotel.HotelCode, hotel.Currency, ctx.nationality);
        if (offer !== undefined) {
          offers.push(offer);
        }
      }
    }
    return offers;
  }

  check(): Promise<HotelOffer> {
    return Promise.reject(new Error("TBO check mapping lands with M1.a3 (#56)"));
  }

  book(): Promise<HotelBookingRecord> {
    return Promise.reject(new Error("TBO book mapping lands with M1.a3 (#56)"));
  }

  retrieve(): Promise<HotelBookingRecord> {
    return Promise.reject(new Error("TBO retrieve mapping lands with M1.a3 (#56)"));
  }

  cancel(): Promise<HotelBookingRecord> {
    return Promise.reject(new Error("TBO cancel mapping lands with M1.a3 (#56)"));
  }
}

export function createTboHotelAdapter(options: TboHotelAdapterOptions): HotelSupplierAdapter {
  return new TboHotelAdapter(options);
}
