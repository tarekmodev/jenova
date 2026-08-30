# Managed Postgres 17 (docs/07). One RDS server hosts the control-plane DB
# and every tenant DB (database-per-tenant lives at the Postgres level, not
# the instance level — CLAUDE.md rule 1). Private subnets, VM-only ingress.
#
# The master password is generated and stored by RDS in Secrets Manager
# (manage_master_user_password) so it never appears in Terraform state or
# this repo. The runbook in infra/README.md turns it into the two DSN
# parameters the app reads.

resource "aws_db_subnet_group" "staging" {
  name       = "jenova-staging"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "postgres" {
  identifier     = "jenova-staging"
  engine         = "postgres"
  engine_version = "17"
  instance_class = var.db_instance_class

  db_name                     = "jenova_control_plane"
  username                    = "jenova"
  manage_master_user_password = true

  allocated_storage     = 20
  max_allocated_storage = 50 # tenant DBs grow; autoscaling headroom is free until used
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.staging.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false # staging: cost over availability

  # docs/10: automated daily snapshots + PITR (retention enables WAL/PITR).
  backup_retention_period = 7

  auto_minor_version_upgrade = true
  apply_immediately          = true
  deletion_protection        = false
  skip_final_snapshot        = true
}
