# 08 — Security

## Auth realms (strictly separated)
| Realm | Audience | Notes |
|-------|----------|-------|
| Platform | Jenova staff | Separate app + deployment; hardware-key (WebAuthn) 2FA mandatory; short sessions. |
| Tenant staff | Internal Dashboard | Per-tenant user store; TOTP 2FA enforceable by tenant policy. |
| Agency | Agent Portal | Scoped to agency (sub-tenant); sub-user roles. |
| Corporate | Corporate Portal | Traveler / arranger / approver roles; optional SSO (SAML/OIDC) later for enterprise corporates. |
| Consumer | B2C storefront | Guest-first; optional accounts. |
| Machine | Partner API | Key + HMAC; scoped to tenant or sub-tenant; idempotency keys. |

Sessions are realm-bound tokens; no token crosses realms. Tenant resolution happens
before authentication (host/domain → tenant → its user store).

## Tenancy isolation
- DB-per-tenant makes cross-tenant reads impossible at the connection layer; the resolver
  in `db` is the only way to obtain a tenant connection.
- Sub-tenant scoping enforced in services via mandatory scope arguments (no "default all").
- Platform Admin fan-out queries are explicit, logged, and read-only except through
  service commands.

## Secrets
- Tenant supplier credentials and gateway credentials: encrypted at rest (per-tenant data
  key, KMS-wrapped), write-only in UI, decrypted only inside adapter calls.
- Platform secrets in the deployment secret store; local dev via `.env` (gitignored).
- The sandbox-replay recorder **sanitizes auth headers/tokens** before a recording is
  committed; raw captures are gitignored.

## Payments & PCI
- Hosted fields / redirect only — card data never touches Jenova (SAQ-A scope).
- Each tenant is its own merchant on its own gateway account; Jenova stores gateway
  transaction refs, never PANs.

## Money-path controls
- Human review required before merge: ledger, payments, booking sagas, fiscal-sa,
  auth, Platform Admin impersonation.
- Maker-checker on manual journal entries and manual credit adjustments.
- Impersonation: visible banner, audit entry, and **hard block** on payments, refunds,
  and credential reads.

## Audit & PII
- Append-only AuditEvent on every state change (actor, before/after, correlation id);
  platform-wide search in Platform Admin.
- PDPL: PII minimized, encrypted at rest, per-class retention; erasure = anonymization
  preserving booking/ledger/audit integrity.

## Application security baseline
- Signed short-lived offer tokens (server-priced booking only); webhook signatures;
  strict input validation at the gateway (zod schemas shared from domain).
- Rate limiting per realm + per key; lockout and session revocation tooling.
- Dependency audit + secret scanning in CI; pen test before pilot launch (M5) and before
  GA (M14).
