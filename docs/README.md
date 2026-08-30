# Jenova Travel Tech — documentation

Multi-tenant SaaS travel platform for the GCC market, competing with eJuniper, TravZilla
Pro, Lemax, and Technoheaven. Built by Claude Code agents under one technical director
(Tarek). The rendered executive blueprint is [jenova-blueprint.html](jenova-blueprint.html);
these documents are the working specifications derived from it. Where they conflict, the
newest document wins and the blueprint gets updated.

## Reading order

| # | Document | What it specifies |
|---|----------|-------------------|
| 01 | [Overview](01-overview.md) | Vision, market, business model, positioning |
| 02 | [Architecture](02-architecture.md) | System shape, tenancy (DB per tenant), apps model, isolation & hosting tiers |
| 03 | [Domain model](03-domain-model.md) | Canonical entities, state machines, money rules |
| 04 | [Apps](apps/README.md) | One spec per app + core workspace + Platform Admin |
| 05 | [Supplier integrations](05-suppliers.md) | Adapter contracts, normalization, JSON/XML/SOAP, certification, roadmap |
| 06 | [GCC compliance](06-gcc-compliance.md) | ZATCA, VAT, PDPL, mada, Arabic/RTL, nationality-based rates |
| 07 | [Tech stack](07-tech-stack.md) | Languages, frameworks, infra, UI kits, repo layout |
| 08 | [Security](08-security.md) | Auth realms, secrets, PCI scope, audit, impersonation rules |
| 09 | [Testing strategy](09-testing.md) | Sandbox-first, record-and-replay, contract tests, e2e |
| 10 | [Operations](10-operations.md) | Deployment, observability, backups, tenant provisioning runbook |
| 11 | [Glossary](11-glossary.md) | Travel-industry and project terms |
| — | [Milestones](milestones/README.md) | Build order M0 → M21+, agent workstreams, acceptance gates |

## Ground rules (full version in root `CLAUDE.md`)

- The product name is **Jenova** — everywhere, always.
- Jenova is a **technology partner**, never a travel merchant: tenants trade on their own
  supplier accounts and credit.
- **Database per tenant** is the base architecture.
- **No mock or fabricated data** in any development phase — live supplier sandboxes plus
  recorded-replay of real traffic.
- One unified app catalog, no version splits — milestones are build order only.
- All dashboard-class UI uses the Modernize (MUI) kit via the shared `ui` package; the B2C
  storefront and future mobile apps are custom and excluded from that rule.
