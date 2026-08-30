# M3 — Money is real (month 3)

**Goal:** two suppliers deduped in one search; agencies book against credit; a real
payment gateway takes top-ups; finance numbers reconcile.

## Deliverables
- [ ] **RateHawk adapter** (`adapters/hotel/ratehawk`): full contract suite + recordings;
      certification submitted. Fan-out now truly parallel: budgets, partial results,
      per-supplier circuit breakers exercised with two live suppliers.
- [ ] **Hotel mapping**: mapping-service integration (Vervotech or GIATA — per contract
      Tarek signs); canonical property IDs drive dedup (cheapest-per-basis with
      alternatives); back-office mapping-override queue in the dashboard.
- [ ] **Credit engine**: agency credit limit / prepaid deposit; reserve places a hold,
      confirm converts to receivable, cancel releases per policy; the credit **gate**
      wired into the booking path for the agent-portal surface.
- [ ] **Markup rules editor** (Settings): ordered rules with scope preview ("which rule
      fires?"); rule audit on Offer surfaced in booking detail.
- [ ] **Payments v1** (`api/payments`): gateway abstraction + first implementation
      (Moyasar or HyperPay per Tarek's onboarding): hosted-page top-ups for agencies;
      webhook handling; postings to ledger; reconciliation view.
- [ ] **Finance app v1**: receivables & aging, agency statements (generate + deliver),
      manual journal with maker-checker, period locks.
- [ ] **Agent Portal**: credit dashboard (balance, holds, statements); top-up flow.
- [ ] **Platform Admin**: supplier health boards (latency/error/look-to-book per
      supplier per tenant); mapping-queue oversight.
- [ ] Booking-failure manual-intervention queue v1 (core workspace) with allowed-action
      derivation from the state machine.

## Agent workstreams
1. **adapter-ratehawk** + fan-out hardening.
2. **mapping** — service integration + override queue.
3. **credit + payments** (❗human review on every PR).
4. **finance app v1 + statements**.

## Tarek
- Sign mapping-service contract (budget item). Complete PSP onboarding (merchant
  account). Submit RateHawk certification. Review all credit/payment/ledger PRs.

## Acceptance gate
A two-supplier search returns deduped results; an agency with insufficient credit is
blocked with the exact shortfall, tops up via the real gateway (sandbox), books; the
statement and aging report reconcile to journal entries to the halala; ledger-invariant
checker green in staging for the whole month's activity.
