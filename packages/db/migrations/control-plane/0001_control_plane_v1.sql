-- 0001_control_plane_v1 — control-plane schema v1 (issue #18).
-- Platform-level data only: tenants, entitlements, platform users, supplier catalog.
-- Expand-contract from here on: later migrations only add; renames/drops wait
-- until no running code (N-1 included) reads the old shape.

create table tenant (
  id uuid primary key default gen_random_uuid(),
  -- slug forms the tenant database name (jenova_t_<slug>), so it must be a
  -- safe identifier fragment: lowercase, short, no punctuation.
  slug text not null unique check (slug ~ '^[a-z][a-z0-9_]{1,45}$'),
  name text not null,
  branding jsonb not null default '{}'::jsonb,
  base_currency char(3) not null check (base_currency ~ '^[A-Z]{3}$'),
  vat_number text,
  fiscal_country char(2) check (fiscal_country ~ '^[A-Z]{2}$'),
  -- reference into the secret store; ZATCA credentials themselves never land in a table
  zatca_credentials_ref text,
  hosting_tier text not null default 'standard'
    check (hosting_tier in ('standard', 'dedicated', 'private')),
  db_name text unique,
  created_at timestamptz not null default now()
);

create table app_installation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenant(id) on delete cascade,
  app_key text not null check (app_key in
    ('b2b', 'corporate', 'finance', 'api_access', 'storefront', 'crm', 'desk', 'contracting')),
  config jsonb not null default '{}'::jsonb,
  plan text not null default 'standard',
  installed_at timestamptz not null default now(),
  unique (tenant_id, app_key)
);

create index app_installation_tenant_ix on app_installation (tenant_id);

create table platform_user (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  role text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);

create table supplier_catalog_entry (
  id uuid primary key default gen_random_uuid(),
  supplier_code text not null unique,
  name text not null,
  vertical text not null check (vertical in ('hotel', 'air', 'ground', 'package')),
  certification_sandbox text not null default 'not_started'
    check (certification_sandbox in ('not_started', 'in_progress', 'certified', 'suspended')),
  certification_production text not null default 'not_started'
    check (certification_production in ('not_started', 'in_progress', 'certified', 'suspended')),
  created_at timestamptz not null default now()
);
