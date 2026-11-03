# syntax=docker/dockerfile:1.7
#
# Production image: the same image runs on Fly and for self-hosters, differing only
# in environment variables (docs/prd.md §17). `next start` on Node, plus dbmate for
# migrations (§29 release_command). Node version: .node-version (a test keeps every
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

FROM node:26.13.0-bookworm-slim AS dbmate
ARG TARGETARCH
ARG DBMATE_VERSION=2.37.0
# The release publishes no checksums file; these were computed from the release
# binaries on 2026-11-03 and pin future builds to the same bytes.
RUN case "$TARGETARCH" in \
      amd64) sha=f855e99a0f0a81322014bf686b1cb820d2b4d8074e4eadafd64b851b80ecb15a ;; \
      arm64) sha=42de2bf27989192b9ca8db4cfaa0a9d6b4aee154a03abef30239b7186b1baf82 ;; \
      *) echo "unsupported TARGETARCH '$TARGETARCH'" >&2; exit 1 ;; \
    esac \
 && node -e 'fetch(process.argv[1]).then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); require("fs").writeFileSync("/dbmate", Buffer.from(await r.arrayBuffer())); })' \
      "https://github.com/amacneil/dbmate/releases/download/v${DBMATE_VERSION}/dbmate-linux-${TARGETARCH}" \
 && echo "${sha}  /dbmate" | sha256sum -c - \
 && chmod +x /dbmate

FROM node:26.13.0-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --chown=node:node package.json next.config.ts ./
COPY --from=dbmate /dbmate /usr/local/bin/dbmate
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]
