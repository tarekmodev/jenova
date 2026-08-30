# --- VM instance role -------------------------------------------------------
# SSM-managed (Session Manager shell + Run Command deploys — no SSH keys),
# reads /jenova/staging/* parameters, owns the objects bucket.

data "aws_iam_policy_document" "vm_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "vm" {
  name               = "jenova-staging-vm"
  assume_role_policy = data.aws_iam_policy_document.vm_assume.json
}

resource "aws_iam_role_policy_attachment" "vm_ssm_core" {
  role       = aws_iam_role.vm.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "vm_runtime" {
  statement {
    sid = "ReadRuntimeParameters"
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
    ]
    resources = [
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/jenova/staging",
      "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/jenova/staging/*",
    ]
  }

  statement {
    sid       = "DecryptSecureStringsViaSsm"
    actions   = ["kms:Decrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }

  statement {
    sid       = "ObjectsBucketList"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.objects.arn]
  }

  statement {
    sid = "ObjectsBucketReadWrite"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.objects.arn}/*"]
  }
}

resource "aws_iam_role_policy" "vm_runtime" {
  name   = "jenova-staging-vm-runtime"
  role   = aws_iam_role.vm.id
  policy = data.aws_iam_policy_document.vm_runtime.json
}

resource "aws_iam_instance_profile" "vm" {
  name = "jenova-staging-vm"
  role = aws_iam_role.vm.name
}

# --- GitHub Actions OIDC deploy role ----------------------------------------
# Assumed by the deploy job in .github/workflows/deploy-staging.yml via
# aws-actions/configure-aws-credentials — no long-lived AWS keys in GitHub.
# Trust is pinned to this repo's "staging" environment.

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  thumbprint_list = [
    # AWS validates GitHub's cert chain against its own trust store these
    # days; the API still requires thumbprints, so pin the published pair.
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd",
  ]
}

data "aws_iam_policy_document" "github_deploy_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:staging"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "jenova-staging-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_deploy_assume.json
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid     = "RunDeployScriptOnVm"
    actions = ["ssm:SendCommand"]
    resources = [
      "arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript",
      "arn:aws:ec2:${var.aws_region}:${data.aws_caller_identity.current.account_id}:instance/${aws_instance.vm.id}",
    ]
  }

  statement {
    sid = "ReadCommandResults"
    actions = [
      "ssm:GetCommandInvocation",
      "ssm:ListCommands",
      "ssm:ListCommandInvocations",
      "ssm:DescribeInstanceInformation",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "jenova-staging-github-deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}
