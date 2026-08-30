# @jenova/adapter-hotel-tbo

TBO Holidays hotel adapter (docs/05-suppliers.md roadmap #1). Implements the
canonical `HotelSupplierAdapter` lifecycle over the TBO HotelAPI (JSON):

| Lifecycle  | TBO operation        | Transport retry |
|------------|----------------------|-----------------|
| `search`   | `POST search`        | yes (idempotent) |
| `check`    | `POST PreBook`       | yes (idempotent) |
| `book`     | `POST Book`          | **no** — retry safety comes from `clientReference` |
| `retrieve` | `POST BookingDetail` | yes (idempotent) |
| `cancel`   | `POST Cancel`        | **no** |

Content helpers (recording tooling and future static-content sync):
`GET CountryList`, `POST CityList`, `POST TBOHotelCodeList`, `POST HotelDetails`.

Everything in this package is derived from **real recorded sandbox traffic**
(`packages/sandbox-replay/recordings/tbo`, sanitized; CLAUDE.md rule 5).
The recorded certification booking: confirmation `LV****` (masked in prose;
the full reference necessarily appears inside the recordings — replay keys
on request bodies — and is a cancelled sandbox reservation with a synthetic
holder) — Riyadh "Comfort Inn Taawn" studio, 139.73 USD, refundable —
booked live on 2026-08-30 and cancelled immediately.

## Credentials

Per-call HTTP Basic auth from `SupplierAccountCredentials.secrets`:

| Secret key | Development source (.env) |
|------------|---------------------------|
| `apiUrl`   | `TBO_HOTEL_API_URL`       |
| `username` | `TBO_HOTEL_USERNAME`      |
| `password` | `TBO_HOTEL_PASSWORD`      |

Production credentials come from the tenant DB's `SupplierAccount`, decrypted
at call time — tenants trade on their own TBO accounts, never on Jenova's.
The sandbox-replay sanitizer strips the `Authorization` header (and TBO's
`sessionid` response header) before any recording can be committed; the
credential-guard test in `@jenova/sandbox-replay` scans every committed
recording in CI.

## Error taxonomy — observed TBO codes

TBO signals failures in the `Status` envelope of an HTTP **200** response
(auth failures included). All codes below were driven and recorded against
the live sandbox on 2026-08-30:

| TBO signal | Observed description | Mapped kind | Recorded scenario |
|------------|----------------------|-------------|-------------------|
| Status 200 | `Success` / `Successful` | (ok) | every happy-path recording |
| Status 201 on `search` | `No Available rooms for given criteria` | **empty result** `[]` | unknown hotel code 999999999 |
| Status 201 on `PreBook` | `No Available rooms for given criteria` | `sold_out` | expired BookingCode (TBO does not distinguish expiry from sold-out; the sandbox intermittently RE-VALIDATES old codes, so this scenario is recorded-only in the contract suite — live it appears as a todo) |
| Status 315 | `Session Expired or doesn't exist` | `price_changed` | PreBook of a dead rate GUID — the priced offer is gone and must be re-priced (deterministic live and recorded) |
| Status 400 | `Invalid date entered. CheckIn date should be less than CheckOut date.` | `invalid_request` | reversed date range |
| Status 400 | `Booking does not exist for the requested input` | `invalid_request` | BookingDetail for unknown confirmation |
| Status 401 | `Access Credentials is incorrect` (HTTP 200!) | `auth_failed` | wrong password via scratch env var (`TBO_HOTEL_SCRATCH_PASSWORD`; `.env` untouched) |
| Status 479 | `No Itinerary exist for this input` | `supplier_rejected` | Cancel for unknown confirmation |
| price/policy drift on `check` | PreBook fare or normalized policy ≠ priced snapshot in the offer token | `price_changed` | comparison against the real PreBook recording |
| deadline exhausted / transport abort | — | `supplier_timeout` | transport-level, no payload involved |
| HTTP 429 / Status 429 | *never observed* | `rate_limited` | **not reachable deliberately** — forcing a 429 would hammer the sandbox and look-to-book is a commercial obligation; the mapping is wired, the contract scenario stays a todo until a real 429 is ever captured (e.g. by the weekly drift job) |
| any other Status code | — | `supplier_rejected` | fallback: the supplier answered and refused |

Unknown `BookingStatus` vocabulary on BookingDetail fails loudly as
`invalid_request` (API drift detection), never guesses a state.

## Documented conversions and assumptions (verified on recordings)

- **Money.** TBO sends decimal floats (`"TotalFare":1057.12`). Conversion to
  integer minor units is exact: the parsed double's `toString()` is its
  shortest round-tripping decimal — for every value TBO can express this is
  the wire text — decomposed into an integer ratio and scaled in bigint with
  the ISO 4217 exponent (2 default; 3 for GCC dinars; 0 for JPY-class).
  If TBO ever sends more decimals than the currency's minor unit, rounding
  is half-away-from-zero (the commercial rule used across @jenova/domain).
- **Cancellation deadlines.** `CancelPolicies[].FromDate` is
  `dd-MM-yyyy HH:mm:ss` with **no timezone marker on any recorded response**.
  Resolved as **IST (UTC+05:30)** — TBO's operating timezone. For GCC
  properties (UTC+3/+4) this reads every deadline 1.5–2.5 h *earlier* than
  hotel-local midnight, so a rate stops looking freely cancellable before
  the earliest plausible real deadline — the conservative direction. The
  weekly re-recording drift job re-checks the format.
- **Board basis.** Observed meal types `Room_Only`, `BreakFast`,
  `Breakfast_For_2` (+ documented `Half_Board`, `Full_Board`,
  `All_Inclusive`) normalize to RO/BB/HB/FB/AI by word match. Unknown values
  skip the room — never mislabel it, and never silently: every skip is
  reported through the adapter's `onSkippedRoomRate` seam (structured warn +
  per-value counter; the registry exposes it as `hotelVocabularyDrift` for
  the Platform Admin supplier health board).
