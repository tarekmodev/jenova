# 09 — Testing strategy

## The prime directive: no mock or fabricated data — ever

Development runs against **live supplier sandboxes** using real test credentials (from
Tarek's supplier list) from milestone M1 onward. Automated tests replay **real recorded
traffic** captured from those sandboxes by the `sandbox-replay` package. If a test needs
data, record it from a sandbox; never invent it. This keeps the engine shaped by real
supplier behavior — their response formats, policy encodings, error codes — not by
assumptions.

## The sandbox-replay harness
- A recording proxy wraps every adapter transport call in development: request + response
  (JSON or XML/SOAP) captured with timings, keyed by a normalized request fingerprint.
- Recordings are **sanitized** (auth headers/tokens stripped) before commit; raw captures
  are gitignored.
- In CI, the transport layer resolves from recordings only — a cache miss fails the test
  with "record this scenario first" rather than silently inventing a response.
- Failure scenarios (timeouts, `sold_out`, price changes, SOAP faults) are captured by
  driving the sandbox into them where possible, and by replaying a real response with a
  delayed/severed transport where not (the payload is still real).
- Recordings age: a scheduled weekly job re-runs the recording suites against live
  sandboxes and diffs — supplier API drift is detected before it breaks production.

## Test layers

| Layer | Tool | Against | Gate |
|-------|------|---------|------|
| Unit (domain, pricing, state machines, policy evaluation) | Vitest | Pure code — property-based tests for pricing/money | every PR |
| Contract (per adapter) | Vitest + supplier-sdk harness | Recorded sandbox traffic; the same suite runs live against the sandbox before certification | every PR (recorded) / weekly + pre-cert (live) |
| Service/integration (booking flows, sagas, ledger postings) | Vitest + testcontainers Postgres/Redis | Recorded supplier traffic through real services and a real (throwaway) tenant DB | every PR |
| Migration | fan-out dry-run | Fresh control-plane + N synthetic tenant DBs (schema-only — no fabricated business data) | every PR touching db |
| E2E | Playwright | Full stack + recorded replays; Arabic and English runs | main merge + nightly |
| Load | k6 | Replay-backed supplier layer (never live sandboxes) | before M5, M14 |

## Money-path invariants (tested continuously)
- Every booking transition posts balanced ledger entries (debits = credits) — asserted
  by a ledger-invariant checker that runs in service tests and nightly against staging.
- Statement/aging/VAT report totals reconcile with journal entries exactly.
- Saga compensation: forced partial failures (real `sold_out`/timeout recordings) leave
  no orphaned confirmed items and no unbalanced postings.

## Definition of done (any feature)
1. Unit + service tests green on recorded traffic.
2. The flow demonstrated once against the **live** sandbox in a dev environment.
3. Arabic + English UI states verified (e2e screenshots for both directions).
4. Ledger/audit assertions where state changes; docs updated if behavior is user-visible.
