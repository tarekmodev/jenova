# M4 — App suite live, hotels (month 4)

**Goal:** every launch surface sells the same hotel: B2C storefront with real payment
methods, Partner API with keys and metering, Finance app issuing ZATCA-cleared invoices,
and tenant provisioning that runs without hand-holding.

## Deliverables
- [ ] **B2C Storefront app**: storefront-admin (theming, custom domain + TLS automation,
      bilingual content pages, B2C markup profile) + consumer site (SSR search/detail/
      checkout, guest-first, account area) + payment capture (mada, Apple Pay, cards via
      tenant's gateway; 3DS; capture-vs-book failure compensation path).
- [ ] **API Access app**: key issuance (tenant/sub-tenant scope, environment,
      verticals), HMAC auth, idempotency, rate limits + quotas, usage metering
      dashboards, webhook subscriptions with signing/retries/delivery log, OpenAPI spec
      generated from contracts, docs portal with try-it console.
- [ ] **fiscal-sa v1** (ZATCA Phase 2): UBL 2.1 generation, XAdES signing with tenant
      CSIDs, B2B clearance + B2C reporting flows against the ZATCA sandbox, TLV QR on
      invoice PDFs, XML archive; Settings wizard for CSID onboarding; clearance-failure
      queue.
- [ ] **Invoices in Finance app**: issue/void→credit-note, ZATCA status per document,
      VAT report v1.
- [ ] **Tenant provisioning flow**: Platform Admin one-click provision → tenant Settings
      wizard ("connect your suppliers" checklists per aggregator) → first sandbox
      booking verification; **Hotelbeds adapter started** (certification is the long
      pole — target ready by M5).
- [ ] **Platform billing v1** (Platform Admin): metering (SaaS, per-app, per-booking) +
      Jenova's own ZATCA-compliant invoices to tenants.
- [ ] Notifications service: email + WhatsApp Business templates (voucher/confirmation
      delivery), per-tenant sender identities.

## Agent workstreams
1. **storefront** (custom Tailwind — not Modernize).
2. **api-access app + docs portal**.
3. **fiscal-sa** (❗human review; ZATCA sandbox driven).
4. **provisioning + platform billing + notifications**.
5. **adapter-hotelbeds** (background; certification clock).

## Tarek
- ZATCA sandbox credentials + walk one real CSID onboarding. WhatsApp Business API
  account. Hotelbeds partner paperwork. Review fiscal/payment PRs.

## Acceptance gate
A brand-new tenant is provisioned in under a day, installs its apps itself, and sells
the same TBO/RateHawk hotel through Agent Portal, its themed storefront (paying by mada
in gateway sandbox), and the Partner API — each booking producing a cleared (sandbox)
ZATCA invoice and correct ledger postings.
