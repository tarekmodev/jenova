#!/usr/bin/env bash
# Rebuilds /opt/jenova/.env from SSM Parameter Store (/jenova/staging/*).
# Secrets live ONLY in the parameter store; this file is the sole place they
# touch disk on the VM (chmod 600). Region is fixed: staging is me-south-1.
set -euo pipefail

REGION="me-south-1"
OUT="/opt/jenova/.env"

TMP="$(mktemp)"
aws ssm get-parameters-by-path \
  --path /jenova/staging \
  --with-decryption \
  --region "$REGION" \
  --query "Parameters[].[Name,Value]" \
  --output text |
while IFS=$'\t' read -r name value; do
  printf '%s=%s\n' "${name##*/}" "$value"
done > "$TMP"

chmod 600 "$TMP"
mv "$TMP" "$OUT"
