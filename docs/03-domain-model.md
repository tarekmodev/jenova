# 03 — Domain model

Canonical types live in the `domain` package: pure TypeScript, no IO, no framework
imports. Adapters translate every supplier response into these types at the boundary;
engine and apps import from `domain` only.

## Control-plane entities (control-plane DB)

| Entity | Purpose |
|--------|---------|
| **Tenant** | A customer travel company: branding, domains, base currency, fiscal identity (VAT no., ZATCA credentials), hosting tier, DB connection ref. |
| **AppInstallation** | Which apps a tenant has enabled, per-app config + billing plan. The entitlement record the gateway checks on every request. |
| **PlatformUser** | Jenova staff; hardware-key 2FA; roles for the Platform Admin console. |
| **SupplierCatalogEntry** | Platform-level supplier definition + certification status per environment. |
| **PlatformInvoice / Meter** | Jenova's own billing to tenants: SaaS, per-app, per-booking metering. |

## Tenant entities (each tenant's own DB)

| Entity | Purpose |
|--------|---------|
| **Agency / Agent** | B2B trade buyers: credit terms, markup/discount profile, allowed currencies; agents are users with roles within an agency. |
| **CorporatePartner (sub-tenant)** | A corporate client: its users (travelers, arrangers, approvers), account billing terms, cost centers, reporting scope. Structural sibling of Agency with a different buying mode. |
| **TravelPolicy / ApprovalFlow** | Corporate rules: rate caps, star/cabin limits, advance-booking rules; approval chains evaluated before an Offer can pass the gate. Violations block or route per policy. |
| **SupplierAccount** | The tenant's own credentials per supplier + environment (sandbox/production). Encrypted secrets; per-account enable/disable. |
| **Property / Airport / Route / Activity masters** | Canonical content; supplier codes map to canonical IDs via the licensed mapping service, with a manual override queue. |
| **SearchSession / Offer** | Short-lived priced results: supplier net + applied markup rule + cancellation-policy snapshot, cached with TTL and a **signed price hash**. Booking references an Offer token, never a client-side price. |
| **Booking / BookingItem** | Booking = commercial container (buyer, channel, totals, payment state). Item = one product unit with its own supplier ref, state machine, policy snapshot, travelers. A package = one Booking, many Items, one saga. |
| **LedgerAccount / JournalEntry** | Double-entry per tenant: agency receivables, corporate receivables, supplier payables, sales, VAT. Booking events post entries; credit checks read balances, never recompute. |
| **Invoice / CreditNote / Voucher / ETicket** | Fiscal documents (ZATCA-cleared where applicable) and travel documents; bilingual PDFs. |
| **MarkupRule** | Ordered, most-specific-wins: scope (tenant default → agency/corporate → channel → vertical → supplier → destination → date band), type (%/fixed/per-night/per-pax), commission split. The fired rule id is stored on the Offer. |
| **Contract / Allotment** | Contracting app: seasons, rate plans, allotments, release periods, stop-sales, offers. Exposed to search via the internal-adapter path. |
| **CustomFieldDef / Webhook / ConnectorConfig** | Extensibility, scoped to tenant or an individual sub-tenant: typed custom fields on core entities; signed webhook subscriptions per business event; connector credentials + field mappings (TRAACS, accounting, HRM, CRM). |
| **Ticket / CrmContact / Lead** | Support Desk and CRM records, always linked to bookings. |
| **AuditEvent** | Append-only: every state change with actor, before/after. Non-negotiable — B2B travel runs on disputes. |

## Booking item state machine

```
quoted → reserved → (pending_confirmation) → confirmed → issued → completed
             │               │                   │          │
             └── failed      └── failed/cancel   ├── amendment_pending ⇄
                                                 └── cancelled
```

Legal transitions are encoded as data (`BOOKING_ITEM_TRANSITIONS`); the runner enforces
them and every transition atomically: (1) validates legality, (2) writes the new state,
(3) posts ledger entries, (4) appends an AuditEvent, (5) emits the event for webhooks,
notifications, and connector sync.

## Money

`{ amount: integer minor units, currency: ISO 4217 }`. No floats, no implicit currency.
FX conversion happens exactly twice: display (indicative) and ledger posting (stored
rate, tenant-configurable buffer). Every stored amount knows its currency.

## Normalized cancellation policy

Suppliers disagree most here. Canonical form: `refundable` + ordered rules of
`{ fromUtc, penalty: Money }` — adapters resolve supplier-local deadlines to UTC instants
and supplier penalty encodings (percent, nights, fixed) to Money at translation time.

## Unified supplier error taxonomy

`sold_out · price_changed · invalid_request · supplier_timeout · supplier_rejected ·
auth_failed · rate_limited`. Adapters map every supplier error/fault (JSON or SOAP) into
this taxonomy; engine behavior (retry, surface, fail item) keys off the kind, never off
supplier-specific codes.
