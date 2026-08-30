-- 0005_tenant_staff — EXPAND-ONLY (two new tables; nothing existing changes).
--
-- Tenant staff for the Internal Dashboard (tenant_staff realm, docs/08):
-- per-tenant user store with argon2id password hashes and TOTP secrets
-- stored ONLY as encrypted blobs + the id of the key that encrypted them —
-- plaintext secret columns do not exist (same discipline as
-- supplier_account, proven by the tenant-schema integration test).
--
-- staff_policy is a one-row table (id = 1 enforced) carrying the
-- tenant-wide "enforce TOTP" switch: docs/08 "TOTP 2FA enforceable by
-- tenant policy".
--
-- Runtime grants: 0002's ALTER DEFAULT PRIVILEGES gives jenova_runtime
-- plain CRUD on these tables automatically; neither is append-only.

create table staff_user (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  role text not null,
  status text not null default 'active'
    constraint staff_user_status check (status in ('active', 'disabled')),
  password_hash text not null,
  totp_secret_encrypted bytea,
  totp_secret_key_id text,
  totp_pending_secret_encrypted bytea,
  totp_pending_secret_key_id text,
  totp_enrolled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- An encrypted secret and its key id travel together, both slots.
  constraint staff_user_totp_secret_pair
    check ((totp_secret_encrypted is null) = (totp_secret_key_id is null)),
  constraint staff_user_totp_pending_pair
    check ((totp_pending_secret_encrypted is null) = (totp_pending_secret_key_id is null)),
  -- Enrolled means an active secret exists (and vice versa).
  constraint staff_user_totp_enrolled_pair
    check ((totp_enrolled_at is null) = (totp_secret_encrypted is null))
);

create table staff_policy (
  id integer primary key default 1 constraint staff_policy_singleton check (id = 1),
  enforce_totp boolean not null default false,
  updated_at timestamptz not null default now()
);
