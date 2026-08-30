# Remote-state backend bootstrap: the S3 bucket + DynamoDB lock table that
# infra/staging's `backend "s3"` points at. Chicken-and-egg by design — this
# module keeps its own state LOCAL (infra/bootstrap/terraform.tfstate,
# gitignored). Run it exactly once per AWS account:
#
#   cd infra/bootstrap
#   terraform init
#   terraform apply
#
# then use the `staging_init_command` output to init infra/staging.

terraform {
  required_version = ">= 1.15.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "me-south-1"

  default_tags {
    tags = {
      Project   = "jenova"
      ManagedBy = "terraform"
      Component = "tfstate-bootstrap"
    }
  }
}

data "aws_caller_identity" "current" {}

# Bucket names are globally unique — suffix with the account id.
resource "aws_s3_bucket" "tfstate" {
  bucket = "jenova-tfstate-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_dynamodb_table" "tfstate_lock" {
  name         = "jenova-tfstate-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

output "state_bucket" {
  description = "S3 bucket holding Terraform remote state"
  value       = aws_s3_bucket.tfstate.bucket
}

output "lock_table" {
  description = "DynamoDB table used for state locking"
  value       = aws_dynamodb_table.tfstate_lock.name
}

output "staging_init_command" {
  description = "Run this from infra/staging to wire up the remote backend"
  value       = "terraform init -backend-config=\"bucket=${aws_s3_bucket.tfstate.bucket}\""
}
