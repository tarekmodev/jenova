# Omnichannel Support Desk app

One inbox for the tenant's traveler and agent communications — WhatsApp Business, email,
and portal chat — where conversations become tickets bound to bookings, and agreed
actions execute through the booking state machines instead of being re-typed.

## Dashboard section
- Unified inbox: WhatsApp Business API, email (per-tenant addresses), portal chat
  (Agent/Corporate/B2C surfaces); conversation threading per contact.
- Tickets: convert a conversation (or open directly) with type (amendment, refund,
  complaint, question), priority, SLA timer, assignment; **always linkable to a booking**
  — the booking panel shows live state, policy, documents next to the conversation.
- Ticket-driven actions: from a ticket, staff trigger the actual amendment/cancellation/
  refund flows (with fee preview) — a refund agreed in a ticket is executed, not noted.
- Canned replies: bilingual (Arabic/English) templates with variables (booking ref,
  traveler name, refund amount).
- SLA dashboards: response/resolution times per queue, breach alerts.
- Per-sub-tenant scoping: agencies and corporates can be given visibility into their own
  tickets via their portals.

## Integration behavior
- Booking events auto-post into linked tickets (e.g. "supplier confirmed the amendment")
  so staff never relay state manually.
- Desk events (ticket.opened/resolved, sla.breached) flow to webhooks/connectors.
- With CRM installed, conversations attach to the contact's history automatically.

## Invariants
- No side-channel money actions: every refund/amendment initiated here runs the same
  gated engine flows, posting ledger + audit as always.
- WhatsApp session/window rules (24h) are respected by the notification layer; template
  messages used outside the window.

## Acceptance heuristics
- A WhatsApp refund request becomes: ticket → fee preview → approval (if policy requires)
  → executed refund → automatic confirmation message — without leaving the dashboard.
- SLA timers pause/resume correctly across working hours configured by the tenant.
