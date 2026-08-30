# M0 — Foundations (weeks 1–2)

**Goal:** a monorepo where a Claude agent can clone, implement a package-scoped task,
test it, and ship a reviewed PR to staging — unaided.

## Deliverables
- [x] Monorepo: pnpm workspaces + Turborepo; TS strict base config; ESLint with the
      module-boundary rule (apps can't import apps; only the supplier registry imports
      adapters; adapters can't import engine modules).
- [ ] `CLAUDE.md` (root) — the agent conventions, final version.
- [x] `domain` package: Money, tenancy brands, SalesChannel/AppKey/Vertical types,
      BookingItemState machine as data, CancellationPolicy, SupplierError taxonomy.
      Unit + property tests (money arithmetic, transition legality).
- [x] `db` package: control-plane schema v1 (Tenant, AppInstallation, PlatformUser,
      SupplierCatalogEntry) + tenant schema v1 (SupplierAccount, Agency, MarkupRule,
      Booking, BookingItem, LedgerAccount, JournalEntry, AuditEvent, Offer);
      **per-tenant database provisioning** + **fan-out migration runner** with dry-run,
      per-tenant failure isolation, resume; tenant connection resolver (the only door).
- [x] `supplier-sdk` package: HotelSupplierAdapter interface + AdapterCallContext +
      credentials types; transport codecs skeleton (retrying HTTP client with deadline
      budgets + circuit breaker; JSON codec; XML/SOAP codec with schema validation);
      contract-test harness skeleton.
- [ ] `sandbox-replay` package: recording proxy (fingerprint keying, auth sanitization),
      replay resolver, "record this scenario first" failure mode.
- [ ] `apps/api` skeleton: NestJS bootstrap, gateway middleware chain stubs
      (host→tenant resolution, auth realm stub, entitlement check stub), health/ready.
- [ ] Auth skeleton: session issuance/verification per realm, TOTP enrollment (full
      flows land with their apps).
- [x] Local dev: Docker Compose (Postgres, Redis, MinIO, mailpit); `.env.example` with
      supplier-credential placeholders keyed to Tarek's list.
- [x] CI: lint, typecheck, tests, migration fan-out dry-run on synthetic tenant DBs
      (real job: fresh control-plane + 3 synthetic tenant DBs, dry-run then apply,
      plus the db integration suite — schema only, no fabricated data).
- [ ] Staging: Terraform for one VM + managed Postgres in me-south-1; deploy on main.

## Agent workstreams (parallel)
1. **repo+ci** — workspaces, lint rules, CI, Compose.
2. **domain** — types + state machine + tests.
3. **db** — schemas, provisioning, fan-out runner (❗human review: it touches everything).
4. **supplier-sdk + sandbox-replay** — contracts, codecs, recorder.

## Tarek (human/external) — start now, they gate later milestones
- Provide the supplier test-credentials list → `.env` locally + staging secrets.
- Begin technology-partner/certification paperwork with each listed supplier.
- Provide Modernize template files (used from M2) + confirm Extended License.
- Open ZATCA sandbox (compliance simulation) access; choose Moyasar vs HyperPay and
  start onboarding; open GitHub org + AWS account (me-south-1).

## Acceptance gate
An agent implements a small task in one package, CI passes (including fan-out dry-run),
Tarek reviews, merge auto-deploys to staging. Tenant provisioning creates a real tenant
DB and the resolver connects to it.
