# Jenova Travel Tech — agent conventions (read this first, every session)

Multi-tenant SaaS travel platform for the GCC (competitor to eJuniper / TravZilla Pro),
built by Claude Code agents directed by Tarek. This file is the law; the specifications
live in `docs/` — read the doc for whatever you touch before writing code:

- `docs/README.md` — documentation index and reading order
- `docs/02-architecture.md` — system shape, tenancy, apps model (most-load-bearing doc)
- `docs/apps/<app>.md` — the spec for each app
- `docs/milestones/` — the build order; work ONLY on the active milestone's scope
- `docs/jenova-blueprint.html` — rendered executive blueprint (kept in sync with docs)

## Identity rules
- The product is **Jenova** — the only name that may appear in code, docs, UI, packages
  (`@jenova/*`). No other project name, ever.
- Jenova is a **technology partner**, never a travel merchant: tenants trade on their own
  supplier accounts and credit. Nothing may assume Jenova holds supplier credit,
  inventory, or merchant risk.

## Non-negotiable architecture rules
1. **Database per tenant.** Each tenant has its own Postgres DB; a control-plane DB holds
   platform-level data only. The `db` package's tenant resolver is the ONLY way to obtain
   a tenant connection. Every migration goes through the fan-out runner and must be
   expand-contract (code N−1 runs on schema N).
2. **Apps and portals call services, never tables.** Every surface books through the same
   engine services; per-surface differences (who pays, which markup/policy applies, which
   gate) are parameters, never forks.
3. **Apps are entitlements, not codebases.** App = NestJS module + dashboard section +
   portal (where applicable) + entitlement flag checked at the gateway. Install = flip
   flag + seed defaults. Nothing deploys per tenant; per-deployment code differences are
   refused — the extensibility framework is the only customization path.
4. **No supplier shape crosses the adapter boundary.** Adapters translate every response
   — JSON, XML, or SOAP — into canonical `domain` types: Money, UTC policy deadlines,
   occupancy, board basis, normalized CancellationPolicy, and the unified error taxonomy
   (sold_out · price_changed · invalid_request · supplier_timeout · supplier_rejected ·
   auth_failed · rate_limited). Engine and apps import from `domain` only; only the
   supplier registry imports adapter packages.
5. **No mock or fabricated data — anywhere, ever.** Development runs against live
   supplier sandboxes (credentials from Tarek's list, via `.env`/secret store). Automated
   tests replay REAL recorded traffic via the `sandbox-replay` package. Need data for a
   test? Record it from a sandbox. Never invent payloads, fixtures, seeds, or "example"
   supplier responses. CI and load tests never hit live sandboxes (look-to-book is a
   commercial obligation).
6. **Money is integers.** Minor units + ISO 4217 code, everywhere. No floats. FX only at
   display time and at ledger-posting time with a stored rate.
7. **Every state change posts to the ledger and audit log.** Booking transitions are
   atomic: validate legality (state machine as data) + persist + balanced double-entry
   postings + append-only AuditEvent + event emission. Financial reports are ledger
   reads — never recomputed.
8. **Offers are server-priced.** A signed, short-lived offer token is the only bookable
   thing; client-side prices are never trusted. Booking calls carry idempotency keys.
9. **Arabic-first RTL.** Every screen and document ships Arabic + English from its first
   commit. Storage is Gregorian UTC; Hijri and local time are display concerns.
   Nationality is a first-class, visible search parameter.
10. **UI kits.** Dashboard-class apps (dashboard, portal-agent, portal-corporate,
    platform-admin) use ONLY the shared `ui` package (wraps the Modernize/MUI template)
    — never import MUI or Modernize directly from an app. `storefront-b2c` is custom
    Tailwind and must not depend on `ui`/Modernize. Future mobile apps are also outside
    the Modernize rule.

## Working agreements
- **Scope:** one agent, one package/app, per the active milestone file. Do not start work
  outside the current milestone without Tarek's explicit direction.
- **Contracts before code:** interfaces + tests agreed before implementation. An adapter
  is "done" when the shared contract suite passes on recordings AND live sandbox.
- **Human review required** (no exceptions, never self-merge): ledger, payments, booking
  sagas, credit engine, fiscal-sa, auth, allotment engine, Data Vault CDC, and Platform
  Admin impersonation.
- **Secrets:** only in `.env` (gitignored) / deployment secret store. The replay recorder
  sanitizes auth headers before recordings are committed; raw captures never leave
  `sandbox-replay/raw-captures/` (gitignored).
- **Definition of done** (docs/09): unit+service tests green on recordings; flow
  demonstrated once live against sandbox; Arabic AND English verified; ledger/audit
  assertions where state changes; relevant doc updated.
- **Platform Admin parity:** any capability you ship, ship its Platform Admin surface in
  the same milestone.

## Code conventions
- TypeScript strict + `noUncheckedIndexedAccess` everywhere; pnpm + Turborepo; NestJS
  (api/worker), Next.js 15 (frontends), Drizzle (db), Vitest, Playwright.
- ESLint module-boundary rule enforces the import rules above mechanically — if the
  linter blocks an import, the design is wrong, not the linter.
- Conventional commits; branch naming `m<NN>/<package>-<task>`; PRs scoped to one
  package-task; git worktrees for parallel sessions.
- Match existing idiom; comments only for constraints code can't express.

## Current status
- Phase: **documentation complete, pre-M0**. Next: Tarek provides the supplier
  test-credentials list + Modernize files → scaffold M0 per
  `docs/milestones/M00-foundations.md`.
