# 10 — Operations

## Environments
| Env | Purpose | Suppliers |
|-----|---------|-----------|
| dev (local) | Docker Compose: Postgres, Redis, MinIO, mailpit | live sandboxes (recording on) |
| staging | Single VM, production-shaped, seeded demo tenant | live sandboxes |
| production | VM(s) + managed Postgres + Redis, me-south-1 | tenants' production credentials |

Identical containerized artifact across environments and hosting tiers; configuration is
the only difference. Terraform owns all infrastructure from M0.

## Deployment
- GitHub Actions: PR → lint/typecheck/tests → merge to main → staging deploy;
  tag → production deploy with migration fan-out (dry-run first, then apply per tenant
  DB with per-tenant failure isolation and resume).
- Rollback = redeploy previous tag; migrations are expand-contract (never destructive in
  the same release) so code N-1 runs against schema N.

## Observability
- OpenTelemetry traces on every request and every supplier call (supplier, operation,
  latency, error kind, tenant) → Grafana dashboards:
  per-supplier health (latency/error/look-to-book), booking funnel, saga outcomes,
  queue depths, per-tenant activity.
- Alerts: supplier error-rate spikes, saga compensation failures, migration fan-out
  failures, ZATCA clearance failures, webhook delivery backlog, credit-check anomalies.
- Platform Admin surfaces the same boards for daily operation.

## Backups & DR
- Control-plane + every tenant DB: automated daily snapshots + WAL/PITR; per-tenant
  restore runbook (restore one tenant without touching others).
- Object store versioning for documents; ZATCA XML archive immutable.
- Quarterly restore drill (staging) is a standing calendar item — a backup that hasn't
  been restored is a hope, not a backup.

## Tenant provisioning runbook (target: < 1 day, self-service-leaning)
1. Platform Admin: create tenant → tenant DB provisioned via fan-out machinery, apps
   entitled per plan, admin invite sent.
2. Tenant Settings wizard: branding → users → supplier accounts ("connect your
   suppliers" checklist per aggregator) → gateway credentials → fiscal identity/ZATCA
   wizard (Saudi) → markup rules.
3. First sandbox booking from the search console verifies the chain end-to-end; flip
   supplier accounts to production when the tenant's own credentials are live.

## Standing operational cadences
- Weekly: recording-drift suite vs live sandboxes; dependency/security audit review.
- Monthly: supplier look-to-book review per tenant (commercial obligation), cost review.
- Per milestone: update blueprint + docs; Platform Admin surface shipped with the feature.

## Support model (pre-first-hire)
- Desk app dogfooded for Jenova's own tenant support once built; until then a shared
  inbox + Platform Admin impersonation (audited) for diagnosis.
- First hire when pilot revenue lands: operations/support before a second engineer.
