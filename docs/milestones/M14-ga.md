# M14 — Commercial GA (month 14)

**Goal:** the booking platform is complete and sells itself: public pricing, self-service
onboarding end-to-end, and operations that don't need Tarek in the loop per step. The
remaining catalog apps (CRM, Desk, Contracting) continue after GA while tenants onboard.

## Deliverables
- [ ] **Self-service onboarding**: every manual step recorded since M5 automated —
      signup → plan/app selection → provisioning → Settings wizard → supplier
      connection checklists → first booking verification, with no Jenova involvement;
      white-glove remains an option, not a requirement.
- [ ] **Public pricing & billing**: plan/app pricing published; platform billing
      (metering → ZATCA-compliant invoices → dunning → auto-suspension rules) fully
      automated in Platform Admin.
- [ ] **Docs portal GA**: Partner API documentation site (from OpenAPI), integration
      guides per supplier connection, tenant admin guides (ar/en).
- [ ] **SLA & status**: uptime monitoring with public status page; SLA definitions per
      plan; incident process (docs/10) exercised in a drill.
- [ ] **Second security pass**: pen test covering everything since M5 (corporate
      approvals, air ticketing, packages, API-out at scale).
- [ ] **Performance certification**: load test at 10× current production; search P95
      targets held per vertical.
- [ ] Sales assets: demo tenant with realistic (recorded-sandbox-sourced) content,
      guided demo script.

## Agent workstreams
1. **onboarding automation** (the M5 gap list is the spec).
2. **billing automation + status/SLA**.
3. **docs portal + guides**.
4. **hardening fixes** from pen test/load test.

## Tarek
- Pricing decisions; GA announcement + pipeline; commission pen test; SLA terms with a
  lawyer; hire decision (support/ops first — pilot revenue funds it).

## Acceptance gate
A tenant Jenova has never spoken to signs up, pays, provisions, connects its own
supplier account, and takes its first production booking — with zero personal
involvement in any step. Billing invoices generate and deliver automatically.
