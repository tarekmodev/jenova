# 04 — Apps

One spec per app. Common contract for every app (details in [02-architecture](../02-architecture.md)):

- App = NestJS module + dashboard section + external portal (where applicable) +
  entitlement flag. Install = flip flag + seed defaults. Nothing deploys per tenant.
- Apps call engine services, never tables. The gate before booking confirmation is the
  only per-app difference in the booking path.
- All dashboard-class UI comes from the shared `ui` package (Modernize/MUI wrapper),
  Arabic-first RTL with English mirror. The B2C storefront is custom Tailwind.

| Spec | App | Portal | Build milestone |
|------|-----|--------|-----------------|
| [core-workspace](core-workspace.md) | Core workspace + Settings (not installable — every tenant) | — | M1–M3 |
| [b2b](b2b.md) | B2B | Agent Portal | M2–M3 |
| [finance](finance.md) | Accounting & Finance | — | M3–M4 |
| [api-access](api-access.md) | API Access | Partner API | M4 |
| [storefront](storefront.md) | B2C Storefront | Consumer website | M4 |
| [corporate](corporate.md) | Corporate | Corporate Portal | M6–7 |
| [crm](crm.md) | CRM | — | M15–16 |
| [desk](desk.md) | Omnichannel Support Desk | — | M15–16 |
| [contracting](contracting.md) | Contracting (own inventory) | — | M17–20 |
| [platform-admin](platform-admin.md) | Platform Admin (Jenova-level, not a tenant app) | — | grows every milestone |
