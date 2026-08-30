# Milestones — build order M0 → M21+

One product, one catalog — **no versions**. Milestones are strictly the build order:
revenue-gating capability first (hotels earning by M5), then the catalog completes.
A milestone never starts before the previous gate passes. Months are calendar months of
focused solo-plus-agents work; external dependencies (certifications, ZATCA, PSP
onboarding, consolidator agreement) are started early because they slip before code does.

Each milestone file specifies: goal, deliverables, agent workstreams (package-scoped,
parallelizable), Tarek's human/external tasks, and the acceptance gate.

| Milestone | When | Title | Gate in one line |
|-----------|------|-------|------------------|
| [M0](M00-foundations.md) | wk 1–2 | Foundations | An agent ships a reviewed PR to staging unaided. |
| [M1](M01-engine-spine.md) | mo 1 | Engine spine on live sandbox | Real sandbox hotel: search→check→book→cancel with balanced ledger postings; CI green on recordings. |
| [M2](M02-b2b-alpha.md) | mo 2 | First supplier certified + B2B app alpha | A TBO sandbox hotel booked & cancelled from the Agent Portal in Arabic and English. |
| [M3](M03-money.md) | mo 3 | Money is real | Two-supplier deduped search books against agency credit; finance reports reconcile to the ledger. |
| [M4](M04-app-suite.md) | mo 4 | App suite live (hotels) | New tenant provisioned <1 day, installs apps itself, sells one hotel via portal, storefront, and API with cleared invoices. |
| [M5](M05-pilot-launch.md) | mo 5 | Pilot launch — hotels GA | Pilot tenant's agents book real paid stays in production. **Revenue starts.** |
| [M6–7](M06-07-corporate.md) | mo 6–7 | Corporate app | Real corporate client: out-of-policy booking routes to approver, bills to account. |
| [M8–9](M08-09-ground.md) | mo 8–9 | Transfers & activities | Hotel+transfer booking survives forced partial failure by compensating cleanly, in production. |
| [M10–12](M10-12-flights.md) | mo 10–12 | Flights via consolidator | Ticketed flight books, voids, and refunds end-to-end in production. |
| [M13](M13-packages.md) | mo 13 | Dynamic packages | Jeddah bundle (flight+Makkah hotel+transfer) sells through Agent Portal and B2C. |
| [M14](M14-ga.md) | mo 14 | Commercial GA | Tenants onboard with zero personal involvement per step. |
| [M15–16](M15-16-crm-desk.md) | mo 15–16 | CRM + Support Desk | WhatsApp refund request → ticket → approval → executed refund without leaving the dashboard. |
| [M17–20](M17-20-contracting.md) | mo 17–20 | Contracting app — full catalog | DMC's contracted Makkah allotment sells beside TBO rates; stop-sale is instant. |
| [M21+](M21-extensibility.md) | post-GA | Isolation tiers & deep extensibility | On-prem Data Vault in sync <1 min; one enterprise tenant runs the stack in its own cloud. |

## Standing rules across all milestones
- Platform Admin ships its surface for every capability **in the same milestone**.
- Every screen bilingual (ar/en) from first commit; every state change posts ledger+audit.
- Human review before merge on money paths (ledger, payments, sagas, fiscal-sa, auth,
  impersonation).
- 2–3 agent workstreams in flight at once, max — review capacity is the bottleneck.
- At each gate: update `docs/` and the blueprint with anything learned.
