/**
 * Error-taxonomy mapping over REAL recorded sandbox failures (M1.a4 #57).
 * Each scenario replays a failure the live sandbox was deliberately driven
 * into; the observed TBO codes are catalogued in README.md.
 */

import { describe, expect, it } from "vitest";
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

  // rate_limited: not reachable deliberately — driving the sandbox into 429
  // would mean hammering it, and look-to-book is a commercial obligation
  // (CLAUDE.md rule 5). The mapping (HTTP 429 / Status 429 → rate_limited)
  // is in place; the contract suite carries the scenario as a todo until a
  // real 429 is ever captured.
});
