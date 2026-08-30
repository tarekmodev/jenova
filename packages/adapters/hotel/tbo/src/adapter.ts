/**
 * TBO Holidays hotel adapter — implements the HotelSupplierAdapter lifecycle
 * over the TBO HotelAPI (docs/05-suppliers.md #1 on the roadmap).
 *
 * Lifecycle mapping: search → PreBook(check) → Book → BookingDetail(retrieve)
 * → Cancel. Normalization is this package's whole job: canonical Money,
 * UTC cancellation deadlines, board basis, and the unified error taxonomy —
 * no TBO shape crosses this boundary (CLAUDE.md rule 4).
 */

import type {
  HotelBookingRecord,
  HotelOffer,
  HotelSupplierAdapter,
  Transport,
} from "@jenova/supplier-sdk";
import { TBO_SUPPLIER_CODE, TboClient } from "./client";

export interface TboHotelAdapterOptions {
  /** The wired transport seam (createTboTransport: live, record or replay). */
  readonly transport: Transport;
}

class TboHotelAdapter implements HotelSupplierAdapter {
  readonly supplierCode = TBO_SUPPLIER_CODE;
  readonly vertical = "hotel" as const;
  readonly client: TboClient;

  constructor(options: TboHotelAdapterOptions) {
    this.client = new TboClient(options.transport);
  }

  // Lifecycle mapping lands per sub-issue: search with M1.a2 (#55);
  // check/book/retrieve/cancel with M1.a3 (#56).
  search(): Promise<readonly HotelOffer[]> {
    return Promise.reject(new Error("TBO search mapping lands with M1.a2 (#55)"));
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
