# Jenova staging infrastructure (Terraform, AWS me-south-1)

IaC for the staging environment per `docs/10-operations.md`: one
production-shaped VM running the containerized artifact (api + worker +
redis via Docker Compose), managed Postgres 17 (RDS), and an S3 bucket for
object storage. Terraform owns all infrastructure from M0; nothing in this
directory contains a secret, ever.

```
infra/
├── bootstrap/   # one-time: S3 state bucket + DynamoDB lock table (local state)
└── staging/     # the environment: VPC, EC2 VM, RDS, S3, SSM params, IAM/OIDC
```

## What gets built (and what each piece costs)

Monthly estimates for me-south-1 (Bahrain), on-demand, pre-revenue frugal —
verify against the first bill. Blueprint budget is US$250–500/mo for ALL
compute; this sits comfortably under it.

| Resource | Spec | ~US$/mo |
|---|---|---|
| EC2 VM (`jenova-staging`) | t3.medium, 30 GB gp3, Ubuntu 24.04 | 38 + 3 |
| RDS Postgres (`jenova-staging`) | db.t3.micro, PG 17, 20 GB gp3, 7-day backups, single-AZ | 16 + 3 |
| Elastic IP | one public IPv4 | 4 |
| S3 objects bucket | versioned, SSE | <1 at staging volume |
| SSM parameters | standard tier | 0 |
| Terraform state (S3 + DynamoDB on-demand) | | ~0 |
| Secrets Manager (RDS master password) | 1 secret | 0.40 |
| **Total** | | **~65** |

No NAT gateway (nothing private needs egress — saves ~$45/mo). Cheaper
knob if ever needed: `db_instance_class = "db.t4g.micro"` (Graviton, ~20%
less).

### Why Redis is a container on the VM, not ElastiCache

The smallest ElastiCache node (cache.t3.micro) is ~US$19/mo and adds a
subnet group + SG + endpoint for a staging cache whose contents
(offer/availability caches, BullMQ queues) are disposable by design.
A `redis:7` container on the same VM costs $0, keeps latency on-box, is
never exposed outside the compose network, and the app only ever sees
`REDIS_URL` — so production can point the same artifact at managed Redis
(docs/10 production row) without any code change. Revisit at M5 production
cutover.

## First-run runbook (Tarek)

Prereqs: [Terraform >= 1.15](https://developer.hashicorp.com/terraform/install)
(`winget install Hashicorp.Terraform`) and the AWS CLI v2, then:

```
aws configure            # access key, secret, region: me-south-1
```

### 1. Bootstrap the state backend (once per AWS account)

```
cd infra/bootstrap
terraform init
terraform apply
```

Creates `jenova-tfstate-<account-id>` (S3, versioned) + `jenova-tfstate-lock`
(DynamoDB). This module's own state stays local in `infra/bootstrap/`
(gitignored) — that's the accepted chicken-and-egg for backend bootstrap.
Note the `staging_init_command` output; it's the exact next command.

### 2. Build staging

```
cd ../staging
terraform init -backend-config="bucket=jenova-tfstate-<account-id>"
terraform plan
terraform apply
```

~15 min (RDS is the slow part). Then give the VM ~3 more minutes to finish
cloud-init (docker install + /opt/jenova files).

### 3. Fill the secret parameters

Terraform created every `/jenova/staging/*` parameter; secrets are
`PLACEHOLDER` until you set them (Terraform never overwrites them again).

Get the RDS master password (also visible in the Secrets Manager console —
secret ARN is the `rds_master_secret_arn` output):

```
aws secretsmanager get-secret-value --secret-id <rds_master_secret_arn> --query SecretString --output text
```

Build the two DSNs with the `rds_endpoint` output (`<host>:5432`):

```
aws ssm put-parameter --overwrite --name /jenova/staging/CONTROL_PLANE_DATABASE_URL \
  --type SecureString --value "postgres://jenova:<master-password>@<host>:5432/jenova_control_plane"
```

For `JENOVA_TENANT_RUNTIME_DSN`, first create the least-privilege login role
per `packages/db/README.md` (`create role jenova_app login password '...' in
role jenova_runtime;` — connect to RDS from the VM: `aws ssm start-session
--target <instance-id>`, then `docker run --rm -it postgres:17 psql ...`, or
use an SSM port-forwarding session). Then:

```
aws ssm put-parameter --overwrite --name /jenova/staging/JENOVA_TENANT_RUNTIME_DSN \
  --type SecureString --value "postgres://jenova_app:<password>@<host>:5432/postgres"
```

Fill the supplier sandbox parameters (`TBO_HOTEL_*`, `RATEHAWK_*`,
`HOTELBEDS_*`, `AIR_CONSOLIDATOR_*`) from your test-credentials list the
same way. The deploy script rebuilds the VM's `/opt/jenova/.env` from these
parameters on every deploy — secrets never live in the repo or the image.

### 4. Wire up GitHub and enable deploys

In the repo settings:

1. Create environment **staging** with two environment **variables**
   (not secrets — neither value is sensitive):
   - `AWS_DEPLOY_ROLE_ARN` = `terraform output deploy_role_arn`
   - `STAGING_INSTANCE_ID` = `terraform output instance_id`
2. Create repository **variable** `STAGING_DEPLOY_ENABLED` = `true`.

Until both exist, `deploy-staging.yml` still builds and pushes the image on
every merge to main but skips the deploy job — safe no-op by design.

### 5. First deploy

Merge to main (or run the "Deploy staging" workflow manually). The deploy
job assumes the OIDC role, runs `/opt/jenova/deploy.sh <tag>` on the VM via
SSM Run Command: refresh env from SSM → pull image → migration fan-out
dry-run → apply → `docker compose up -d`. The API answers on
`http://<public_ip>/` (port 80 → api:3000).

## Day-2 operations

- **Shell on the VM** (no SSH port exists): `aws ssm start-session --target
  <instance-id> --region me-south-1`.
- **Rollback** = redeploy the previous tag (docs/10; images are immutable,
  migrations are expand-contract so old code runs on new schema):

  ```
  aws ssm send-command --instance-ids <instance-id> --region me-south-1 \
    --document-name AWS-RunShellScript \
    --parameters 'commands=["/opt/jenova/deploy.sh sha-<previous-commit-sha>"]'
  ```

  (If the GHCR package is still private, the old image is already on the VM
  from its original deploy — the redeploy uses the local copy. Making
  `ghcr.io/tarekmodev/jenova` public removes the token dance entirely.)
- **Logs**: `docker compose -f /opt/jenova/docker-compose.yml logs -f api`.
- **Destroy** (staging is disposable): `terraform destroy` in `staging/`.
  RDS `skip_final_snapshot = true` — export anything you care about first.
