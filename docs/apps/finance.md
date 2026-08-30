# Accounting & Finance app

The ledger's face for tenant staff, and the bridge to the finance systems tenants already
run. Jenova's double-entry ledger is the **operational** source of truth; the tenant's
accounting system (TRAACS/ERP) stays the **fiscal** one.

## Dashboard section
- Receivables: agency and corporate balances, aging buckets, statement generation and
  delivery; dunning notes.
- Payables: supplier-payable tracking per booking (what the tenant owes each supplier),
  supplier refund tracking — refunds arriving weeks late is the operational norm, so every
  expected refund has a state (expected → received → reconciled) and an aging view.
- Invoices & credit notes: issue, deliver, void; ZATCA clearance status per document
  (Saudi tenants); bilingual PDF rendering.
- VAT: 15% with correct treatment per case (domestic vs international transport,
  agent-vs-merchant model per tenant configuration); VAT report export.
- Payments: gateway transaction list (top-ups, B2C captures, refunds) reconciled against
  ledger postings.
- Manual journal entries with maker-checker approval; period locks.
- Reports: sales by vertical/supplier/sub-tenant/surface, margin (sell − net), booking-fee
  metering visibility.

## Finance-system sync (connectors)
- **TRAACS connector first** (the GCC agency standard): bookings, invoices, receipts
  pushed automatically so settlement happens in the tenant's own books; mapping UI for
  account codes; sync log with retry.
- Generic journal/CSV export + webhooks for QuickBooks, Zoho Books, ERPs.
- Per-sub-tenant scope where a corporate wants its own feed (usually via Data Vault).

## Invariants
- Every number shown is a read of ledger postings — this app computes nothing itself.
- Documents are immutable once issued; corrections are credit notes, never edits.
- ZATCA-cleared XML is archived alongside the PDF for the statutory retention period.

## Acceptance heuristics
- Statements, aging, and VAT report totals reconcile to journal entries to the halala.
- A booking → invoice → TRAACS record chain is traceable end-to-end from the UI.
