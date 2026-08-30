# M8–9 — Transfers & activities (months 8–9)

**Goal:** the second and third products, across every app and portal, and the first
real multi-item bookings exercising the saga with compensation.

## Deliverables
- [ ] **GroundSupplierAdapter contract** finalized in supplier-sdk (search/check/book/
      retrieve/cancel with transfer- and activity-specific payloads: routes, pickup
      times, flight numbers; activity dates, tickets, cutoffs).
- [ ] **Hotelbeds Transfers adapter** + **Hotelbeds Activities adapter** (one commercial
      relationship, two verticals): full normalization + recordings + certification.
- [ ] Optional (by content need): Viator or GRNconnect activities adapter.
- [ ] **Ground services** (`api/ground-search`, `api/ground-booking`): same fan-out /
      offer / gate / state-machine patterns; transfer-specific data (flight number,
      pickup point) on the BookingItem.
- [ ] **Multi-item bookings**: one Booking, N items; the **saga coordinator** in worker:
      reserve all → confirm all, or compensate (cancel confirmed) on partial failure;
      manual-intervention states for uncompensatable cases; ledger postings per item.
- [ ] UX in every surface: ground search/book in Agent Portal, Corporate Portal (policy
      applies), storefront, Partner API (v1 endpoints extended), dashboard console;
      "add a transfer to this hotel booking" cross-sell flow.
- [ ] Documents: transfer voucher (pickup details, driver contact placeholder),
      activity ticket; bilingual.
- [ ] Platform Admin: ground supplier health boards; saga outcome dashboard.

## Agent workstreams
1. **adapters-ground** (transfers + activities, with recordings).
2. **ground services + UX** across surfaces.
3. **saga coordinator** (❗human review — compensation logic + postings).
4. **partner-api extension + documents**.

## Tarek
- Hotelbeds transfers/activities certification. Review saga PRs. Recruit content
  feedback from pilot agents (which routes/activities matter for GCC).

## Acceptance gate
In production: a hotel+transfer booking where the transfer intentionally fails (real
`sold_out`/timeout recording replayed in staging; a controlled case in production)
compensates cleanly — the hotel is cancelled, ledger nets to zero, the agent sees one
coherent story. Saga dashboard shows zero orphaned confirmations for the month.
