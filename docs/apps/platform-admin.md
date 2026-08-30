# Platform Admin — Jenova's control plane

Not a tenant app: a **separate application** (separate deployment, separate auth realm,
hardware-key 2FA) for Jenova staff — initially just Tarek. It sits above tenancy and can
see and control everything; every action writes to the append-only audit log. It grows
with the platform: every milestone that ships a capability ships its admin surface in the
same milestone — never a feature you can sell but not operate.

## Tenant lifecycle
- Provision (creates the tenant DB via the fan-out machinery), configure, suspend,
  offboard (export + scheduled deletion per PDPL).
- Plans & pricing: SaaS tier, per-app pricing, usage limits (searches/day,
  bookings/month, API tiers).
- Custom domains and branding approvals; hosting-tier moves (standard → dedicated →
  private) as managed operations.

## App & module control
- The entitlement switchboard: enable/disable any app for any tenant; staged rollouts of
  app versions behind feature flags; per-tenant config overrides.
- **Kill switches**: instantly disable a misbehaving supplier adapter, app, connector, or
  entire tenant platform-wide — no deploy.

## Hierarchy visibility & support
- Drill: tenant → agencies/corporates → users → bookings, for support and disputes.
- **Audited impersonation**: open any tenant's dashboard or portal as any of their users
  — visible banner, audit entry, and financial actions blocked while impersonating.
- Global search: booking ref / traveler / PNR across all tenants (fan-out query).

## Supplier catalog
- Adapter registry with certification status per supplier & environment; sandbox/
  production flips per tenant SupplierAccount; per-supplier health boards (latency,
  error rate, look-to-book) with global degrade/disable.

## Platform billing
- Metering (SaaS, apps, per-booking fees) → invoices to tenants (ZATCA-compliant —
  Jenova itself is a Saudi seller); dunning and auto-suspension rules.

## Cross-tenant operations
- Global booking-failure and manual-intervention queues; background-job monitor; webhook
  delivery logs; migration fan-out status per tenant DB.

## Compliance & security
- Platform-wide audit-log search; PDPL data-subject tooling (export/erase a traveler's
  PII across a tenant); session revocation; maintenance banners/announcements.

## Invariants
- No write path here bypasses services; "god mode" means scope, not raw SQL.
- Impersonation can never execute payments, refunds, or credential reads.
