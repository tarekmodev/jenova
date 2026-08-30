# @jenova/db

Control-plane + tenant schemas, per-tenant database provisioning, the tenant
connection resolver, and the fan-out migration runner. **Database per tenant
is foundational** (docs/02-architecture.md): the control-plane database holds
platform-level data only; every tenant has its own Postgres database with an
identical schema.

## The only doors

```ts
import {
  connectControlPlane,   // control-plane data — typed over control-plane tables only
  createTenantDbResolver, // tenant data — THE only way in
  createTenantDatabase,   // provisioning (signup)
  runFanout,              // migrations, everywhere
} from "@jenova/db";

const controlPlane = connectControlPlane({ url: process.env.CONTROL_PLANE_DATABASE_URL! });
const resolver = createTenantDbResolver(controlPlane); // runtime creds from JENOVA_TENANT_RUNTIME_DSN
const db = await resolver.getTenantDb(tenantId); // branded TenantId only — raw strings don't compile
```

`getTenantDb` returns a Drizzle client typed over the tenant schema and
physically connected to that tenant's own database — cross-tenant access is
impossible, not merely forbidden. Raw pools/connections are never exported.
Pools are lazy, small (`prepare: false`, PgBouncer-compatible), and
LRU-capped.

## Two credentials, never mixed

The ledger/audit guarantees (append-only triggers, deferred balance check)
only bind a role that is **neither superuser nor the table owner** — an owner
can `ALTER TABLE … DISABLE TRIGGER USER` or `DROP TRIGGER`, and a superuser
can bypass triggers via `session_replication_role`. So the package separates:

| Path | Role | Credentials |
|------|------|-------------|
| Migrations, provisioning, fan-out | schema **owner** | `CONTROL_PLANE_DATABASE_URL` |
| Request path (the resolver) | **`jenova_runtime`** — least privilege | `JENOVA_TENANT_RUNTIME_DSN` |

`jenova_runtime` (provisioned idempotently by tenant migration
`0002_tenant_runtime_grants.sql`, so provisioning and the fan-out both apply
it) is `NOSUPERUSER NOCREATEDB NOCREATEROLE`, owns nothing, has no DDL, and
holds plain CRUD on ordinary tables but **SELECT + INSERT only** on
`journal_entry` and `audit_event` — append-only holds at the privilege level
even before the triggers fire. The resolver **refuses to start** without a
runtime DSN; it never falls back to owner credentials.

**One shared runtime role, not per-tenant roles**: database-per-tenant plus
the resolver already make cross-tenant access physically impossible, and a
single role keeps ops simple (one credential, one PgBouncer user, no
role-per-signup churn). The trade-off: a leaked runtime credential can reach
any tenant database (with runtime privileges only — no DDL, no ledger
rewrites). Revisit per-tenant roles at the dedicated-instance hosting tier.

`jenova_runtime` is created `NOLOGIN`; actual login credentials are a LOGIN
member role (`CREATE ROLE app LOGIN PASSWORD '…' IN ROLE jenova_runtime`)
minted by ops — **real staging/production credentials are wired in the
staging task (#34)**; the seam, role, and grants land here. Tests mint a
throwaway member per run. Owner/superuser access to tenant databases is a
break-glass, audited operational path — never the application path.

## Migrations

Hand-written SQL under `migrations/control-plane/` and `migrations/tenant/`,
named `NNNN_description.sql`, applied in filename order. Each database records
its own applied set (checksummed) in `_jenova_migrations` — applied files are
**immutable**; edits are detected and refused.

### Expand-contract — the rule every migration must obey

Code version N−1 must run correctly against schema version N, because the
fan-out applies schema before (and independently of) each deploy, across many
databases. Concretely:

- **Expand** (any time): add tables, add nullable-or-defaulted columns, add
  indexes (`concurrently` once tables are big), add constraints as
  `not valid` + `validate` later.
- **Never in the same release as code that still reads the old shape**:
  renames, drops, type changes, tightening `not null`. Ship the new shape,
  migrate readers/writers, and only **contract** (drop the old shape) once no
  running code version references it.
- A migration that cannot fan out safely (locks a hot table for minutes,
  breaks N−1 readers) is a wrong migration — redesign it; do not merge it.

### Fan-out runner

```
pnpm --filter @jenova/db migrate:fanout            # dry-run: per-database pending report
pnpm --filter @jenova/db migrate:fanout -- --apply # control-plane + every tenant DB
```

Requires `CONTROL_PLANE_DATABASE_URL` (see `.env.example`). Guarantees:

- **Dry-run** performs zero writes.
- **Failure isolation**: tenant N failing never stops tenant N+1; the report
  shows per-tenant applied/pending/failed + error.
- **Resumable**: each migration commits and records individually, so a re-run
  skips everything already applied and continues at the first failure.
- Exit code is non-zero if any database failed.

Provisioning (`createTenantDatabase`) runs all tenant migrations at creation
time, so new tenants are always at head; the fan-out covers the existing
fleet when a new migration lands.

## Tests

Integration tests need the compose Postgres: `docker compose up -d postgres`.
They create throwaway databases per run (`jenova_test_*`, dropped afterwards)
and skip loudly when Postgres is unreachable. Override the server with
`JENOVA_TEST_PG_URL`. Per CLAUDE.md rule 5 there is **no fabricated business
data anywhere** — schema tests insert only minimal structural rows (ids,
codes, amounts) to prove constraints; empty tables are the point.
