# Contracting app — own inventory

The deepest app in the catalog: the tenant loads its directly negotiated hotel contracts
and sells them side by side with aggregator content. The internal contract store is
**just another adapter** to the search fan-out — downstream booking flow is identical to
supplier inventory. Biggest revenue driver for DMC-type tenants.

## Dashboard section
- Contract editor: property (canonical ID), seasons/date bands, room types & occupancy
  rules, rate plans (net/sell, board basis), child policies, market/nationality
  restrictions, currency.
- Allotments: rooms per day per room type; release periods (auto-return N days before
  arrival); overbooking tolerance; shared vs exclusive allotments.
- Stop-sales: instant, per property/room type/date range; effective immediately in
  search (cache invalidation on save).
- Offers/promotions: early-bird, free-night (e.g. 7=6), long-stay discounts, with
  combinability flags.
- Inventory calendar: availability + pickup view per property; low-allotment alerts.
- Contract lifecycle: draft → active → expired; versioning so past bookings keep their
  contracted terms.

## Engine integration (internal adapter)
- Implements the same adapter contract as external suppliers: search reads
  contracts/allotments/stop-sales; `check` re-verifies allotment; `book` decrements
  allotment atomically; `cancel` restores it per release rules.
- Offers priced through the same markup engine (contract net → sell), and bookings run
  the same state machine, ledger postings, and documents.

## Invariants
- Allotment decrement/restore is transactional with the booking-item transition — no
  oversell within Jenova's control; supplier-grade `sold_out` errors when empty.
- A stop-sale takes effect in search within seconds, and pending offers for stopped
  dates fail `check` cleanly.

## Acceptance heuristics
- A contracted Makkah allotment sells through the Agent Portal alongside TBO rates and
  is visually indistinguishable in flow (only badged as "direct contract").
- Month-end: allotment ledger (sold/released/remaining) reconciles with bookings exactly.
