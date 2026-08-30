/**
 * TBO Holidays HotelAPI HTTP client: endpoint map + per-call Basic auth over
 * the injected supplier-sdk Transport. Every call flows through that seam —
 * live (UndiciTransport), recording (sandbox-replay recorder) and CI replay
 * differ only by which Transport is injected (docs/09-testing.md).
 *
 * Endpoint map (adapter lifecycle → TBO operation):
 *   search   → POST search
 *   check    → POST PreBook
 *   book     → POST Book
 *   retrieve → POST BookingDetail
 *   cancel   → POST Cancel
 * Content helpers (static data, used by recording tooling and tests):
 *   countryList → GET CountryList · cityList → POST CityList ·
 *   hotelDetails → POST HotelDetails
 */

import {
  serializeJson,
  type AdapterCallContext,
  type Transport,
  type TransportMethod,
  type TransportResponse,
} from "@jenova/supplier-sdk";
import { basicAuthorization, tboAccount } from "./auth";

export const TBO_SUPPLIER_CODE = "tbo";

export type TboEndpoint =
  | "search"
  | "check"
  | "book"
  | "retrieve"
  | "cancel"
  | "countryList"
  | "cityList"
  | "hotelCodeList"
  | "hotelDetails";

interface EndpointSpec {
  readonly path: string;
  readonly method: TransportMethod;
  /**
   * Transport-level retry safety. Book and Cancel mutate supplier state —
   * their retry safety comes from the clientReference / idempotent-replay
   * semantics above the transport, never from blind HTTP retries.
   */
  readonly idempotent: boolean;
}

export const TBO_ENDPOINTS: Readonly<Record<TboEndpoint, EndpointSpec>> = {
  search: { path: "search", method: "POST", idempotent: true },
  check: { path: "PreBook", method: "POST", idempotent: true },
  book: { path: "Book", method: "POST", idempotent: false },
  retrieve: { path: "BookingDetail", method: "POST", idempotent: true },
  cancel: { path: "Cancel", method: "POST", idempotent: false },
  countryList: { path: "CountryList", method: "GET", idempotent: true },
  cityList: { path: "CityList", method: "POST", idempotent: true },
  hotelCodeList: { path: "TBOHotelCodeList", method: "POST", idempotent: true },
  hotelDetails: { path: "HotelDetails", method: "POST", idempotent: true },
};

export class TboClient {
  readonly #transport: Transport;

  constructor(transport: Transport) {
    this.#transport = transport;
  }

  /**
   * Send one TBO call. `payload` is serialized as JSON for POST endpoints;
   * GET endpoints take none. Returns the raw transport response — status
   * handling and Status-envelope mapping live in the adapter (errors.ts).
   */
  async call(
    ctx: AdapterCallContext,
    endpoint: TboEndpoint,
    payload?: unknown,
  ): Promise<TransportResponse> {
    const spec = TBO_ENDPOINTS[endpoint];
    const account = tboAccount(ctx.credentials);
    const headers: Record<string, string> = {
      authorization: basicAuthorization(account),
      accept: "application/json",
    };
    let body: string | undefined;
    if (spec.method !== "GET" && payload !== undefined) {
      body = serializeJson(payload, { supplierCode: TBO_SUPPLIER_CODE });
      headers["content-type"] = "application/json";
    }
    return this.#transport.send(
      {
        method: spec.method,
        url: `${account.apiUrl}/${spec.path}`,
        headers,
        ...(body === undefined ? {} : { body }),
        idempotent: spec.idempotent,
      },
      ctx,
    );
  }
}