- **Canonical property ids.** `tbo:<HotelCode>` until the licensed mapping
  service lands (M3); the contract (canonical ids in and out) is final.
- **Nationality.** First-class: `GuestNationality` is sent on every search
  from `AdapterCallContext.nationality` and echoed as `nationalityApplied`.
  TBO prices against it; it is embedded in the offer token and re-checked at
  `check` time.
- **Idempotency.** `clientReference` → `ClientReferenceId` **and**
  `BookingReferenceId`. TBO echoes `ClientReferenceId` on the Book response
  (verified live). `BookingDetail` does **not** echo it — retrieve records
  carry `clientReference: ""` and the engine keeps its own copy.
- **Async cancellation.** `Cancel` answers `200 "Cancelled"`, then
  `BookingDetail` reports `CancellationInProgress` until it settles —
  mapped to `pending`; the engine's polling worker owns the settle watch.
- **Booking detail aggregation.** Fares and policies live per room on
  `BookingDetail`; the record's `net` sums room fares (single currency
  enforced) and per-room policies merge into one booking-level rule set.
- **Guest titles.** `HotelGuest` has no honorific; TBO requires one — the
  adapter sends `Title:"Mr"` until the domain grows a title field.
- **Supplements.** `Type:"AtProperty"` supplements (deposits, resort fees)
  are pay-at-property and are NOT part of the supplier net; they ride in
  TBO's RateConditions and surface with content/documents work (M2).

## Recording sessions

Deliberate, budgeted live sessions only (look-to-book):

```
pnpm --filter @jenova/adapter-hotel-tbo record lifecycle      # search→check→book→retrieve→cancel, one real reservation
pnpm --filter @jenova/adapter-hotel-tbo record search         # canonical search scenario only
pnpm --filter @jenova/adapter-hotel-tbo record countryList|cityList|hotelCodeList|hotelDetails …
```

Raw captures land in `sandbox-replay/raw-captures/` (gitignored); sanitized
recordings in `sandbox-replay/recordings/tbo/` (committed). When
re-recording the lifecycle, bump `RECORDED_CLIENT_REFERENCE` (one
clientReference, one booking) and refresh `recorded-scenarios.ts` if dates
or hotel codes change.

## Tests

`pnpm --filter @jenova/adapter-hotel-tbo test` — unit + replay tests plus
the shared contract suite (`describeHotelAdapterContract`) on recordings.
Set `TBO_CONTRACT_LIVE=1` (with the TBO block filled in `.env`) to run the
same contract suite against the live sandbox — required before
certification (docs/certification/tbo.md).
