# CRM app

Customer and lead management for the tenant — with the edge generic CRMs can't match:
every record links to real bookings, spend, and documents already in the system.

## Dashboard section
- Contacts: consumers, agency contacts, corporate travelers — unified view with travel
  history (bookings, spend, destinations), documents on file, communication log
  (linked from Desk app when installed).
- Leads & opportunities: pipeline stages; a **quote basket becomes an opportunity** with
  its priced content attached; win → the quote converts to a booking in one step; lose →
  reason codes.
- Tasks & reminders: follow-ups, document-expiry alerts (passport/visa), payment
  reminders; assignable to staff.
- Segments & campaign lists: filter by history (e.g. "booked Makkah in last 12 months"),
  export or push to a connected campaign tool via webhook/connector.
- Per-sub-tenant scoping: an agency's CRM data is its own; corporate arrangers see their
  company's travelers only.

## Integration behavior
- Every booking auto-creates/updates its contact records (no manual data entry).
- CRM connector (Extensibility layer) can two-way sync contacts with an external CRM
  where a tenant insists on keeping theirs.

## Invariants
- No duplicate contact storms: merge tooling + dedup on email/phone/document number.
- Deleting a contact respects PDPL erasure rules but never breaks booking/audit history
  (anonymize, don't cascade-delete).

## Acceptance heuristics
- From a contact page: full travel history, open quotes, open tickets, next task — one
  screen, zero navigation.
- Quote → opportunity → booking conversion needs no re-entry of any traveler data.
