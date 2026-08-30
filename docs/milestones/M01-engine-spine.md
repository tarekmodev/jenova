# M1 — Engine spine on live supplier sandbox (month 1)

**Goal:** the whole hotel booking chain works headlessly against a **real supplier
sandbox** (first supplier from Tarek's credentials list — assumed TBO), with real
recorded traffic powering CI. No UI yet beyond API endpoints.

## Deliverables
- [x] **First hotel adapter** (`adapters/hotel/tbo`): auth, search, check, book,
      retrieve, cancel against the live sandbox; full normalization (Money, UTC policy
      deadlines, occupancy, board basis, error taxonomy); recordings captured for every
      scenario the sandbox can produce (ok, sold_out, price_changed, timeout).
      (#49: full lifecycle proven live — booking LVFXI5 booked and cancelled;
      rate_limited unreachable without violating look-to-book, documented in the
      adapter README.)
- [ ] **Search & availability service** (`api/hotel-search`): fan-out orchestrator
      (single supplier for now, N-ready), hard time budget, SSE streaming, availability
      cache keyed (supplier, property, dates, occupancy, nationality), static-content
      cache.
- [ ] **Pricing engine** (`api/pricing`): pure resolve(net, context) → sell + breakdown;
      most-specific-wins MarkupRule resolution; fired-rule id stored on Offer;
      property-based tests (never negative margin unless rule explicitly allows, VAT
      breakdown correctness, FX with stored rate + buffer).
- [ ] **Offer store**: TTL cache + signed price hash; `check` revalidation flow with
      price-delta surfacing.
- [ ] **Booking engine** (`api/hotel-booking`): BookingItem state machine runner —
      atomic transition = validate legality + persist + ledger postings + AuditEvent +
      event emission; idempotent booking via client reference; `pending_confirmation`
      handling via worker polling.
- [ ] **Ledger core** (`api/ledger`): double-entry postings for reserve/confirm/cancel;
      balance reads; the ledger-invariant checker (debits=credits) wired into tests.
- [ ] Worker app: BullMQ queues for supplier retries + pending-confirmation polling.
- [x] Contract-test suite v1 in supplier-sdk: the generic suite every hotel adapter must
      pass — runs on recordings in CI, and live pre-certification. (Proven both modes
      on the TBO adapter; run report: `docs/certification/tbo.md`.)

## Agent workstreams
1. **adapter-tbo** (with recordings) — the pathfinder; its friction refines supplier-sdk.
2. **search+offers** — fan-out, cache, SSE, offer signing.
3. **pricing** — rules engine + property tests.
4. **booking+ledger** (❗human review) — state machine, postings, idempotency.

## Tarek
- Verify sandbox credential scopes/limits with the supplier; certification paperwork
  continues. Review every booking/ledger PR.

## Acceptance gate
Via API: search → check → book → cancel a **real sandbox hotel** end-to-end; ledger
postings balance; AuditEvents complete; CI green using recorded traffic only; the
contract suite passes both recorded and live.
