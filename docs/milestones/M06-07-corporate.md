# M6–7 — Corporate app (months 6–7)

**Goal:** tenants serve corporate clients as sub-tenants: policies, approvals, a
Corporate Portal, account billing. Spec: [docs/apps/corporate.md](../apps/corporate.md).

## Deliverables
- [ ] **Corporate sub-tenant model**: CorporatePartner entity + users (traveler,
      arranger, approver roles), cost centers, traveler grades, account billing terms.
- [ ] **TravelPolicy engine** (pure, heavily unit-tested): rate caps by city, star
      limits, advance-booking rules, allowed verticals; violation → block or
      route-to-approval per policy; evaluated at the gate, result stored on the booking.
- [ ] **ApprovalFlow engine**: chains by amount/violation/grade; notifications with
      deep links (email + WhatsApp); delegation; SLA reminders; approval record required
      before an out-of-policy confirm.
- [ ] **Corporate Portal** (`apps/portal-corporate`): traveler self-booking with
      policy-compliant defaults and flagged out-of-policy options; arranger mode from
      the roster; approver view (approve/decline ≤3 taps from notification); traveler
      profiles with document expiry warnings.
- [ ] **Corporate staff side** (dashboard): onboarding, policy editor, approval-chain
      editor, cost-center management, travel-spend reporting (by cost center/
      department/traveler/city) tied to ledger postings.
- [ ] **Account billing**: bookings post to corporate receivables with cost-center tags;
      monthly statement/invoice generation through the Finance app; corporate aging.
- [ ] **Platform Admin**: corporate hierarchy drill-down; policy/approval templates.
- [ ] Events: approval.requested/granted/declined, policy.violation.recorded → webhooks.

## Agent workstreams
1. **policy + approval engines** (pure logic first — property tests on policy evaluation).
2. **portal-corporate**.
3. **corporate staff side + reporting**.
4. **account billing** (❗human review — ledger paths).

## Tarek
- Recruit one pilot tenant with a real corporate client for the gate. Review billing
  PRs. Flight-consolidator agreement signed this window (protects M10).

## Acceptance gate
A pilot tenant onboards a real corporate client: an employee's out-of-policy hotel
booking routes to their approver (notification deep link), the approved booking bills
to the company account with the right cost center, and the monthly corporate statement
reconciles to the ledger.
