# 01 — Overview

## What Jenova is

Jenova Travel Tech is a **multi-tenant SaaS booking platform** licensed to travel companies
— tour operators, consolidators, DMCs, OTAs, corporate travel agencies. One shared engine
(inventory, pricing, bookings, finance) that each customer ("tenant") operates through an
**Internal Dashboard** composed of **installable apps**, the way Odoo composes ERP:

- **B2B app** — distribute to trade partners (sub-agent travel agencies) via an Agent Portal.
- **Corporate app** — serve corporate clients as sub-tenants: policies, approvals, a
  Corporate Portal for employee self-booking.
- **Accounting & Finance app** — the ledger's face; ZATCA invoices; TRAACS/ERP sync.
- **API Access app** — machine-to-machine distribution (Partner API), keys, metering.
- **B2C Storefront app** — the tenant's own consumer website.
- **CRM app** — customers, leads, quote pipeline linked to real bookings.
- **Omnichannel Support Desk app** — WhatsApp/email/chat tickets bound to bookings.
- **Contracting app** — the tenant's own negotiated hotel inventory (allotments,
  stop-sales) sold side by side with aggregator content.

Every app is a pricing SKU. A small agency starts with B2B + Finance; it adds Corporate
when it lands its first company account. Expansion revenue without sales cycles.

## The business model (critical framing)

Jenova is a **technology partner** to suppliers and a **software vendor** to travel
companies. It never holds supplier credit, inventory, or merchant risk:

1. Jenova certifies its integrations with aggregators (TBO, RateHawk, Hotelbeds, a flight
   consolidator) using tech-partner sandbox credentials.
2. Each tenant plugs **its own** supplier production credentials into the platform and
   trades on its own contracts, deposits, and credit terms.
3. Jenova earns: setup fee + monthly SaaS per tenant + per-app subscription +
   per-booking fee + professional services (custom connectors/integrations).

## Market and wedge

Launch market: **Saudi Arabia / GCC**. The incumbents' weaknesses are Jenova's wedge:

- **Legacy UX** → modern, fast, mobile-usable portals agents feel daily.
- **Arabic as an afterthought** → Arabic-first RTL UI and documents, native ZATCA/VAT,
  TRAACS connectivity, mada payments.
- **Months-long onboarding, five-figure setup fees** → self-service-leaning tenant
  provisioning in days at GCC-friendly pricing, attacking the long tail incumbents ignore.
- **Monolithic licenses** → per-app packaging.
- **Pre-AI operations** → AI-assisted search, reconciliation, and disruption handling
  that legacy vendors cannot retrofit quickly.

Beachhead: the best B2B hotel-booking experience in the GCC, live across all surfaces,
then widening product coverage (ground, flights, packages) from that base.

## Constraint envelope

One technical director (Tarek) orchestrating Claude Code agents. This drives every
architecture choice: modular monolith over microservices, strict build order
(revenue-gating hotels first — earning by milestone M5), contracts-before-code so agent
work parallelizes safely, and human review reserved for money paths.

## Who's who

- **Tenant** — a travel company licensing Jenova.
- **Sub-tenant** — an agency (B2B app) or corporate partner (Corporate app) under a tenant.
- **Agent** — a user at a sub-agent agency booking to resell.
- **Corporate traveler / arranger / approver** — users under a corporate sub-tenant.
- **Consumer** — an end traveler on a tenant's B2C storefront.
- **Platform admin** — Jenova staff (initially Tarek) operating the whole platform.
