-- 0004_booking_engine — booking transition runner + pending-confirmation
-- worker state (M1 issues #66/#68).
--
-- EXPAND-ONLY (CLAUDE.md rule 1): additive columns (nullable or defaulted)
-- and one new table, so code N−1 — which never reads or writes any of this —
-- keeps running on schema N. Fan-out safe: no locks beyond the instant
-- ALTERs, no data rewrites (Postgres fast default for poll_attempts).

alter table booking_item
  -- Set by the runner when the item enters pending_confirmation: the instant
  -- the wait began. Escalation age is measured from here, never from
  -- updated_at (which every poll-bookkeeping write would reset).
  add column pending_since timestamptz,
  -- Async supplier cancellation in flight (e.g. TBO CancellationInProgress):
  -- the cancel was accepted supplier-side but has not settled to Cancelled.
  -- The item KEEPS its state (no extra state machine state); the worker polls
  -- retrieve() until the supplier reports cancelled, then transitions through
  -- the runner. Penalty postings use the policy resolved AT THIS instant —
  -- the fee quoted to the buyer when cancellation was requested.
  add column cancellation_requested_at timestamptz,
  -- Worker poll bookkeeping (no audit events — pure scheduling state).
  add column poll_attempts integer not null default 0,
  add column next_poll_at timestamptz,
  -- Escalation: automation gave up (max pending age exceeded, or an operator
  -- rule fired). Surfaces the item in the core-workspace manual-intervention
  -- queue; an escalated item is never auto-polled again until an operator
  -- clears the flag. Append-style: set once by the runner with an AuditEvent.
  add column escalated_at timestamptz,
  add column escalation_reason text;

-- The worker's due-item scans (state ix exists since 0001).
create index booking_item_next_poll_ix on booking_item (next_poll_at)
  where escalated_at is null;
create index booking_item_pending_cancel_ix on booking_item (cancellation_requested_at)
  where cancellation_requested_at is not null;
create index booking_item_escalated_ix on booking_item (escalated_at)
  where escalated_at is not null;

-- Outbox-light domain events (issue #66). Every transition INSERTs its
-- events in the same transaction that moves state and posts the ledger; the
-- post-commit dispatcher publishes them and stamps published_at. A crash
-- between commit and publish leaves the row unpublished — visible, durable,
-- re-dispatched by the worker sweep. Chosen over a bare post-commit hook
-- because event emission on the money path must survive process death;
-- chosen over a full broker because M1 has only in-process consumers.
create table booking_event (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references booking(id) on delete cascade,
  booking_item_id uuid references booking_item(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  published_at timestamptz
);

create index booking_event_unpublished_ix on booking_event (occurred_at)
  where published_at is null;
create index booking_event_booking_ix on booking_event (booking_id);

-- No new grants needed: 0002's ALTER DEFAULT PRIVILEGES gives jenova_runtime
-- CRUD on tables created by later owner-run migrations, and booking_event is
-- an outbox (insert + publish-stamp update), not an append-only ledger.
