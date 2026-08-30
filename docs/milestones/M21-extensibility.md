# M21+ — Isolation tiers & deep extensibility (post-GA, sequenced by enterprise demand)

**Goal:** the enterprise capabilities: dedicated/private hosting, sub-tenant Data
Vaults, and the full customization framework. Sequenced by which signed deal demands
which piece first — nothing here is speculative work.

## Deliverables — hosting tiers
- [ ] **Dedicated instance tier**: tenant DB on its own Postgres instance/region;
      tier-move tooling (a managed database move, verified by checksum, with cutover
      window); fan-out runner + backups tier-aware.
- [ ] **Private / on-premise tier**: the identical containerized artifact packaged for
      a tenant's cloud or DC; licensed update channel with a maximum supported version
      lag; remote-support tooling; per-deployment code differences refused —
      extensibility is the only customization path.

## Deliverables — Data Vault
- [ ] **CDC pipeline** (worker): per-sub-tenant change capture of everything belonging
      to that sub-tenant (bookings, invoices, travelers, spend, tickets) → delivered to
      a customer-hosted Postgres (cloud or on-prem) with sub-minute lag, replay/backfill,
      and schema-versioned payloads.
- [ ] Vault management UI (Corporate/B2B app sections): connection setup, lag monitor,
      backfill trigger; Platform Admin oversight.

## Deliverables — extensibility framework (full)
- [ ] **Custom fields**: typed field definitions on bookings/travelers/invoices, scoped
      tenant or sub-tenant; shown in the owning portal, carried through documents,
      exports, webhooks, Data Vault, and connectors.
- [ ] **Connector catalog v2** beyond TRAACS: generic accounting journal push
      (QuickBooks/Zoho/ERP), **HRM sync** (roster in → traveler profiles + cost
      centers), CRM sync; per-sub-tenant credentials + mapping UI; sync logs with retry.
- [ ] Professional-services workflow: bespoke integration requests priced and tracked;
      recurring requests graduate into the catalog.

## Agent workstreams
1. **tier tooling** (moves, update channel).
2. **CDC pipeline** (❗human review — data-egress correctness and PDPL scope).
3. **custom fields end-to-end**.
4. **connector catalog v2** (one connector per workstream).

## Tarek
- Enterprise deals drive sequencing; PDPL/data-processing terms per Vault customer;
  on-prem support pricing that actually funds the burden.

## Acceptance gate
A corporate sub-tenant's on-premise Data Vault stays in sync within a minute through a
normal business day including an amendment and a refund; one enterprise tenant runs the
full stack in its own cloud on the standard update channel; a custom field defined for
one corporate flows portal → document → webhook → Vault untouched by code changes.
