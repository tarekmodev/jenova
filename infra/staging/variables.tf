variable "aws_region" {
  description = "AWS region (docs/07: me-south-1 first)"
  type        = string
  default     = "me-south-1"
}

variable "instance_type" {
  description = "Staging VM instance type (single production-shaped VM, docs/10)"
  type        = string
  default     = "t3.medium"
}

variable "db_instance_class" {
  description = "RDS instance class — frugal pre-revenue staging"
  type        = string
  default     = "db.t3.micro"
}

variable "github_repository" {
  description = "GitHub repo (owner/name) allowed to assume the deploy role via OIDC"
  type        = string
  default     = "tarekmodev/jenova"
}
