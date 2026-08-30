# API Access app — Partner API

Machine-to-machine distribution: the tenant issues API credentials to partners (or to a
sub-tenant's IT) who integrate search/book into their own systems. Gate:
**API key + quota/metering** (the commercial gate — credit or account billing — still
applies per the key's bound sub-tenant).

## Dashboard section
- Key issuance: create keys bound to a scope (whole tenant, or one agency/corporate
  sub-tenant), environment (sandbox/production), allowed verticals.
- Per-key rate limits and monthly quotas; usage metering dashboards (calls, look-to-book,
  bookings); alerts near limits.
- Webhook subscription management per key/partner; delivery logs with redelivery.
- Docs portal link + key-scoped "try it" console.

## The API itself (v1, versioned)
- REST/JSON mirroring the internal service contracts: `POST /v1/hotels/search`,
  `POST /v1/offers/{token}/check`, `POST /v1/bookings`, `GET /v1/bookings/{ref}`,
  `POST /v1/bookings/{ref}/cancel` — verticals added as they land (air, ground, packages).
- Auth: key + HMAC signature; idempotency keys on booking calls; standard error envelope
  carrying the unified supplier-error taxonomy.
- Offer tokens are signed and short-lived exactly as in the portals — a partner can never
  post its own price.
- OpenAPI spec generated from the code contracts; the published spec doubles as the
  platform's own contract documentation.

## Invariants
- The Partner API calls the same engine services as every portal — zero parallel logic.
- Nothing sub-tenant-scoped ever leaks across keys; scope is enforced at the gateway.

## Acceptance heuristics
- A partner integrates search→book against sandbox using only the docs portal, without
  human help.
- Usage metering matches gateway logs; quota exhaustion returns a clear, documented error.
