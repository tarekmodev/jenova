# Core workspace + Settings

Not an installable app — the part of the Internal Dashboard every tenant gets. It is the
tenant staff's operating surface and the home of all self-service configuration.

## Bookings queue
- All bookings across every surface and vertical; filters by state, vertical, surface,
  sub-tenant, supplier, travel date.
- **Manual-intervention queue**: items in states automation can't safely resolve
  (supplier no-answer, cancel-fee conflict, failed saga compensation, price-change
  awaiting re-approval). Each item shows the exact decision needed and the actions
  allowed from its state machine.
- Full booking detail: travelers, items with per-item state history (from AuditEvents),
  documents, ledger postings, linked tickets (Desk app), amendments/cancellation with
  fee preview before execution.

## Search & book console
- Staff-side search/book for phone-in and walk-in business: same engine services, staff
  choose which sub-tenant (agency/corporate/none) the booking belongs to, which
  determines the gate applied.
- Quote baskets: assemble offers into a bilingual quote PDF before booking.

## Settings (fully self-service)
- **Supplier accounts**: add/edit the tenant's own credentials per supplier, sandbox vs
  production, test-connection button, enable/disable per supplier. Credentials encrypted;
  never displayed after save.
- **Markup rules**: ordered rule editor with scope preview ("which rule fires for this
  agency + supplier + destination?").
- **Sub-tenant entry points**: agencies (B2B app) and corporates (Corporate app).
- **Users & roles**: tenant staff accounts, role assignment, 2FA enforcement.
- **Branding**: logo, colors, sender identities for documents and notifications.
- **Payment gateways**: the tenant's own Moyasar/HyperPay credentials.
- **Fiscal identity**: VAT number, ZATCA onboarding wizard (device CSID registration).
- **Custom fields / webhooks / connectors**: the extensibility surface (scoped tenant-wide
  or per sub-tenant).

## Acceptance heuristics
- A tenant admin can go from fresh provisioning to first sandbox booking without any
  Jenova involvement, guided by the "connect your suppliers" checklist.
- Every action visible in the queue is derived from the state machine — no action is
  offered that the current state forbids.
