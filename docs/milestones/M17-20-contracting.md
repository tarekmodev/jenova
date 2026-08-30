# M17–20 — Contracting app: own inventory (months 17–20)

**Goal:** the deepest app and the DMC-tenant revenue driver — tenants load their own
negotiated hotel contracts and sell them beside aggregator content. Spec:
[docs/apps/contracting.md](../apps/contracting.md). Four months because contract
modeling is intricate and allotment correctness is money.

## Deliverables
- [ ] **Contract model**: property (canonical ID), seasons/date bands, room types +
      occupancy rules, rate plans (net/sell, board basis), child policies, market/
      nationality restrictions, currency; versioning (past bookings keep their terms);
      lifecycle draft → active → expired.
- [ ] **Allotments**: per-day per-room-type inventory; release periods with automatic
      return; shared vs exclusive; overbooking tolerance; low-allotment alerts.
- [ ] **Stop-sales**: instant, per property/room/date-range; cache invalidation on save
      (effective in search within seconds); pending offers for stopped dates fail
      `check` cleanly.
- [ ] **Offers/promotions**: early-bird, free-night (7=6), long-stay; combinability.
- [ ] **Internal adapter**: the contract store implements the HotelSupplierAdapter
      contract — search reads contracts/allotments/stop-sales, `check` re-verifies,
      `book` decrements **atomically with the booking-item transition**, `cancel`
      restores per release rules. Same markup engine, state machine, ledger, documents.
- [ ] **Contracting UI** (dashboard): contract editor, inventory calendar with pickup
      view, stop-sale board, promotion editor.
- [ ] Direct-contract results badged in portals; Contracting data in Data Vault scope.
- [ ] Platform Admin: contracting adoption metrics; allotment-integrity monitor.

## Agent workstreams
1. **contract model + editor UI**.
2. **allotment engine** (❗human review — atomic decrement/restore is oversell
   protection; concurrency tests are the deliverable).
3. **internal adapter + search integration**.
4. **promotions + calendar + badging**.

## Tarek
- Design partner: one DMC-type tenant with real contracts to model against (their
  contract PDFs are the fixture source — no fabricated contracts). Review allotment PRs.

## Acceptance gate
A DMC tenant's contracted Makkah allotment sells through its Agent Portal beside TBO
rates; a stop-sale takes effect in seconds; month-end allotment ledger
(sold/released/remaining) reconciles with bookings exactly; concurrent-booking tests
show zero oversell. The eight-app catalog is complete.
