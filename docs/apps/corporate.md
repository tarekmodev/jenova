# Corporate app — corporate clients as sub-tenants + Corporate Portal

A tenant serves companies whose employees book business travel. Gate:
**travel policy + approval workflow**, billed to the company account.

## Staff side (dashboard section)
- Corporate sub-tenant onboarding: company profile, account billing terms (monthly
  invoice, cost-center split), assigned markup profile (often net + service fee).
- Travel policy editor per corporate: hotel rate caps (by city), star limits, cabin-class
  caps, advance-booking rules, allowed verticals; out-of-policy handling = block or
  route-to-approval.
- Approval chains: by amount, by policy violation, by traveler grade; SLA reminders.
- Cost centers and traveler-grade management (or synced from HRM via connector).
- Travel-spend reporting: by cost center, department, traveler, route/city; export.

## Corporate Portal (external)
- **Traveler self-booking**: search shows policy-compliant options by default;
  out-of-policy visibly flagged with the reason; booking an out-of-policy option opens an
  approval request instead of confirming.
- **Arranger mode**: book on behalf of travelers from the company roster.
- **Approver view**: pending requests with policy context, one-tap approve/decline,
  delegation for absence.
- Traveler profiles: documents (passport/ID with expiry warnings), preferences,
  cost-center default.
- Billing to account: no card at checkout; each booking posts to corporate receivables
  with cost-center tags; monthly statement/invoice through the Finance app.

## Events
booking.* per corporate scope, approval.requested / granted / declined,
policy.violation.recorded — feeding webhooks, Data Vault, and HRM/ERP connectors.

## Acceptance heuristics
- An out-of-policy hotel booking cannot confirm without an approval record.
- Approver acts from the email/WhatsApp notification deep link in ≤3 taps.
- Cost-center totals in reports tie exactly to ledger postings.
