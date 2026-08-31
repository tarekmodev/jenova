# M2 — First supplier certified + B2B app alpha (month 2)

**Goal:** humans can use it: the Internal Dashboard shell exists, the B2B app's Agent
Portal books real sandbox hotels, bilingual from the first screen. TBO certification
submitted.

## Deliverables
- [x] `ui` package v1: Modernize (MUI) wrapped with Jenova theming; RTL/LTR switch;
      core primitives (layout, tables, forms, toasts, empty/error states) — the only UI
      import for dashboard-class apps.
- [x] **Dashboard shell** (`apps/dashboard`): login (tenant-staff realm), app-framework
      navigation driven by entitlements, Settings v1 (users & roles, supplier accounts
      with test-connection, branding basics), core workspace v1 (bookings list/detail
      from AuditEvents, search console v1).
- [ ] **B2B app v1 (staff side)**: agency CRUD, portal-user management, markup-profile
      assignment (rules editor arrives M3).
- [ ] **Agent Portal alpha** (`apps/portal-agent`): agency login, streaming hotel search
      (SSE), offer detail with normalized cancellation policy, check→book flow, booking
      list/detail, cancellation with fee preview.
- [ ] **Documents v1** (`api/documents`): bilingual voucher PDF (Typst), branded per
      tenant; email delivery (mailpit in dev).
- [ ] **Platform Admin v1** (`apps/platform-admin`, separate realm): tenant list +
      provisioning, app entitlement switchboard, supplier catalog with certification
      status, health page.
- [ ] i18n infrastructure: ar/en message catalogs, RTL e2e screenshot checks.
- [x] TBO certification run: the automated certification report generated from the live
      contract suite; submission package sent. (Report live-CERTIFIABLE at
      `docs/certification/tbo.md`; package at `docs/certification/tbo-submission.md` —
      forwarding it to TBO is Tarek's step.)

## Agent workstreams
1. **ui package** (needs Modernize files from Tarek first).
2. **dashboard shell + settings**.
3. **portal-agent** — search→book UX.
4. **documents + platform-admin v1**.

## Tarek
- Deliver Modernize files (gate for workstream 1). Submit TBO certification. Review
  auth-related PRs.

## Acceptance gate
A real TBO sandbox hotel is booked and cancelled **from the Agent Portal**, in Arabic and
in English; the voucher PDF renders correctly RTL; Platform Admin can provision a fresh
tenant and entitle apps; certification submitted.
