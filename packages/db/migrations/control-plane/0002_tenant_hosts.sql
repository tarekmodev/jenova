-- 0002_tenant_hosts — EXPAND-ONLY (new table; nothing existing changes).
--
-- Host → tenant binding for the gateway's tenant-resolution stage
-- (docs/08-security.md: tenant resolution happens BEFORE authentication).
-- One tenant serves many hosts (dashboard, portals, storefront domains);
-- every host belongs to exactly one tenant. Hosts are stored normalized —
-- lowercase, no port — exactly the form the gateway's normalizeHost
-- produces, and the check below refuses anything else so a badly seeded
-- row can never make a live host unroutable-but-present.

create table tenant_host (
  host text primary key
    constraint tenant_host_normalized check (host = lower(host) and host !~ '[:\s]' and host <> ''),
  tenant_id uuid not null references tenant (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index tenant_host_tenant_ix on tenant_host (tenant_id);
