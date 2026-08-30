# 07 — Tech stack

One language end-to-end: **TypeScript**. It maximizes what Claude agents do best, lets
domain types flow from database to browser, and keeps a solo operator in one toolchain.

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Monorepo | pnpm + Turborepo | Shared packages with task caching; agents work per-package. |
| API | NestJS (Node 22) | Module system mirrors the architecture boundaries; DI swaps adapters; OpenAPI generation built in. |
| Dashboard-class frontends | Next.js 15 + **Modernize template (MUI)** | Internal Dashboard, Agent Portal, Corporate Portal, Platform Admin. Customer-provided license (Extended License required for paid SaaS). MUI's first-class RTL carries Arabic-first. All apps consume the shared `ui` package that wraps Modernize with Jenova theming — never import MUI/Modernize directly. |
| B2C storefront | Next.js 15 + Tailwind | Deliberately not Modernize: custom, tenant-themeable, lightweight, SSR for SEO. Future mobile apps also excluded from the Modernize rule. |
| Database | PostgreSQL 17 + Drizzle ORM | **One database per tenant** + control-plane DB; typed schema as code; fan-out migration runner; PgBouncer per-tenant pooling. |
| Cache / queues | Redis + BullMQ | Offer & availability caches, booking sagas, notifications, supplier retries, Data Vault CDC jobs. |
| Object storage | S3-compatible | Documents, tenant media, ZATCA XML archive. |
| Auth | Self-hosted (Lucia-style) + TOTP 2FA; hardware-key 2FA for Platform Admin | Multi-tenant multi-audience auth is core domain — don't rent it per-MAU. See 08-security. |
| PDFs | Typst (fallback: Playwright HTML render) | Bilingual RTL documents; deterministic output. |
| Realtime | SSE | Streaming search results; portal notifications. |
| Observability | OpenTelemetry → Grafana Cloud (or SigNoz) | Trace every supplier call; per-supplier latency/error dashboards are an operations necessity. |
| Infra | Docker Compose → single beefy VM + managed Postgres; IaC (Terraform) from day one | Boring and cheap until real load. Region: AWS me-south-1 first (see 06). Kubernetes explicitly deferred. |
| CI/CD | GitHub Actions | Lint, typecheck, unit + contract tests (recorded replay), e2e, fan-out migration dry-run; deploy on tag. |
| Testing | Vitest + Playwright + sandbox-replay | See 09-testing. No mocks, ever. |

## Repository layout

```
jenova/
├── CLAUDE.md                    # agent conventions (the law)
├── docs/                        # these documents + milestone plans
├── packages/
│   ├── domain/                  # canonical entities per vertical, money, state machines — pure
│   ├── db/                      # Drizzle schemas (control-plane + tenant), fan-out migration runner
│   ├── supplier-sdk/            # adapter interfaces per vertical + JSON/XML/SOAP codecs + contract harness
│   ├── adapters/
│   │   ├── hotel/tbo/  hotel/ratehawk/  hotel/hotelbeds/
│   │   ├── air/mystifly/        # or air/tbo-air per consolidator choice
│   │   └── ground/hotelbeds-transfers/  ground/hotelbeds-activities/
│   ├── sandbox-replay/          # records live sandbox traffic (JSON+XML), replays in CI
│   ├── fiscal-sa/               # ZATCA module behind FiscalRegime interface
│   ├── connectors/              # traacs/, accounting/, hrm/, crm/
│   └── ui/                      # RTL-aware kit wrapping Modernize (MUI)
├── apps/
│   ├── api/                     # NestJS monolith — modules: hotel-search, hotel-booking,
│   │                            #   air-search, air-booking, ground-search, ground-booking,
│   │                            #   package-composer, pricing, ledger, payments, documents,
│   │                            #   tenancy, notifications
│   ├── worker/                  # BullMQ processors
│   ├── dashboard/               # Internal Dashboard shell + app modules (b2b, corporate,
│   │                            #   finance, api-access, storefront-admin, crm, desk, contracting)
│   ├── portal-agent/  portal-corporate/  storefront-b2c/  platform-admin/
└── e2e/                         # Playwright vs recorded sandbox replays
```

## Engineering conventions
- TS strict + `noUncheckedIndexedAccess`; ESLint with the module-boundary rule (an app may
  not import another app; adapters may not import engine modules; nothing imports an
  adapter except the supplier registry).
- Conventional commits; PR per package-scoped task; branch naming `m<NN>/<package>-<task>`.
- Worktrees under the repo for parallel agent sessions.
