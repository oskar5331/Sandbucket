# syntax=docker/dockerfile:1.7
#
# Vanilla dev container: Node + pnpm, Python + uv, git, gh, zsh, Claude Code CLI.
# Postgres client included; the database itself runs as a Compose sidecar.

FROM node:26-bookworm-slim

# pnpm via corepack. Pin the version so every rebuild gets the same pnpm; once the
# project has a package.json, its "packageManager" field takes over.
ARG PNPM_VERSION=12.16.1
ENV PNPM_HOME=/home/node/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH

# Claude Code is installed globally but the container runs as `node`. A root-owned
# global npm dir makes `claude update` fail with "npm global folder isn't writable",
# so npm's global prefix points at a node-owned dir.
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV PATH=/home/node/.npm-global/bin:$PATH

# Corepack's pnpm download cache, owned by `node` so the user the container runs as
# reuses the version prepared at build time instead of fetching it again.
ENV COREPACK_HOME=/home/node/.cache/node/corepack

# Keep ALL Claude Code state (login, settings, history AND ~/.claude.json, which
# otherwise sits outside ~/.claude) in one dir, so one volume preserves it.
ENV CLAUDE_CONFIG_DIR=/home/node/.claude

# python3 (bookworm ships 3.11) + venv/pip for anything that expects the system
# toolchain; build-essential so native Node/Python packages can compile.
# Node 25+ no longer bundles corepack, so it is installed from npm first.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       git zsh zsh-autosuggestions zsh-syntax-highlighting \
       curl ca-certificates openssl procps less jq unzip \
       python3 python3-venv python3-pip build-essential \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /home/node/.npm-global "$PNPM_HOME" "$COREPACK_HOME" /home/node/.claude \
    && npm install -g corepack@0.36.0 @anthropic-ai/claude-code \
    && corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
    && chown -R node:node /home/node/.npm-global /home/node/.local /home/node/.cache /home/node/.claude

# psql + pg_dump from the PostgreSQL apt repo (PGDG), matching the compose server's
# major: dbmate's schema dump needs a pg_dump at least as new as the server
# (a test keeps the two majors in step).
RUN install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
       https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-17 \
    && rm -rf /var/lib/apt/lists/*

# uv — fast Python package/venv/version manager (`uv venv`, `uv pip`, `uv python install`).
# Copied from its official image instead of curl|sh so the build is reproducible.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /workspace
CMD ["sleep", "infinity"]
