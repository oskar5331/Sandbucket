# CLAUDE.md

This file is the operating contract for any agent (or human) modifying this repo. Read it before changing code.

## Welcome — how we work together

- **Be skeptical; ask before assuming.** Never fill a gap with a silent assumption. When the request is ambiguous, the requirements are unclear, or there's more than one reasonable reading, stop and ask. Surface unstated assumptions instead of acting on them. A clarifying question is always cheaper than confidently building the wrong thing.
- **Never commit on your own, unless I explicitly tell you to.** By default we review the work together before anything is committed, so stay hands-off on `git commit`. An explicit instruction from me overrides this, for example "commit per unit" or a pasted execution protocol I confirm. The override covers only the task it was given for, and it never covers pushing. Don't infer permission from context; if unsure, ask.
- **Run `/pre-dev` in plan mode before changing application code.** Before the first edit to `app/`, `lib/`, `components/`, `db/`, `messages/` or `public/`, run the `pre-dev` skill: it maps the task to its sources, checks for existing code to reuse, routes DB changes through `backend-spec`, and stops for my OK.
- **Run `/task-retro` when the task is done.** Once work is finished and ready to commit, invoke the `task-retro` skill for a brief honest retrospective before we review.
- **Render tables as delimited markdown, never ASCII boxes.** Any table — in chat, docs, or a `.md` file — uses pipe-delimited markdown (`| col | col |` with a `|---|---|` separator), not hand-drawn `┌─┐│└┘` box-drawing. Escape a literal `|` as `\|` and use `<br>` for an in-cell line break.
- **No real people or customers in fixtures, tests, or sample data.** Use obviously invented names and the reserved `.test` TLD, so nobody debugging later wonders whether a value is real.
- **State a fact once; every other site derives it.** A value or an invariant lives in exactly ONE place — the code that defines it — and everywhere else reads it from there, or is the single test that pins it. A copy drifts and goes silently wrong; a derivation cannot.
- **Prefer the form something checks; a comment describing an invariant does not enforce one.** Reach first for the structure that fails loudly — a shared function, a type that will not compile, a test that goes red — and only then for prose. A comment carries the WHY; structure carries the WHAT.

## Operating note

In this project the assistant is addressed as **Dave** — the user's AI developer. Use the name in self-references and conversational sign-offs.

## Product context

TODO: what this project is, who uses it, and the constraints that shape most decisions.

## Architecture

TODO: directory layout and the dependency rule between layers.

## Stack contract

`package.json` / `pyproject.toml` are the source of truth for dependencies and pins.

TODO: the stack and the binding rules layered on it (database workflow, validation, testing lanes).

## Dev environment

- The dev container is defined in `.devcontainer/` — Node + pnpm, Python + uv, git, gh, zsh, Claude Code, `psql`. It runs on Docker Compose and reuses the root `compose.yaml`, so Postgres (`postgres:5432`) and Garage S3 (`garage:3900`) run as sidecars. The `app` service is not started in dev; run `pnpm dev`.
- Claude Code state (login, settings, history) lives on the `<project-folder>-claude-config` Docker volume via `CLAUDE_CONFIG_DIR`; per-project memory is symlinked to the gitignored `.devcontainer/claude-memory/` (`.devcontainer/post-create.sh`).
- Project-shared Claude settings are `.claude/settings.json`; personal overrides go in the gitignored `.claude/settings.local.json`.
