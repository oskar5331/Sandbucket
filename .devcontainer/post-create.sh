#!/usr/bin/env bash
# Runs once when the container is created (devcontainer.json postCreateCommand).
# Every step is idempotent, so a rebuild re-running it is harmless.
set -euo pipefail

cd /workspace

# ── 1. Volume ownership ────────────────────────────────────────────────────
# Named volumes are created root-owned; hand them to `node` before anything writes.
sudo chown -R node:node /workspace/node_modules /commandhistory "$CLAUDE_CONFIG_DIR"

# ── 2. Claude user settings ────────────────────────────────────────────────
# Seeded only when the config volume has none yet — after that, whatever is
# changed inside Claude Code (/config, /model) wins.
[ -f "$CLAUDE_CONFIG_DIR/settings.json" ] \
  || cp .devcontainer/claude-user-settings.json "$CLAUDE_CONFIG_DIR/settings.json"

# ── 3. Claude memory → host folder ─────────────────────────────────────────
# Claude Code keeps per-project auto-memory at <config>/projects/<slug>/memory,
# where <slug> is the working dir with `/` → `-` (/workspace → -workspace).
# Pointing that at .devcontainer/claude-memory puts the memory on the host disk:
# readable/editable from the editor, and it outlives the config volume.
# The folder is gitignored — memories are personal working notes, not repo content.
MEMORY_SRC=/workspace/.devcontainer/claude-memory
MEMORY_LINK="$CLAUDE_CONFIG_DIR/projects/-workspace/memory"
mkdir -p "$MEMORY_SRC" "$(dirname "$MEMORY_LINK")"
[ -f "$MEMORY_SRC/MEMORY.md" ] || printf '# Memory index\n' > "$MEMORY_SRC/MEMORY.md"
if [ ! -L "$MEMORY_LINK" ]; then
  # A real directory here means memories were written before the link existed —
  # fold them into the host folder (never overwriting) instead of deleting them.
  if [ -d "$MEMORY_LINK" ]; then
    cp -an "$MEMORY_LINK/." "$MEMORY_SRC/"
    rm -rf "$MEMORY_LINK"
  fi
  ln -s "$MEMORY_SRC" "$MEMORY_LINK"
fi

# ── 4. Shell ───────────────────────────────────────────────────────────────
grep -q '.devcontainer/zshrc' ~/.zshrc 2>/dev/null \
  || echo '[ -f /workspace/.devcontainer/zshrc ] && source /workspace/.devcontainer/zshrc' >> ~/.zshrc

# ── 5. Project deps + env ──────────────────────────────────────────────────
[ -f package.json ] && pnpm install
[ -f pyproject.toml ] && uv sync
[ -f .env ] || [ ! -f .env.example ] || cp .env.example .env

# ── 6. Playwright browsers ─────────────────────────────────────────────────
# Same script CI runs, so the browser list lives only in package.json. Browsers
# land in ~/.cache/ms-playwright (not a volume), so a rebuild re-downloads them;
# the version follows the lockfile. --with-deps apt-installs the system libs via sudo.
if [ -f package.json ] && grep -q '"test:e2e:install"' package.json; then
  pnpm test:e2e:install
fi

exit 0
