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
    // Declared capability (#74 L2), from recorded evidence: TBO's
    // BookingDetail response carries no ClientReferenceId — only the Book
    // response echoes it (verified on the recorded live booking of
    // 2026-08-30; README "Idempotency"). The engine keeps its own copy.
    retrieveEchoesClientReference: false,
  },
  errorScenarios: {
    // sold_out is driven on recordings; live it is certified on the recorded
    // evidence. The driver (PreBook of a stale BookingCode → TBO 201 "No
    // Available rooms") is not deterministic live: the sandbox's answer for
    // the same stale code drifts — 201 was captured live 2026-08-30, and
    // 3/3 deliberate live probes on 2026-08-31 answered 315 "Session
    // Expired" instead (README error-taxonomy table). A live drive would
    // flake, so the live run declares the recorded 201 as its basis.
    sold_out: LIVE
      ? {
          evidenceBasis:
            "TBO 201 'No Available rooms' on PreBook, captured live 2026-08-30 (committed recording; replayed as a PASS in the recorded run above). Live reproduction is unreliable: the sandbox answers 201 or 315 for the same stale BookingCode depending on session state — 3/3 probes on 2026-08-31 returned 315. See README.md and docs/certification/tbo-submission.md.",
        }
      : ({
          run: (adapter, ctx) => adapter.check(ctx, makeExpiredOfferToken()),
        } satisfies HotelErrorScenario),
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
    // rate_limited: never driven — deliberately forcing the sandbox into
    // 429 would hammer it, and look-to-book is a commercial obligation
    // (CLAUDE.md rule 5). The mapping is mechanism-verified instead at the
    // transport seam (errors.test.ts): an HTTP 429 status is transport
    // structure, not a fabricated supplier payload.
    rate_limited: {
      evidenceBasis:
        "mechanism-verified: HTTP 429 at the transport seam maps to SupplierError(rate_limited) (errors.test.ts) and the shared client retries 429 with backoff (supplier-sdk transport tests). Deliberate live reproduction would violate look-to-book; neither the sandbox sessions nor TBO's Postman collection document a 429 body shape, so the status code is the whole contract.",
    },
  },
});
