# Object storage: documents, tenant media, ZATCA XML archive (docs/07).
# Versioned per docs/10 ("object store versioning for documents").

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "objects" {
  bucket = "jenova-staging-objects-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_versioning" "objects" {
  bucket = aws_s3_bucket.objects.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "objects" {
  bucket = aws_s3_bucket.objects.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "objects" {
  bucket = aws_s3_bucket.objects.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
