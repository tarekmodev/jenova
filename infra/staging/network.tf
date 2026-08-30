# Minimal VPC: one public subnet for the VM, two private subnets (RDS
# subnet groups require two AZs). Nothing in the private subnets initiates
# outbound traffic, so there is deliberately NO NAT gateway (~US$45/mo saved).

data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "staging" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = "jenova-staging"
  }
}

resource "aws_internet_gateway" "staging" {
  vpc_id = aws_vpc.staging.id

  tags = {
    Name = "jenova-staging"
  }
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.staging.id
  cidr_block        = "10.20.0.0/24"
  availability_zone = data.aws_availability_zones.available.names[0]

  tags = {
    Name = "jenova-staging-public"
  }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.staging.id
  cidr_block        = "10.20.1${count.index}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "jenova-staging-private-${count.index}"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.staging.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.staging.id
  }

  tags = {
    Name = "jenova-staging-public"
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# --- Security groups --------------------------------------------------------

# VM: API/HTTP(S) from anywhere. NO SSH ingress by design — shell access is
# AWS SSM Session Manager only (aws ssm start-session --target <instance-id>).
resource "aws_security_group" "vm" {
  name        = "jenova-staging-vm"
  description = "Staging VM - public API ingress only; shell via SSM"
  vpc_id      = aws_vpc.staging.id

  ingress {
    description = "HTTP (compose maps 80 to api:3000)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS (reserved for TLS termination, M4)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "API port direct"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "All outbound (supplier sandboxes, GHCR, apt, AWS APIs)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "jenova-staging-vm"
  }
}

# RDS: Postgres reachable ONLY from the VM security group. Redis runs as a
# container on the VM itself (see README) and is never exposed outside the
# compose network, so it needs no security group at all.
resource "aws_security_group" "rds" {
  name        = "jenova-staging-rds"
  description = "Staging Postgres - ingress from the VM only"
  vpc_id      = aws_vpc.staging.id

  ingress {
    description     = "Postgres from the staging VM"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.vm.id]
  }

  tags = {
    Name = "jenova-staging-rds"
  }
}
