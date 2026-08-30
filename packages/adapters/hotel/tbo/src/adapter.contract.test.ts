/**
 * The shared hotel-adapter contract suite (docs/09-testing.md) for TBO —
 * one suite, two modes, switched ONLY by transport injection:
 *
 *   default            — replay: resolves from committed recordings (CI)
 *   TBO_CONTRACT_LIVE=1 — live: the pre-certification run against the real
 *                          sandbox (books and cancels one real reservation;
 *                          fill the TBO block in the repo-root .env first)
 *
 * tools/certify.ts turns this suite's results into
 * docs/certification/tbo.md.
 */

import { fileURLToPath } from "node:url";
import {
  describeHotelAdapterContract,
  type HotelErrorScenario,
} from "@jenova/supplier-sdk/testing";
import { createTboHotelAdapter } from "./adapter";
import {
  makeDeadRateOfferToken,
  makeExpiredOfferToken,
  makeRecordedBookRequest,
  pickLifecycleOffer,
  RECORDED_BAD_AUTH_QUERY,
  RECORDED_INVALID_DATES_QUERY,
  RECORDED_SEARCH_INSTANT,
  RECORDED_SEARCH_QUERY,
  RECORDED_UNKNOWN_CONFIRMATION,
} from "./recorded-scenarios";
import { makeTestContext } from "./test-context";
import { createTboTransport } from "./transport";

const LIVE = process.env["TBO_CONTRACT_LIVE"] === "1";
if (LIVE) {
  // The live run needs the real sandbox credentials from the repo-root .env.
  try {
    process.loadEnvFile(fileURLToPath(new URL("../../../../../.env", import.meta.url)));
  } catch {
    // variables may come from the shell instead
  }
}

const mode = LIVE ? "live" : "replay";

function makeAdapter() {
  return createTboHotelAdapter({ transport: createTboTransport({ mode }) });
}

describeHotelAdapterContract(makeAdapter, {
  supplierCode: "tbo",
  makeContext: () => makeTestContext(),
  happyPath: {
    query: RECORDED_SEARCH_QUERY,
    // Book a cheap refundable rate with its free-cancellation window open —
    // evaluated "now" live, at the recorded instant on replay.
    pickOffer: (offers) =>
      pickLifecycleOffer(offers, LIVE ? new Date() : new Date(RECORDED_SEARCH_INSTANT)),
    makeBookRequest: (checkedOffer) => {
      const request = makeRecordedBookRequest(checkedOffer);
      // One clientReference, one booking: replay must match the recorded
      // reference; a live run makes a NEW reservation and needs its own.
      return LIVE
        ? { ...request, clientReference: `JENOVA-M1-TBO-LIVE-${Date.now()}` }
        : request;
    },
  },
  errorScenarios: {
    // sold_out is replay-only: the recorded driver (PreBook of an expired
    // BookingCode → TBO 201 "No Available rooms") is not deterministic
    // live — the sandbox intermittently re-validates old codes — so the
    // live run carries it as a todo rather than flaking (see README.md).
    ...(LIVE
      ? {}
      : {
          sold_out: {
            run: (adapter, ctx) => adapter.check(ctx, makeExpiredOfferToken()),
          } satisfies HotelErrorScenario,
        }),
    price_changed: {
      // A dead rate GUID: TBO 315 "Session Expired or doesn't exist"
      // (recorded live; deterministic in both modes) — the priced offer is
      // gone and must be re-priced. The fare/policy comparison path is
      // covered by lifecycle.test.ts against the real PreBook recording.
      run: (adapter, ctx) => adapter.check(ctx, makeDeadRateOfferToken()),
    },
    invalid_request: {
      // TBO 400 "Invalid date entered…" (recorded live).
      run: (adapter, ctx) => adapter.search(ctx, RECORDED_INVALID_DATES_QUERY),
    },
    supplier_timeout: {
      // Deadline exhausted before dialing — pure transport behavior.
      run: (adapter) =>
        adapter.search(makeTestContext({ deadlineMs: -1 }), RECORDED_SEARCH_QUERY),
    },
    supplier_rejected: {
      // TBO 479 "No Itinerary exist for this input" (recorded live).
      run: (adapter, ctx) => adapter.cancel(ctx, RECORDED_UNKNOWN_CONFIRMATION),
    },
    auth_failed: {
      // TBO 401 "Access Credentials is incorrect" — HTTP 200 envelope
      // (recorded live with a scratch wrong password; the live run swaps
      // the password the same way, .env untouched).
      run: (adapter) => {
        const ctx = makeTestContext();
        return adapter.search(
          makeTestContext({
            secrets: {
              ...ctx.credentials.secrets,
              password: "jenova-wrong-password-probe",
            },
          }),
          RECORDED_BAD_AUTH_QUERY,
        );
      },
    },
    // rate_limited: intentionally absent (contract todo) — driving the
    // sandbox into 429 would violate look-to-book; see README.md.
  },
});
