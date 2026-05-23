# syntax=docker/dockerfile:1.7
# Build context: repository root. Set RAILWAY_DOCKERFILE_PATH=infra/docker/ui.Dockerfile.
#
# NEXT_PUBLIC_* env vars are baked at build time. Pass them as Railway "Build Args"
# (or set them as service env vars — Railway also forwards those to the build).

ARG NODE_VERSION=22-alpine

# ---------- deps ----------
FROM node:${NODE_VERSION} AS deps
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/ui/package.json     packages/ui/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN pnpm install --frozen-lockfile --filter "@vantage/ui..."

# ---------- builder ----------
FROM deps AS builder
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_NAME=Vantage
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
# next-auth requires AUTH_SECRET to be present at build time when middleware imports auth().
ENV AUTH_SECRET=build-time-placeholder
ENV NEXT_TELEMETRY_DISABLED=1

COPY packages/shared packages/shared
COPY packages/ui     packages/ui

RUN pnpm --filter "@vantage/shared" build \
 && pnpm --filter "@vantage/ui" build

# ---------- runtime ----------
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Next.js standalone output bundles everything it needs (server.js + minimal node_modules).
# outputFileTracingRoot=../../ keeps workspace deps in the bundle.
COPY --from=builder /app/packages/ui/.next/standalone ./
COPY --from=builder /app/packages/ui/.next/static     ./packages/ui/.next/static
COPY --from=builder /app/packages/ui/public           ./packages/ui/public

# Railway injects PORT; Next's standalone server.js honors HOSTNAME + PORT.
ENV HOSTNAME=0.0.0.0
WORKDIR /app/packages/ui
CMD ["node", "server.js"]
