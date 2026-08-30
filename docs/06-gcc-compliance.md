# 06 — GCC compliance & localization

This layer is Jenova's moat as much as a checklist — global incumbents treat all of it as
professional-services work.

## Arabic & RTL (product-wide)
- Arabic is the **primary** locale; English is the mirror. Every dashboard/portal screen
  and every document ships bilingual from its first commit.
- RTL-first layout via the shared `ui` package (MUI RTL) and logical CSS properties in
  the storefront; icons/chevrons flip; numbers remain Latin digits unless tenant opts
  for Eastern Arabic numerals (display setting).
- Hijri dates shown alongside Gregorian where users expect them (Umrah-adjacent flows);
  storage is always Gregorian UTC.

## ZATCA e-invoicing (Fatoora, Phase 2) — `fiscal-sa` package
- Scope: Saudi tenants' invoices/credit notes to their buyers, AND Jenova's own invoices
  to tenants (Jenova is a Saudi seller).
- Mechanics: UBL 2.1 XML generation; XAdES signing with per-tenant device credentials
  (CSID); **B2B clearance** (invoice cleared by ZATCA before delivery) and **B2C
  reporting** (within 24h); TLV QR codes on every invoice PDF.
- Onboarding: tenant Settings includes a ZATCA wizard — compliance CSID → production
  CSID; sandbox (compliance simulation) exercised long before first Saudi tenant go-live.
- Isolation: everything behind a `FiscalRegime` interface so other GCC regimes
  (e.g. UAE e-invoicing) slot in later without touching document flows.
- Cleared XML archived with the PDF for the statutory retention period; clearance
  failures land in the manual-intervention queue with the ZATCA error decoded.

## VAT
- 15% Saudi VAT with per-case treatment: domestic vs international transport rules,
  agent-model vs merchant-model per tenant configuration. VAT accounts are native ledger
  accounts; the VAT report is a ledger read.

## PDPL (Saudi Personal Data Protection Law)
- Traveler PII minimized and encrypted at rest; retention policies per record class;
  processing terms in tenant contracts (Jenova = processor, tenant = controller).
- Data-subject tooling in Platform Admin: export / erase (anonymize; never break
  booking/audit history).
- Hosting in-region: AWS Bahrain (me-south-1) initially; in-Kingdom region (AWS/GCP KSA)
  when a government-adjacent tenant requires it — db-per-tenant + tier moves make the
  migration a database move.

## Payments (Saudi-first)
- mada is non-negotiable for B2C conversion; Apple Pay next; Visa/MC standard. Gateways:
  Moyasar or HyperPay — hosted fields/redirect only (PCI SAQ-A; card data never touches
  Jenova). Each tenant uses its **own** gateway account (Jenova is not the merchant).
- Multi-currency display, SAR settlement default; FX with stored rates + tenant buffer.

## Market specifics
- **Nationality/residency-based rates**: first-class search parameter, defaulted per
  agency/corporate, always visible — never hidden.
- **Umrah readiness**: strong Makkah/Madinah content, package saga, and the Contracting
  app are the foundation; a dedicated Umrah-operations app (Nusuk-era integrations) is a
  future catalog candidate.
- WhatsApp is a primary communication channel (documents, notifications, Desk app) —
  WhatsApp Business API with template management per tenant.
