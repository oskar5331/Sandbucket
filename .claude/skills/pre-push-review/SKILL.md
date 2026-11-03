---
name: pre-push-review
description: "Fast housekeeping sweep over the local branch diff before commit/push. Reports obvious mechanical clean-up items (debug residue, stray files, malformed TODOs, WIP commit subjects, empty scaffolding, new lint warnings on touched files, failures from any test commands the project configures for local runs) plus a small set of judgement flags (suspicious unused symbols, duplicated helpers, missing changelog entry if the project keeps one) and reminders to sync docs whose documented surface changed. Report-only by default: never deletes, rewrites, squashes, or modifies files unless the human explicitly asks. Out of scope: code correctness, design, architecture, security, comment policing, judging doc content. Triggers: human invokes /pre-push-review, says they are about to commit / push / open a PR, or earlier conversation reminded them to run it."
metadata:
  author: project
  version: "1.1.0"
---

# Pre-push review

A fast housekeeping sweep over the local branch diff before push. It reports
obvious cleanup issues. It does not judge correctness, architecture, security,
or design — those belong to the PR reviewer.

## Project configuration — fill this in per project

Everything project-specific lives in this section; the rest of the skill reads
from it. Delete a row's check (or write `none`) when it does not apply — an
unfilled placeholder must never be guessed at.

