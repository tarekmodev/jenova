# syntax=docker/dockerfile:1
# The one containerized artifact for every environment and hosting tier
# (docs/10-operations.md): the same image carries apps/api, apps/worker and
# the @jenova/db fan-out migration CLI — which process a container runs is
# chosen by its command, configuration (env) is the only other difference.
#
# Pre-M0 the apps execute TypeScript directly via tsx (no per-app build
# output exists yet), so the runtime stage keeps the full workspace install.
# When apps grow compiled `build` outputs, add a build step here and prune
# to production dependencies — the two-stage shape below already drops the
# pnpm store and build-time caches from the final image.

FROM node:22-slim AS deps
# Pin pnpm to the workspace's packageManager version (root package.json).
RUN npm install -g pnpm@11.24.0
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

FROM node:22-slim AS runtime
RUN npm install -g pnpm@11.24.0
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app /app
EXPOSE 3000
# Default process: the API. The worker (and one-off migration runs) override:
#   pnpm --filter @jenova/worker start
#   pnpm --filter @jenova/db migrate:fanout [-- --apply]
CMD ["pnpm", "--filter", "@jenova/api", "start"]
