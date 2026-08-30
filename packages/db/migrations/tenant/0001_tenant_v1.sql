-- 0001_tenant_v1 — tenant schema v1 (issue #19). Every tenant database gets
-- exactly this schema. Expand-contract from here on: later migrations only
-- add; renames/drops wait until no running code (N-1 included) reads the old
-- shape.
--
-- Money is integers everywhere: bigint minor units + ISO 4217 code.

-- The tenant's OWN supplier credentials (Jenova never holds supplier credit).
-- Secrets are an encrypted blob + the encrypting key's id — no plaintext columns.
create table supplier_account (
  id uuid primary key default gen_random_uuid(),
  supplier_code text not null,
  environment text not null check (environment in ('sandbox', 'production')),
  enabled boolean not null default true,
  secrets_encrypted bytea not null,
  secrets_key_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_account_code_env_key unique (supplier_code, environment)
);

create table agency (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  credit_limit_amount bigint check (credit_limit_amount >= 0),
  credit_currency char(3) check (credit_currency ~ '^[A-Z]{3}$'),
  payment_terms_days integer check (payment_terms_days >= 0),
  allowed_currencies jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- a credit limit is Money: amount and currency travel together
  constraint agency_credit_limit_is_money check ((credit_limit_amount is null) = (credit_currency is null))
);

create table agency_user (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references agency(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  role text not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now()
);

create index agency_user_agency_ix on agency_user (agency_id);

-- Ordered, most-specific-wins (docs/03): scope columns are all nullable —
-- null means "any". value is basis points for percent rules, minor units for
-- fixed/per-night/per-pax rules (which then require a currency).
create table markup_rule (
  id uuid primary key default gen_random_uuid(),
  priority integer not null,
  agency_id uuid references agency(id) on delete cascade,
  channel text check (channel in ('b2b', 'corporate', 'b2c', 'api', 'internal')),
  vertical text check (vertical in ('hotel', 'air', 'ground', 'package')),
  supplier_code text,
  destination text,
  travel_from date,
  travel_to date,
  value_type text not null check (value_type in ('percent', 'fixed', 'per_night', 'per_pax')),
  value bigint not null,
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  commission_split_bps integer check (commission_split_bps between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint markup_rule_value_is_money check ((value_type = 'percent') = (currency is null)),
  constraint markup_rule_date_band check (
    travel_from is null or travel_to is null or travel_from <= travel_to
  )
);

create index markup_rule_priority_ix on markup_rule (priority) where active;

-- Server-priced, short-lived, signed — the only bookable thing.
create table offer (
  id uuid primary key default gen_random_uuid(),
  supplier_code text not null,
  vertical text not null check (vertical in ('hotel', 'air', 'ground', 'package')),
  net_amount bigint not null check (net_amount >= 0),
  sell_amount bigint not null check (sell_amount >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  price_hash text not null,
  markup_rule_id uuid references markup_rule(id),
  policy_snapshot jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint offer_expires_after_creation check (expires_at > created_at)
);

create index offer_expires_ix on offer (expires_at);

-- Commercial container. client_reference is the caller's idempotency key.
create table booking (
  id uuid primary key default gen_random_uuid(),
  client_reference text not null unique,
  channel text not null check (channel in ('b2b', 'corporate', 'b2c', 'api', 'internal')),
  agency_id uuid references agency(id),
  total_amount bigint not null default 0,
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  payment_state text not null default 'unpaid'
    check (payment_state in ('unpaid', 'partially_paid', 'paid', 'refunded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index booking_agency_ix on booking (agency_id);

-- One product unit with its own supplier ref and state machine. The check
-- pins states to the domain BookingItemState values; transition legality is
-- the domain state machine's job (BOOKING_ITEM_TRANSITIONS).
create table booking_item (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references booking(id) on delete cascade,
  vertical text not null check (vertical in ('hotel', 'air', 'ground', 'package')),
  state text not null check (state in (
    'quoted', 'reserved', 'pending_confirmation', 'confirmed', 'issued',
    'amendment_pending', 'completed', 'cancelled', 'failed')),
  supplier_code text not null,
  supplier_account_id uuid references supplier_account(id),
  supplier_reference text,
  offer_id uuid references offer(id),
  net_amount bigint not null check (net_amount >= 0),
  sell_amount bigint not null check (sell_amount >= 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  policy_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index booking_item_booking_ix on booking_item (booking_id);
create index booking_item_state_ix on booking_item (state);

create table ledger_account (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now()
);

-- Double-entry journal. Immutable (triggers below) and balanced per
-- transaction group per currency, enforced at COMMIT by a deferred
-- constraint trigger. Deliberately no updated_at: there is no update path.
create table journal_entry (
  id uuid primary key default gen_random_uuid(),
  transaction_group_id uuid not null,
  account_id uuid not null references ledger_account(id),
  amount bigint not null check (amount <> 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  booking_id uuid references booking(id),
  booking_item_id uuid references booking_item(id),
  memo text,
  posted_at timestamptz not null default now()
);

create index journal_entry_group_ix on journal_entry (transaction_group_id);
create index journal_entry_account_ix on journal_entry (account_id);
create index journal_entry_booking_ix on journal_entry (booking_id);

-- Append-only audit trail (docs/03: B2B travel runs on disputes).
create table audit_event (
  id bigint generated always as identity primary key,
  actor_type text not null check (actor_type in ('platform_user', 'agency_user', 'system', 'api_client')),
  actor_id text,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  before jsonb,
  after jsonb,
  occurred_at timestamptz not null default now()
);

create index audit_event_entity_ix on audit_event (entity_type, entity_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Enforcement: append-only tables and the ledger balance invariant.
-- ---------------------------------------------------------------------------

create function jenova_forbid_mutation() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op;
end;
$$;

create trigger journal_entry_no_update
  before update on journal_entry
  for each row execute function jenova_forbid_mutation();
create trigger journal_entry_no_delete
  before delete on journal_entry
  for each row execute function jenova_forbid_mutation();
create trigger journal_entry_no_truncate
  before truncate on journal_entry
  for each statement execute function jenova_forbid_mutation();

create trigger audit_event_no_update
  before update on audit_event
  for each row execute function jenova_forbid_mutation();
create trigger audit_event_no_delete
  before delete on audit_event
  for each row execute function jenova_forbid_mutation();
create trigger audit_event_no_truncate
  before truncate on audit_event
  for each statement execute function jenova_forbid_mutation();

-- Every transaction group must balance to zero per currency by COMMIT.
create function jenova_assert_journal_balanced() returns trigger
language plpgsql as $$
declare
  unbalanced record;
begin
  select je.currency, sum(je.amount) as total
    into unbalanced
    from journal_entry je
   where je.transaction_group_id = new.transaction_group_id
   group by je.currency
  having sum(je.amount) <> 0
   limit 1;
  if found then
    raise exception 'transaction group % does not balance: % % off zero',
      new.transaction_group_id, unbalanced.total, unbalanced.currency;
  end if;
  return null;
end;
$$;

create constraint trigger journal_entry_balanced
  after insert on journal_entry
  deferrable initially deferred
  for each row execute function jenova_assert_journal_balanced();
