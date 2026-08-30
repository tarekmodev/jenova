# Runtime configuration for the VM, read at deploy time by fetch-env.sh
# (parameter name minus the path prefix becomes the env var name — names
# mirror .env.example).
#
# Two kinds:
#  - "managed": values Terraform knows; kept in sync on every apply.
#  - "secret": placeholders Terraform creates but NEVER writes again
#    (lifecycle ignore_changes) — Tarek fills them once via the runbook in
#    infra/README.md. Secrets live only here and in the VM's chmod-600 .env.

locals {
  managed_parameters = {
    REDIS_URL = "redis://redis:6379" # containerized redis on the VM (see README)
    S3_BUCKET = aws_s3_bucket.objects.bucket
    S3_REGION = var.aws_region
  }

  # Supplier names mirror .env.example; exact variable names are finalized
  # when each adapter package lands (M1+).
  secret_parameters = [
    "CONTROL_PLANE_DATABASE_URL",
    "JENOVA_TENANT_RUNTIME_DSN",
    "TBO_HOTEL_API_URL",
    "TBO_HOTEL_USERNAME",
    "TBO_HOTEL_PASSWORD",
    "RATEHAWK_API_URL",
    "RATEHAWK_KEY_ID",
    "RATEHAWK_API_KEY",
    "HOTELBEDS_API_URL",
    "HOTELBEDS_API_KEY",
    "HOTELBEDS_API_SECRET",
    "AIR_CONSOLIDATOR_API_URL",
    "AIR_CONSOLIDATOR_USERNAME",
    "AIR_CONSOLIDATOR_PASSWORD",
  ]
}

resource "aws_ssm_parameter" "managed" {
  for_each = local.managed_parameters

  name  = "/jenova/staging/${each.key}"
  type  = "String"
  value = each.value
}

resource "aws_ssm_parameter" "secret" {
  for_each = toset(local.secret_parameters)

  name  = "/jenova/staging/${each.value}"
  type  = "SecureString"
  value = "PLACEHOLDER"

  lifecycle {
    # Real values are set out-of-band (aws ssm put-parameter --overwrite);
    # Terraform must never revert them to the placeholder.
    ignore_changes = [value]
  }
}
