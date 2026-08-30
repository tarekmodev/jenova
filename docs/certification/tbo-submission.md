# TBO Holidays — certification submission package (Jenova)

Prepared for TBO's certification team. Companion documents: the automated run
report [`tbo.md`](./tbo.md) (generated from the contract suite; recorded CI
run + one live sandbox run) and the adapter's technical README
(`packages/adapters/hotel/tbo/README.md`).

## Who is integrating

**Jenova** is a multi-tenant SaaS travel platform for the GCC, built as a
**technology partner**: each tenant (travel agency / TMC) trades on its **own
TBO account and credit**. Jenova holds no inventory, no supplier credit and no
merchant risk. TBO credentials are stored per tenant, encrypted, and used only
at call time; in development they live in an untracked `.env`. All work below
ran against the TBO sandbox (`api.tbotechnology.in/TBOHolidays_HotelAPI`) with
the certification credentials provided to Jenova.

## Integration scope — TBOHolidays HotelAPI (JSON)

| Jenova operation | TBO endpoint | Notes |
|------------------|--------------|-------|
| Hotel search | `POST /search` | By HotelCodes; `GuestNationality` sent on every search (first-class in Jenova) and echoed back to the client; `ResponseTime` set to TBO's documented maximum; `IsDetailedResponse: true` |
| Rate revalidation | `POST /PreBook` | `PaymentMode: Limit`; fare and cancellation policy re-compared against the priced snapshot — any drift is surfaced as a price change, never silently absorbed |
| Booking | `POST /Book` | `BookingType: Voucher`, `PaymentMode: Limit`; `ClientReferenceId` and `BookingReferenceId` carry Jenova's idempotency reference — one reference, one booking; never retried at the HTTP layer |
| Booking retrieval | `POST /BookingDetail` | By `ConfirmationNumber`; per-room fares/policies aggregated; unknown `BookingStatus` vocabulary fails loudly (drift detection) |
| Cancellation | `POST /Cancel` | Followed by `BookingDetail` re-read; `CancellationInProgress` handled as an async-settling state |
| Static content | `GET /CountryList`, `POST /CityList`, `POST /TBOHotelCodeList`, `POST /HotelDetails`, `POST /BookingDetailsBasedOnDate` | Recording tooling and operational reconciliation |

Client behavior: per-call deadline budgets with abort, bounded full-jitter
retries on idempotent operations only (429/502/503/504 and transient
transport failures), a per-account circuit breaker, and HTTP Basic auth per
call. Search/PreBook/BookingDetail are retryable; Book and Cancel are never
blindly retried — booking retry safety comes exclusively from
`ClientReferenceId`.

## Error handling

TBO's `Status` envelope (including error statuses inside HTTP 200) and HTTP
statuses are both mapped to Jenova's unified taxonomy. Every mapping row was
driven against the live sandbox and captured on 2026-08-30; the full observed
catalogue is in the adapter README. Highlights:

- `Status 201 "No Available rooms"`: empty result on a broad search;
  **sold_out** on PreBook of a specific rate.
- `Status 315 "Session Expired or doesn't exist"`: **price_changed** — the
  priced rate is gone and is re-priced, never re-used.
- `Status 400` (invalid dates / unknown booking): **invalid_request**.
- `Status 401 "Access Credentials is incorrect"` (HTTP 200): **auth_failed**.
- `Status 479 "No Itinerary exist"`: **supplier_rejected**.
- Deadline/transport failures: **supplier_timeout**; HTTP/Status 429:
  **rate_limited** (see evidence note below).
- PreBook fare or cancellation-policy drift vs. the priced offer:
  **price_changed**.

Money is handled in integer minor units with exact decimal conversion;
cancellation deadlines (`dd-MM-yyyy HH:mm:ss`, no timezone marker on the
wire) are resolved as IST — TBO's operating timezone — which is conservative
for GCC properties.

## Test evidence

Two-mode contract suite — identical checks, switched only by transport
injection:

1. **Recorded (CI, every commit):** replays sanitized real sandbox traffic
   captured from deliberate live sessions. No synthetic or fabricated
   supplier payloads exist anywhere in the test suite.
2. **Live (pre-certification):** the same suite against the live sandbox.
   The run in `tbo.md` searched, revalidated, **booked and immediately
   cancelled one real refundable sandbox reservation** (holder "Jenova
   Certification", client reference pattern `JENOVA-M1-TBO-LIVE-<timestamp>`;
   the earlier recorded certification booking is confirmation `LV****`,
   cancelled, reference `JENOVA-M1-TBO-CERT-0001` — full confirmation
   numbers available on request or via `BookingDetailsBasedOnDate`).

**Verdict: CERTIFIABLE** — 10/12 live checks passed; 2 scenarios are
certified on declared standing evidence, stated plainly rather than forced:

- **sold_out** — evidenced by the committed live recording of TBO 201 on
  PreBook of a stale BookingCode (2026-08-30), replayed as a pass in every
  CI run. Live reproduction is unreliable by nature: the sandbox's answer
  for the same stale code drifts between 201 and 315 with session state
  (3/3 deliberate probes on 2026-08-31 returned 315), so a live drive would
  produce flaky, not stronger, evidence.
- **rate_limited** — deliberately forcing the sandbox into 429s would
  conflict with the look-to-book obligation, so it is mechanism-verified:
  a structural test at the transport seam proves an HTTP 429 maps to
  `rate_limited` and that the shared client retries 429 with backoff before
  surfacing it. No 429 body shape is documented for the sandbox; the status
  code is the whole contract.

Look-to-book discipline: live sessions are deliberate and budgeted; CI never
touches the live sandbox. The live certification run comprised 4 searches,
2 PreBooks, 1 Book, 2 BookingDetails and 2 Cancels, with exactly one real
reservation created and cancelled.

## Contact

Tarek Mohamed — tarek.mohamed@rahala.com.sa
