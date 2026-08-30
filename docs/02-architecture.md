# 02 — Architecture

## Shape: modular monolith + workers

One deployable API process (NestJS), one worker process (BullMQ), Postgres, Redis, and an
S3-compatible object store. **Not microservices** — a solo operator cannot run twelve
services, and enforced module boundaries in a monorepo give agents the same isolation
without the distributed-systems tax. Boundaries are real (dependency-lint rule per
module), so extraction later is possible; it is simply not paid for now.

```
   Platform Admin (Jenova control plane — separate app, separate auth realm)
──────────────────────────────────────────────────────────────────────────────
   Internal Dashboard (tenant staff)      External portals (thin clients)
   ├─ core workspace + settings           ├─ Agent Portal      (B2B app)
   ├─ B2B / Corporate / Finance           ├─ Corporate Portal  (Corporate app)
   ├─ API Access / Storefront-admin       ├─ B2C Website       (Storefront app)
   └─ CRM / Desk / Contracting            └─ Partner API       (API Access app)
──────────────────────────────────────────────────────────────────────────────
   API gateway — auth, tenant + sub-tenant resolution, app entitlements, rate limits
──────────────────────────────────────────────────────────────────────────────
   Engine services (one set, shared by every surface):
   search & availability → pricing & markup → GATE (differs per app:
   credit / policy+approval / payment / API quota) → booking state machines
   & sagas → double-entry ledger → documents & fiscal
──────────────────────────────────────────────────────────────────────────────
   Supplier layer: hotel / air / ground adapters (JSON, XML, SOAP) +
   Contracting store as an internal adapter + sandbox record-replay harness
──────────────────────────────────────────────────────────────────────────────
   Postgres: control-plane DB + ONE DATABASE PER TENANT · Redis · S3
```

## Tenancy: database per tenant (foundational decision)

- Every tenant gets **its own Postgres database**, provisioned automatically at signup.
- A **control-plane database** holds platform-level data only: tenants, app entitlements,
  platform billing, platform users, supplier catalog/certification state.
- The gateway resolves tenant → connection per request. Cross-tenant queries are
  *impossible*, not merely forbidden. Platform Admin fans out when it needs cross-tenant
  views.
- **Migrations** run through a fan-out runner against every tenant DB + control plane,
  from migration #1. A migration that cannot fan out safely does not merge.
- Per-tenant backup/restore; a tenant can be moved between hosting tiers as a database
  move, not a data-extraction project.
- **Sub-tenants live inside their tenant's database.** A sub-tenant's bookings are the
  tenant's ledger, credit checks, and reports — splitting them out would make every
  statement a cross-database query. Sub-tenants who require data ownership get a
  **Data Vault** instead (below).

## Isolation & hosting tiers

| Tier | What | Who |
|------|------|-----|
| Standard | Tenant's own DB on Jenova's managed cluster | Every tenant (default) |
| Dedicated instance | Own Postgres instance, optionally chosen region | Regulatory/residency/performance needs |
| Private / on-premise | Full containerized stack in the tenant's cloud or DC, licensed update channel | Enterprise, post-GA only |
| Sub-tenant Data Vault | CDC-synced dedicated copy of everything belonging to one sub-tenant, delivered to a DB *they* host (cloud or on-prem) | Corporates/agencies needing data ownership or BI/ERP feeds |

Identical containerized artifact across tiers; per-deployment code differences are
refused — extensibility (docs/apps + 05) is the only customization path.

## The apps model

- An **app** = a NestJS module + a dashboard section + an external portal (where
  applicable) + an **entitlement flag** on the tenant, checked at the gateway.
- Installing an app flips the entitlement and seeds default data. Nothing deploys
  per tenant.
- Apps and portals call **services, never tables**. The B2C site, Corporate Portal, and
  Partner API book through the identical services the Agent Portal uses; differences
  (who pays, which markup or policy applies) are parameters.
- The only step that differs per surface is the **gate** before confirmation:
  credit limit (B2B) · policy + approval (Corporate) · payment capture (B2C) ·
  key + quota (Partner API).

## Cross-cutting rules

1. Money is integers: minor units + ISO currency; conversion only at display and at
   ledger-posting time with a stored rate.
2. Everything supplier-facing is async-tolerant: call budgets, circuit breakers,
   `pending_confirmation` states instead of blocked requests.
3. Every state change posts ledger entries and an append-only `AuditEvent`.
4. Offers are server-priced: a signed offer token is the only thing a client can book;
   client-side prices are never trusted.
5. Storage is Gregorian UTC; Hijri and local times are display concerns.

## Search fan-out (hotels first, same pattern per vertical)

Search hits every supplier account enabled for the tenant in parallel under a hard time
budget (~8s hotels), streams results as suppliers respond (SSE), dedupes via canonical
property mapping (licensed mapping service + manual override queue), and retains
cheapest-per-basis with alternatives. Availability cache keyed by
(supplier, property, dates, occupancy, **nationality**) — nationality is a first-class
parameter because GCC rates vary by it. A mandatory `check` call revalidates price before
the gate; price deltas surface for re-approval.

## Package sagas

A package booking = one Booking, multiple BookingItems, and a saga: reserve all →
confirm all, or compensate (cancel confirmed items) on partial failure, with
manual-intervention queues for what automation can't safely unwind (supplier no-answer,
cancel-fee conflicts).
