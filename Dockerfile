# syntax=docker/dockerfile:1.7
#
# Production image: the same image runs on Fly and for self-hosters, differing only
# in environment variables (docs/prd.md §17). `next start` on Node. Migrations run
# `prisma migrate deploy` from this image (§29 release_command); the Prisma CLI and
# prisma/ arrive with the first migration. Node version: .node-version (a test keeps every
# FROM below in step with it).

FROM node:26.13.0-bookworm-slim AS base
# Node 25+ no longer bundles corepack.
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN npm install -g corepack@0.36.0 && corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build && rm -rf .next/cache

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod

FROM node:26.13.0-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --chown=node:node package.json next.config.ts ./
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