| Setting | Value |
|---|---|
| Base branch | `main` |
| Lint command (run on touched files only) | `pnpm exec eslint --max-warnings 0 <files>` — not `pnpm lint <files>`, whose script is `eslint .` and would lint the whole repo. CI runs with `--max-warnings 0`, so every warning is CI-blocking: report warnings as mechanical findings, not judgement. |
| Test commands the sweep RUNS locally, with path triggers | `pnpm typecheck`, then `pnpm test` — always, on any diff. No path trigger: the existing tests guard non-source files (`tests/lint/` covers `eslint.config.js`; `tests/infra/version-consistency.test.ts` covers `.node-version`, `Dockerfile`, `compose.yaml`, `.github/workflows/*`, `package.json`). |
| Checks deferred to CI (reported, never run here) | `pnpm build`, `pnpm size`, `pnpm test:e2e` (needs the production Docker image), full-repo lint — `.github/workflows/pr.yml` jobs `checks` and `e2e` |
| Commands that must never run concurrently | `none` yet. From M1, integration tests and `test:e2e` share the compose Postgres — run them sequentially. |
| TODO comment shape | `TODO: <description>` |
| Vendor / generated paths to skip | `pnpm-lock.yaml` (from M1, also the kysely-codegen output) |
| Changelog file + rules | `none` |
| Documented-surface doc pairs | See [Documented-surface sync](#documented-surface-sync-reminder) |
| Project rule checks (optional) | See [Project rule checks](#project-rule-checks) |

## Operating rules

1. **Report-only.** Report findings and suggest safe edits. Do not delete,
   rewrite, reformat, reorder, squash, or otherwise modify files or git history
   unless the human explicitly asks for the edit.
2. **Cap output at 10 findings.** Highest-confidence first. If more exist,
   append `plus <N> lower-priority items` rather than padding the list.
3. **Separate confidence levels.** Mechanical checks are facts; judgement checks
   are "consider" suggestions the human will weigh.
4. **Empty sweep is a valid result.** Say "clean" when it is clean — do not
   invent findings to look thorough.
5. **Never claim a check you did not run.** A check reported as passed when it
   did not run is worse than an absent one. Deferred checks are reported as
   `deferred to CI`; skipped ones as `skipped — <reason>`.

## When to run

- Human invokes `/pre-push-review`.
- Human says they are about to commit a feature, push, or open a PR.
- Earlier conversation reminded them to run it.

## How to run

1. Pick the comparison ref. With `<base>` = the configured base branch:
   - If `git remote` lists `origin`: `git fetch origin <base> --quiet`, and
     `<ref>` = `origin/<base>`.
   - Otherwise `<ref>` = the local `<base>`.
   - If HEAD **is** `<base>` (working directly on it), there is no committed
     branch diff: scan only uncommitted + untracked changes, and report the
     commit-list checks as `skipped — on base branch`.
   State the comparison used in the `Checks:` line (e.g. `diff: working tree vs
   HEAD on main, no remote`).
2. Inspect committed, uncommitted, and untracked changes. Do not rely on memory
   of what was touched.
   - `git status --short` — uncommitted + untracked
   - `git diff HEAD --stat` / `git diff HEAD` — staged + unstaged
   - `git diff --stat <ref>...HEAD` / `git diff <ref>...HEAD` — committed
   - `git log <ref>..HEAD --oneline` — commit list
   - `git ls-files --others --exclude-standard` — untracked files. `git diff`
     never shows their contents, so read each one in full and treat every
     line as added.
3. Exclude the configured vendor / generated paths from the scanned diff
   (`git diff -- . ':(exclude)<path>'`) so they do not consume finding slots.
4. Run only the test commands configured to run locally, and only when their
   path trigger matches the diff. Respect the never-concurrent list — run such
   commands sequentially. Do not run deferred checks.
5. Walk the mechanical checks first, then the judgement checks. Stop at 10
   findings; queue the rest as "lower-priority".
6. Present in the output format below. Do not apply destructive suggestions on
   your own.
7. Order relative to `/task-retro`: this sweep runs first, then the retro, then
   the human review. If the sweep leads to fixes, the retro covers them too.

## Mechanical checks (high confidence)

These are facts: either the pattern is in the diff or it isn't. Only lines
**added or modified by the branch** are in scope — leave pre-existing noise on
touched-but-unchanged lines alone.

- **Debug residue.** Leftover debug output in the language's idiom
  (`console.log`, `print(`, `dbg!`, `fmt.Println`, `var_dump`, …); focused or
  skipped tests (`.only`, `.skip`, `@Disabled`, `xit`, `pytest.mark.skip` with no
  reason); type-checker or linter suppressions (`@ts-ignore`, `# type: ignore`,
  `eslint-disable`, `noqa`, `#[allow(...)]`, …) with no one-line justification
  on the same or adjacent line.
- **Stray tracked files.** `.env*`, editor scratch (`*.swp`, `.DS_Store`,
  `.idea/`), one-off scripts staged by accident, build / coverage artifacts the
  repo does not normally commit. Check `git status` and the staged tree.
- **Malformed TODO comments.** Anything matching `TODO` / `FIXME` / `XXX` /
  `HACK` that does not match the configured TODO shape. Empty descriptions
  (`TODO: fix`, `TODO: later`) always fail. If no shape is configured, flag only
  empty descriptions.
- **WIP commit subjects.** Any branch commit with a subject like `WIP`, `wip`,
  `fixup`, `tmp`, `asdf`, `...`, or empty. Flag for reword / squash; do not
  rewrite history on the human's behalf.
- **Empty scaffolding.** Function / component / handler bodies that return a
  placeholder, `pass`, `todo!()`, `throw new Error("not implemented")` or
  equivalent, with no TODO comment explaining the stub. Flag the symbol; do not
  fill it in.
- **New lint warnings.** If a lint command is configured, run it on the touched
  files only. For each warning on a branch-changed line, recommend one of:
  - **Clean up** — no visible reason to keep it (unused import, dead variable,
    refactor leftover). Propose the fix; the human approves before any deletion.
  - **Park with a TODO** — belongs to in-progress work. Add a TODO in the
    configured shape stating what is left and why.
  - **Keep / suppress** — known false positive or genuinely required. Recommend
    an inline suppression with a one-line reason.
- **Failing local test commands.** Each failing configured command is a
  mechanical finding: name the command, the failing test(s) or first error with
  file:line, and one line on what to look at. Do not fix failures yourself. If
  the output shows a connection / service-unavailable error rather than
  assertions, report the missing service (e.g. "local database down") as the
  cause instead of flagging the tests as broken.
- **Edited vendor code.** Content changes inside a configured vendor path that
  do not look like a regenerated / re-installed copy. Flag the file; suggest
  re-installing, or a one-line comment if the edit is intentional.

### Project rule checks

Mechanical, project-specific rules — each one a pattern in the branch-added
lines that the project's own conventions forbid. Rules already enforced by lint
or a test (e.g. the `lib/db/unsafe` import quarantine) are deliberately not
repeated here.

- **Box-drawing tables** — any of `┌ ┐ └ ┘ │ ─ ├ ┤ ┬ ┴ ┼` in added lines of
  `*.md` files or chat-facing templates. Tables must be pipe-delimited markdown
  (documented in `CLAUDE.md`, "Render tables as delimited markdown").
- **Real-looking people or domains in test data** — email addresses or
  hostnames in `tests/**`, `e2e/**`, or seed / fixture files whose TLD is not
  `.test` (`localhost` and service names from `compose.yaml` such as `postgres`
  or `garage` are fine). Documented in `CLAUDE.md`, "No real people or
  customers in fixtures".
- **Ranged dependency versions** — a `^` or `~` (or `*`, `latest`, `x`) in a
  `dependencies` / `devDependencies` version added to `package.json`. Versions
  are exact pins (documented in `docs/stack-versions.md`).

## Judgement checks (lower confidence — frame as "consider")

The human knows their codebase better than the diff does. Surface the item and
the reason it might or might not matter; let them decide.

- **Suspicious unused symbols.** Exports, components, routes, functions, jobs
  added by the branch with no obvious in-tree caller. Flag as suspicious — **not**
  automatically dead. Framework-discovered code routinely looks unreferenced when
  it is not: file-based routes, dynamic imports, handlers registered by name,
  config references. Ask the human to confirm before any deletion.
- **Changelog entry.** If a changelog is configured and the branch adds
  user-visible change with no entry, flag it. The configured rules define what
  counts and how it is shaped.
- **Duplicate code worth a helper.** Top-level functions or constants whose
  signature (or name + body shape) is identical across 2+ new locations in the
  diff. Each site passes review alone; the diff as a whole reveals an extraction
  candidate. List the file:line sites and, where the canonical home is obvious,
  suggest it.
- **`UNSAFE_DB_ALLOWLIST` changed.** Any added or removed entry in
  `eslint.config.js`. Lint enforces the quarantine, but `eslint.config.js`
  states that adding an entry is a review event (`prd.md` §12, §19): name the
  file added and ask the human to confirm it is an audited bootstrap path.
- **New uncovered copy of the Node version.** An added `FROM node:`,
  `image: node:`, `node-version:`, or similar version literal in a file that
  `tests/infra/version-consistency.test.ts` does not parse. The test only
  covers copies it was taught about, so a new one drifts silently.

## Documented-surface sync (reminder)

Docs in this repo do not declare the source paths they cover, so the pairs are
listed here. If the diff touches the source **and** the doc is _not_ in the
diff, surface a one-line reminder to update the doc. This check **reminds**, it
does not enforce — it never edits a doc or judges its content.

| Source changed | Doc to sync | Why |
|---|---|---|
| A dependency or `packageManager` version in `package.json`, or `.node-version` | `docs/stack-versions.md` (version + verification date) | That doc requires bumping both in the same pull request. |
| `.github/workflows/pr.yml` jobs or steps | `docs/prd.md` §29 (and §28 if a test layer changed) | §29 defines the merge gate the workflow implements. |
| Services or images in `compose.yaml`, or `.devcontainer/` | `CLAUDE.md`, "Dev environment" | That section names the sidecars and their ports. |

- Skip when the doc was already touched in the diff, or when the change does
  not affect what the doc states (e.g. a comment-only edit).
- Render reminders in their own output block; they do not count against the
  10-finding cap.

## Out of scope

- Code correctness, logic, edge cases
- Architecture, design choices, abstraction-vs-inline judgement
- Security, authorization, data-isolation invariants
- Migration / schema-design audits
- Comment policing beyond the TODO shape rule
- Judging the content or quality of documentation

A dedicated code-review / security-review pass or the PR reviewer covers those.

## Output format

```
Pre-push sweep — <N> findings  (mechanical: <M>, judgement: <J>)
Checks: <command> — <passed | failed, see findings | skipped — <reason> | deferred to CI>; …

Mechanical:
  - <file:line> — <what>: <suggested fix>

Judgement (consider):
  - <file:line> — <what>: <why this might or might not matter>

Doc sync (reminder):
  - <doc path> — <changed surface>: update the doc

plus <K> lower-priority items.
```

Omit any empty block. Reminder lines do not count toward `<N>`.

Clean sweep:

```
Pre-push sweep — clean. Diff: <N> files, <N> lines. Nothing obvious.
Checks: <command> — <passed | skipped — <reason> | deferred to CI>; …
```

One line per finding. Total ≤ 10. The human is about to push — they want a
short list they can act on, not a review essay.

## Cleanup commit (opt-in)

Only when the human asks to apply and record the sweep: stage only the approved
fixes (no unrelated feature work) and make one commit whose subject starts with
`chore(cleanup): pre-push-review sweep —`, followed by what was done. List any
findings left unfixed, with the reason, in the commit body.
