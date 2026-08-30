-- 0003_offer_store — offer-store columns (M1 issue #64).
--
-- EXPAND-ONLY (CLAUDE.md rule 1): every column is nullable, so code N−1 —
-- which never reads or writes these columns — keeps running on schema N.
-- The offers service enforces presence on every NEW row it writes; a later
-- contract migration may tighten to NOT NULL once no pre-M1 writer exists.
-- Existing rows are ephemeral anyway: offers live for minutes by design.
--
-- No new grants: 0002 already gave jenova_runtime CRUD on `offer`, and
-- column additions inherit table-level privileges.

alter table offer
  -- Opaque supplier-side token that `check` revalidates and `book` consumes.
  -- The engine treats it as opaque; it never crosses to clients unsigned.
  add column supplier_offer_token text,
  -- Canonical property id (mapping service) — anchors dedup across suppliers.
  add column canonical_property_id text,
  -- Nationality the price applies to (first-class in the GCC, CLAUDE.md rule 9).
  add column nationality char(2)
    constraint offer_nationality_iso check (nationality is null or nationality ~ '^[A-Z]{2}$'),
  -- Occupancy summary the offer was priced for: [{adults, childAges}] per room.
  add column occupancy jsonb,
  -- Exact PriceBreakdown that produced sell_amount (audit trail of HOW).
  add column breakdown jsonb,
  -- PricingContext the markup resolution ran with — replayed verbatim when a
  -- `check` price change forces a re-price into a successor offer.
  add column pricing_context jsonb,
  -- Set when `check` revalidated this offer against the supplier; booking
  -- requires a recent check (bookable window enforced in the service).
  add column checked_at timestamptz,
  -- Set when the offer was withdrawn: superseded by a re-priced successor,
  -- or killed by a supplier sold_out. An invalidated offer is never bookable.
  add column invalidated_at timestamptz;
