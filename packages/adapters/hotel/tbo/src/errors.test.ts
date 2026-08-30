/**
 * Error-taxonomy mapping over REAL recorded sandbox failures (M1.a4 #57).
 * Each scenario replays a failure the live sandbox was deliberately driven
 * into; the observed TBO codes are catalogued in README.md.
 */

import { describe, expect, it } from "vitest";
import type { Transport } from "@jenova/supplier-sdk";
import { expectSupplierErrorKind } from "@jenova/supplier-sdk/testing";
import { createTboHotelAdapter } from "./adapter";
import {
  makeExpiredOfferToken,
  RECORDED_BAD_AUTH_QUERY,
  RECORDED_INVALID_DATES_QUERY,
  RECORDED_SEARCH_QUERY,
  RECORDED_UNKNOWN_CONFIRMATION,
  RECORDED_UNKNOWN_HOTEL_QUERY,
} from "./recorded-scenarios";
import { makeTestContext } from "./test-context";
import { createTboTransport } from "./transport";

function makeAdapter() {
  return createTboHotelAdapter({ transport: createTboTransport({ mode: "replay" }) });
}

describe("TBO error taxonomy from recorded sandbox failures", () => {
  it("sold_out: PreBook of an expired BookingCode (TBO 201, indistinguishable from sold-out)", async () => {
    await expectSupplierErrorKind(
      () => makeAdapter().check(makeTestContext(), makeExpiredOfferToken()),
      "sold_out",
    );
  });

  it("invalid_request: TBO 400 'Invalid date entered' on a reversed date range", async () => {
    await expectSupplierErrorKind(
      () => makeAdapter().search(makeTestContext(), RECORDED_INVALID_DATES_QUERY),
      "invalid_request",
    );
  });

  it("auth_failed: TBO 401 'Access Credentials is incorrect' (arrives as HTTP 200)", async () => {
    await expectSupplierErrorKind(
      () => makeAdapter().search(makeTestContext(), RECORDED_BAD_AUTH_QUERY),
      "auth_failed",
    );
  });

  it("supplier_rejected: TBO 479 'No Itinerary exist' cancelling an unknown booking", async () => {
    await expectSupplierErrorKind(
      () => makeAdapter().cancel(makeTestContext(), RECORDED_UNKNOWN_CONFIRMATION),
      "supplier_rejected",
    );
  });

  it("invalid_request: TBO 400 'Booking does not exist' retrieving an unknown booking", async () => {
    await expectSupplierErrorKind(
      () => makeAdapter().retrieve(makeTestContext(), RECORDED_UNKNOWN_CONFIRMATION),
      "invalid_request",
    );
  });

  it("supplier_timeout: an exhausted deadline refuses the call before dialing", async () => {
    await expectSupplierErrorKind(
      () =>
        makeAdapter().search(makeTestContext({ deadlineMs: -1 }), RECORDED_SEARCH_QUERY),
      "supplier_timeout",
    );
  });

  it("maps TBO 201 on a broad search to an empty result, not an error", async () => {
    const offers = await makeAdapter().search(makeTestContext(), RECORDED_UNKNOWN_HOTEL_QUERY);
    expect(offers).toEqual([]);
  });

  it("rate_limited: an HTTP 429 surfacing from the transport maps to rate_limited", async () => {
    // Mechanism verification, not a recording: deliberately driving the
    // sandbox into a real 429 would mean hammering it, and look-to-book is
    // a commercial obligation. The rule-5 line holds because nothing
    // supplier-shaped is fabricated here — an HTTP status code is transport
    // structure (RFC 6585) handled by the shared supplier-sdk client (which
    // retries 429 with backoff before surfacing it), the body is empty, and
    // neither the recorded sandbox sessions nor TBO's Postman collection
    // document any 429 body shape: the status code is the whole contract
    // the adapter maps (supplierErrorFromHttp).
    const throttledSeam: Transport = {
      send: () => Promise.resolve({ status: 429, headers: {}, body: "" }),
    };
    await expectSupplierErrorKind(
      () =>
        createTboHotelAdapter({ transport: throttledSeam }).search(
          makeTestContext(),
          RECORDED_SEARCH_QUERY,
        ),
      "rate_limited",
    );
  });
});
