# @jenova/sandbox-replay

Record/replay harness for supplier traffic (docs/09-testing.md). Adapters wrap their
transport with `createReplayTransport(...)`, a fetch-compatible function:

- **record** (development only): the real request goes to the live supplier sandbox;
  the request/response pair (method, URL, headers, JSON or XML text body, status,
  timings) is persisted as one recording per interaction under
  `recordings/<supplier>/<fingerprint>.json`.
- Recordings are keyed by a **normalized request fingerprint**: method + URL with
  volatile params (timestamps, nonces, correlation ids) normalized + a canonicalized
  body hash — so a re-run of the same scenario resolves to the same file.
- The format is deterministic and human-diffable: `schemaVersion`, fixed key order,
  alphabetized lowercase headers, 2-space indent. Wall-clock timestamps stay out of
  recordings (only `timings.durationMs`) so re-recording diffs quietly; the weekly
  drift job should ignore `timings` when diffing.

- **replay** (CI and every automated test run): the transport resolves from
  `recordings/` only — no network, ever. A fingerprint miss throws
  `ReplayMissError`: `record this scenario first: <fingerprint> (supplier <name>)`.
  Never a silent fallback, never a generated response.

Record mode never runs in CI against the network — look-to-book is a commercial
obligation. CI resolves from recordings only.

## Sanitization and quarantine

Before anything persists to `recordings/`, `sanitizeRecording` strips every piece of
credential material: auth/api-key/signature/cookie headers, credential query params and
basic-auth userinfo in URLs, credential-named JSON keys and XML elements/attributes,
and bearer/basic/JWT-shaped strings inside any text value — all replaced with
`[REDACTED]`. The redaction list is configurable per adapter (extra names merge **on
top of** the safe defaults, never instead of them). Credential params are also treated
as volatile for fingerprinting, so credentials never enter the hash input and rotating
sandbox credentials cannot orphan recordings.

The unsanitized capture only ever lands in `raw-captures/`, which is gitignored at the
repo root — raw captures never leave this package's directory and are never committed.

`credential-guard.test.ts` is the CI gate: it scans every committed recording for
credential patterns (bearer tokens, basic-auth base64, JWTs, common key shapes) and
fails the build on any match.

## The data rule (CLAUDE.md rule 5)

**No mock or fabricated supplier data — ever.** This package is the *mechanism*, so its
own tests construct minimal structural HTTP examples (a header, a tiny JSON/XML body)
to prove fingerprinting, sanitization and miss behavior. That is the full extent of
invented data allowed anywhere in Jenova: nothing may imitate a real supplier's API
shape — no hotel/flight/booking payloads, no supplier field names. Real recordings
arrive in M1, captured from live supplier sandboxes with real test credentials.
