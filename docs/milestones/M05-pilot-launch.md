# M5 — Pilot launch, hotels GA (month 5)

**Goal:** production is real. 1–3 pilot tenants at founder pricing; their agents book
real, paid hotel stays. **Revenue starts here.**

## Deliverables
- [ ] **Hardening sweep**: load tests (k6 against replay-backed supplier layer) to 20×
      expected pilot traffic; slow-supplier and supplier-down failover drills; chaos
      pass on the saga compensation paths using real failure recordings.
- [ ] **Security pass**: external pen test on auth realms, payment flows, offer-token
      integrity, tenant isolation (attempt cross-tenant access with valid credentials);
      all highs fixed before go-live.
- [ ] **Observability**: production dashboards + alert rules (supplier error spikes,
      saga failures, ZATCA failures, webhook backlog, queue depth); on-call runbook
      (docs/10) finalized.
- [ ] **Backups proven**: per-tenant restore drill executed on staging from production
      snapshots.
- [ ] **Production cutover**: production environment via Terraform; tenants' own
      production supplier credentials connected (TBO/RateHawk certified; Hotelbeds if
      certification landed); gateway production keys; ZATCA production CSIDs for Saudi
      pilots.
- [ ] Pilot onboarding: white-glove but scripted — every manual step recorded as a gap
      to automate before M14 GA.
- [ ] Support loop: shared inbox + audited impersonation for diagnosis; issue → fix →
      deploy cadence (daily during pilot weeks).

## Agent workstreams
1. **load + chaos** (k6, drills, fixes).
2. **alerting + runbooks**.
3. **gap-fixing** from pilot feedback (continuous).

## Tarek
- Sign pilot tenants (target: agencies already holding TBO/RateHawk accounts).
- Commission the pen test. Founder-pricing decision. Daily pilot check-ins.
- **Start flight-consolidator commercial discussions now** (agreement must be signed by
  ~M7 to protect M10).

## Acceptance gate
A pilot tenant's sub-agents book real, paid hotel stays in production; a full week
passes with no manual ledger correction; every pilot issue has a ticketed root cause.
The platform is earning.
