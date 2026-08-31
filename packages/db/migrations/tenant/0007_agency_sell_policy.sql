-- 0007_agency_sell_policy — sell-side cancellation-policy snapshots
-- (PR #107 review H1: the adapter-normalized policy carries NET penalty
-- amounts — commercially confidential; anything the agency realm sees must
-- carry penalties re-expressed on the SELL side, derived at pricing time).
--
-- EXPAND-ONLY (CLAUDE.md rule 1): nullable jsonb columns; code N−1 never
-- reads them, and readers fall back to deriving the sell-side view from the
-- stored net policy + persisted net/sell amounts for pre-0007 rows.
-- policy_snapshot stays the NET truth for supplier settlement and ledger
-- penalty postings.

alter table offer
  add column sell_policy_snapshot jsonb;

alter table booking_item
  add column sell_policy_snapshot jsonb;
