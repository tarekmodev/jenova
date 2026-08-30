#!/usr/bin/env bash
# Jenova staging deploy — invoked by .github/workflows/deploy-staging.yml via
# SSM Run Command (and usable by hand for rollback: pass a previous tag).
#
#   deploy.sh <image-tag> [ghcr-user] [ghcr-token]
#
# ghcr-user/token are optional: pass them while the GHCR package is private
# (the workflow forwards the job's short-lived GITHUB_TOKEN); once the package
# is public they can be omitted.
set -euo pipefail

TAG="${1:?usage: deploy.sh <image-tag> [ghcr-user] [ghcr-token]}"
GHCR_USER="${2:-}"
GHCR_TOKEN="${3:-}"

cd /opt/jenova

if [ -n "$GHCR_TOKEN" ]; then
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
fi

# Refresh runtime configuration from SSM, then pin the image tag (compose
# interpolates JENOVA_TAG from this .env).
./fetch-env.sh
printf 'JENOVA_TAG=%s\n' "$TAG" >> .env

docker compose pull api

# Migration fan-out: dry-run first, then apply — per-tenant failure isolation
# and resume live in the @jenova/db CLI (completed databases are recorded and
# skipped on re-run). A dry-run failure aborts before anything is touched.
docker compose run --rm --no-deps api pnpm --filter @jenova/db migrate:fanout
docker compose run --rm --no-deps api pnpm --filter @jenova/db migrate:fanout -- --apply

docker compose up -d --remove-orphans
docker image prune -f

echo "deployed $TAG"
