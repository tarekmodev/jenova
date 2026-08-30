# M13 — Dynamic packages (month 13)

**Goal:** flight + hotel + transfer composed, priced, and sold as one checkout — the
last product vertical. Everything it needs (three verticals, the saga, combined
documents) already exists; this milestone is composition.

## Deliverables
- [ ] **Package composer** (`api/package-composer`): guided build (origin, destination,
      dates, pax) → parallel vertical searches → combinable results with one combined
      price (per-item nets + package-level markup rule scope); package Offer = child
      offers + combined signed price.
- [ ] **Package checkout**: one gate evaluation for the whole package (credit /
      policy+approval / payment for the combined amount), then the **saga** (proven in
      M8–9) reserves/confirms all items with compensation on partial failure; air
      ticketing-time-limit logic respected inside package flow.
- [ ] **Package pricing rules**: MarkupRule scope `vertical=package`; optional
      package-level discount vs sum-of-parts display.
- [ ] **Package UX**: Agent Portal composer (agents assemble + quote as one PDF),
      storefront packaged offers (tenant-curated combos, e.g. Jeddah flight + Makkah
      hotel + transfer), Corporate policy applied per component and total, Partner API
      package endpoints.
- [ ] **Package documents**: one bilingual itinerary bundling e-ticket, vouchers,
      transfer details; per-component cancellation terms clearly separated.
- [ ] Amendment/cancellation UX for partial package changes (cancel activity, keep
      hotel+flight) with correct fee preview per component.

## Agent workstreams
1. **composer + pricing**.
2. **package checkout + saga integration** (❗human review).
3. **package UX + documents**.

## Tarek
- Define 3–5 curated GCC package templates with pilot tenants (Umrah-adjacent Jeddah/
  Makkah combos first). Review checkout PRs.

## Acceptance gate
A bundled Jeddah package (flight + Makkah hotel + transfer) sells through the Agent
Portal and the B2C storefront in production; a forced partial failure compensates the
whole package cleanly; the combined document set is correct in Arabic and English.
This completes the product-vertical surface.
