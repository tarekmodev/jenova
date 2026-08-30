# M15–16 — CRM + Omnichannel Support Desk apps (months 15–16)

**Goal:** the relationship layer. Two apps whose edge is deep booking linkage — specs:
[docs/apps/crm.md](../apps/crm.md), [docs/apps/desk.md](../apps/desk.md). Built in
parallel by separate workstreams; they integrate with each other when both land.

## Deliverables — CRM app
- [ ] Contacts unified across surfaces (consumer, agency contact, corporate traveler)
      with auto-create/update from bookings; merge + dedup tooling (email/phone/doc no.).
- [ ] Leads & opportunities: pipeline; quote basket → opportunity with priced content;
      win → booking conversion without re-entry; lose reasons.
- [ ] Tasks & reminders incl. document-expiry alerts; assignment.
- [ ] Segments & lists; export + webhook push; PDPL-safe erasure (anonymize, never break
      booking/audit history).
- [ ] Per-sub-tenant scoping (agency-owned data; corporate arrangers see own company).
- [ ] Optional external CRM two-way sync via connector framework.

## Deliverables — Support Desk app
- [ ] Unified inbox: WhatsApp Business API, email, portal chat; threading per contact.
- [ ] Tickets bound to bookings: type, priority, SLA timers (tenant working hours),
      assignment; live booking panel beside the conversation.
- [ ] **Ticket-driven actions**: amendment/cancellation/refund flows triggered from the
      ticket run the real gated engine flows (fee preview, approvals, postings) — never
      re-typed.
- [ ] Booking events auto-post into linked tickets; bilingual canned replies with
      variables; WhatsApp 24h-window/template compliance.
- [ ] SLA dashboards + breach alerts; optional sub-tenant ticket visibility in portals.
- [ ] CRM integration: conversations attach to contact history when CRM installed.

## Shared
- [ ] Both apps as standard entitlements (install → seed defaults); events into
      webhooks/connectors; Platform Admin oversight (Desk volumes, CRM storage).
- [ ] Jenova dogfoods the Desk app for its own tenant support from this milestone.

## Agent workstreams
1. **crm** (model + pipeline + UI).
2. **desk inbox + channels** (WhatsApp integration is the long pole).
3. **desk ticket-actions** (❗human review — refund paths).
4. **cross-integration + scoping audit**.

## Tarek
- WhatsApp Business template approvals; pilot tenants for both apps; pricing per app.

## Acceptance gate
A traveler's WhatsApp refund request becomes: ticket → fee preview → (policy) approval →
executed refund → automatic confirmation message — without staff leaving the dashboard.
A quote basket converts to opportunity to booking with zero re-entered data.
