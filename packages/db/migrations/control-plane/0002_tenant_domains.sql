-- 0002_tenant_domains — host → tenant binding for the gateway's tenant
-- resolution stage (M2 issue #95; docs/02-architecture.md: tenant resolution
-- happens BEFORE authentication, so realm lookup knows whose user store).
--
-- EXPAND-ONLY: one new table. A tenant may bind many hosts (dashboard host,
-- agent-portal host, storefront domains); a host belongs to exactly one
-- tenant — the UNIQUE constraint is the isolation guarantee.

create table tenant_domain (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  -- Normalized before insert AND lookup: lowercase, no port (the gateway's
  -- normalizeHost); enforced here so no un-normalized row can ever match.
  host text not null unique check (host = lower(host) and host !~ ':'),
  created_at timestamptz not null default now()
);

create index tenant_domain_tenant_ix on tenant_domain (tenant_id);
