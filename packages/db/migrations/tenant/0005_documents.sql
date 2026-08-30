-- 0005_documents — documents v1: voucher rendering + delivery (M2 issues
-- #99/#100).
--
-- EXPAND-ONLY (CLAUDE.md rule 1): additive nullable columns and two new
-- tables; code N−1 never reads or writes any of this. Fan-out safe: instant
-- ALTERs, no data rewrites, no long locks.

alter table offer
  -- Hotel display facts captured from the supplier's search/check payload at
  -- issue time (canonical BoardBasis / verbatim supplier room name — the
  -- voucher's source of truth for what was sold). Nullable: pre-0005 offers
  -- never carried them; documents degrade gracefully for those rows.
  add column board_basis text,
  add column supplier_room_name text;

alter table booking_item
  -- Holder + per-room guest names captured at booking creation — the ONLY
  -- place this data exists after the supplier call returns (vouchers and
  -- delivery need the names and the holder's email long after book()).
  -- Shape: { holder: {firstName,lastName,email,phone},
  --          rooms: [{ guests: [{firstName,lastName,age?}] }] }.
  add column guests jsonb;

-- One rendered artifact per (booking item, kind, locale): re-rendering
-- replaces the pointer (deterministic renders produce identical bytes, so a
-- replace is a no-op in content). storage_key addresses the object store;
-- content_sha256 pins the exact bytes for audit and byte-stability checks.
create table document (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references booking(id) on delete cascade,
  booking_item_id uuid not null references booking_item(id) on delete cascade,
  kind text not null,
  locale text not null,
  storage_key text not null,
  content_sha256 text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index document_item_kind_locale_key
  on document (booking_item_id, kind, locale);
create index document_booking_ix on document (booking_id);

-- Delivery bookkeeping for the worker's confirm-event consumer: one row per
-- consumed booking_event (the UNIQUE claim is the at-least-once dedup — two
-- racing sweeps insert once, deliver once). Retries with backoff live here;
-- terminal failure flips state to 'failed' AND escalates the booking item
-- into the manual-intervention queue.
create table document_delivery (
  id uuid primary key default gen_random_uuid(),
  booking_event_id uuid not null unique references booking_event(id) on delete cascade,
  booking_item_id uuid not null references booking_item(id) on delete cascade,
  document_id uuid references document(id) on delete set null,
  channel text not null,
  recipient text not null,
  state text not null default 'pending'
    constraint document_delivery_state_chk check (state in ('pending', 'sent', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index document_delivery_due_ix on document_delivery (next_attempt_at)
  where state = 'pending';
create index document_delivery_item_ix on document_delivery (booking_item_id);

-- No new grants needed: 0002's ALTER DEFAULT PRIVILEGES gives jenova_runtime
-- CRUD on tables created by later owner-run migrations.
