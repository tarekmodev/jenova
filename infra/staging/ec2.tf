# The staging VM: Ubuntu 24.04 LTS, docker + compose via cloud-init.
# Everything the platform runs (api, worker, redis) is a container on this
# box; deploys land via SSM Run Command (no SSH — see network.tf).

data "aws_ssm_parameter" "ubuntu_ami" {
  # Canonical's official Ubuntu 24.04 LTS amd64 AMI pointer for this region.
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

resource "aws_instance" "vm" {
  ami                         = data.aws_ssm_parameter.ubuntu_ami.value
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.public.id
  vpc_security_group_ids      = [aws_security_group.vm.id]
  iam_instance_profile        = aws_iam_instance_profile.vm.name
  associate_public_ip_address = true # boot-time egress (apt/snap) before the EIP attaches

  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    compose   = file("${path.module}/files/docker-compose.yml")
    fetch_env = file("${path.module}/files/fetch-env.sh")
    deploy    = file("${path.module}/files/deploy.sh")
  })
  user_data_replace_on_change = true

  metadata_options {
    http_tokens = "required" # IMDSv2 only
  }

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
    encrypted   = true
  }

  lifecycle {
    # Canonical rolls the AMI pointer forward; don't rebuild the VM on every
    # apply. Taint the instance deliberately to take a new base image.
    ignore_changes = [ami]
  }

  tags = {
    Name = "jenova-staging"
  }
}

resource "aws_eip" "vm" {
  domain   = "vpc"
  instance = aws_instance.vm.id

  tags = {
    Name = "jenova-staging"
  }
}
