# B2B app — trade distribution + Agent Portal

The flagship app: a tenant distributes inventory to sub-agent travel agencies who book to
resell. Gate: **credit limit / deposit balance**.

## Staff side (dashboard section)
- Agency management: onboarding, KYC docs, status (active/hold), allowed currencies.
- Credit terms per agency: credit limit or prepaid deposit; hold/release rules;
  statement cycle. Balances read from the ledger, never recomputed.
- Markup/discount profile assignment per agency (rules live in Settings; assignment here).
- Agency statements: transactions, aging, exportable; top-up recording (gateway or manual
  with maker-checker).
- Per-agency portal user management + sub-user roles.

## Agent Portal (external, Arabic-first RTL)
- Login with agency scoping; dashboard: credit balance, recent bookings, alerts.
- **Search**: multi-room/multi-pax hotel search (ground/air/packages as those verticals
  land) with streaming results (SSE), nationality defaulted per agency and always visible,
  filters, cheapest-per-basis display with alternatives.
- **Offer → check → gate → book**: price revalidation before booking; on price change the
  agent re-approves. Credit gate: insufficient credit blocks with a clear message and a
  top-up path.
- Quote baskets → bilingual client-facing quote PDF (agency's branding).
- Booking management: list/detail, vouchers, amendments and cancellation with fee preview
  (from the normalized cancellation policy), traveler edits where the supplier allows.
- Credit dashboard: balance, holds, statement download.
- Sub-user management within the agency.

## Events → webhooks/connectors
booking.confirmed / cancelled / amended, credit.hold / release / topup — all emitted per
sub-tenant scope.

## Acceptance heuristics
- An agent completes search → book in under 90 seconds on a mid-range phone.
- Credit math always ties to ledger postings; a blocked booking names the exact shortfall.
- Every screen fully usable in Arabic RTL and English LTR.
