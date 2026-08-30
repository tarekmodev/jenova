terraform {
  required_version = ">= 1.15.0, < 2.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Remote state (bootstrapped by infra/bootstrap). The bucket name is
  # account-suffixed, so it is supplied at init time:
  #
  #   terraform init -backend-config="bucket=jenova-tfstate-<account-id>"
  #
  # (infra/bootstrap's `staging_init_command` output prints the exact command.)
  backend "s3" {
    key            = "staging/terraform.tfstate"
    region         = "me-south-1"
    dynamodb_table = "jenova-tfstate-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "jenova"
      Environment = "staging"
      ManagedBy   = "terraform"
    }
  }
}
