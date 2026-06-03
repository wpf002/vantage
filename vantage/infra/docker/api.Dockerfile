# syntax=docker/dockerfile:1.7
# Build context: repository root (the directory containing pnpm-workspace.yaml).
# Set RAILWAY_DOCKERFILE_PATH=infra/docker/api.Dockerfile on the Railway service.

ARG NODE_VERSION=22-alpine

# ---------- deps ----------
FROM node:${NODE_VERSION} AS deps
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Copy lockfile + workspace manifests first so install caches across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/api/package.json                  packages/api/package.json
COPY packages/classification/package.json       packages/classification/package.json
COPY packages/core-private/package.json         packages/core-private/package.json
COPY packages/core-public/package.json          packages/core-public/package.json
COPY packages/data-ingest/package.json          packages/data-ingest/package.json
COPY packages/explanation/package.json          packages/explanation/package.json
COPY packages/harmonizer/package.json           packages/harmonizer/package.json
COPY packages/portfolio/package.json            packages/portfolio/package.json
COPY packages/shared/package.json               packages/shared/package.json
COPY packages/simulation/package.json           packages/simulation/package.json

RUN pnpm install --frozen-lockfile --filter "@vantage/api..."

# ---------- builder ----------
FROM deps AS builder
COPY packages/api          packages/api
COPY packages/classification packages/classification
COPY packages/core-private packages/core-private
COPY packages/core-public  packages/core-public
COPY packages/data-ingest  packages/data-ingest
COPY packages/explanation  packages/explanation
COPY packages/harmonizer   packages/harmonizer
COPY packages/portfolio    packages/portfolio
COPY packages/shared       packages/shared
COPY packages/simulation   packages/simulation
COPY infra/migrations      infra/migrations
# Runtime reads these at request time (e.g. private peer sets in
# routes/private.ts via ../../infra/seeds). Without them, private valuations
# 404 with "peer set not found".
COPY infra/seeds           infra/seeds

# turbo respects dependsOn so this builds shared/core/etc. first, then api.
RUN pnpm --filter "@vantage/api" build

# Reinstall with --prod to strip devDependencies; pnpm rewires symlinks correctly.
RUN pnpm install --prod --frozen-lockfile --filter "@vantage/api..."

# ---------- runtime ----------
FROM node:${NODE_VERSION} AS runtime
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
ENV NODE_ENV=production
WORKDIR /app

# Ship the entire pruned workspace tree from the builder. This preserves pnpm's
# symlink layout (root-level .pnpm store + per-package node_modules) so workspace
# packages can resolve their declared third-party deps (e.g. shared/dist → zod).
COPY --from=builder /app /app

WORKDIR /app/packages/api
# Railway injects PORT; index.ts honors it via process.env.PORT.
# Run migrations on each boot so a fresh Postgres is brought up to current schema.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/db/ensure-private-companies.js && node dist/index.js"]
