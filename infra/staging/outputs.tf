output "instance_id" {
  description = "Staging VM instance id — set as STAGING_INSTANCE_ID on the GitHub 'staging' environment"
  value       = aws_instance.vm.id
}

output "public_ip" {
  description = "Staging VM Elastic IP"
  value       = aws_eip.vm.public_ip
}

output "rds_endpoint" {
  description = "Postgres endpoint (host:port) — host for the DSN parameters"
  value       = aws_db_instance.postgres.endpoint
}

output "rds_master_secret_arn" {
  description = "Secrets Manager secret holding the RDS master password"
  value       = one(aws_db_instance.postgres.master_user_secret[*].secret_arn)
}

output "objects_bucket" {
  description = "S3 bucket for documents, tenant media, ZATCA XML archive"
  value       = aws_s3_bucket.objects.bucket
}

output "deploy_role_arn" {
  description = "GitHub OIDC deploy role — set as AWS_DEPLOY_ROLE_ARN on the GitHub 'staging' environment"
  value       = aws_iam_role.github_deploy.arn
}

output "shell_command" {
  description = "Shell onto the VM (no SSH by design)"
  value       = "aws ssm start-session --target ${aws_instance.vm.id} --region ${var.aws_region}"
}
