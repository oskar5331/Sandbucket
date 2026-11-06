---
name: pre-dev
description: "Pre-coding gate for Sandbucket application code: fires automatically before the first edit to app/, lib/, components/, db/, messages/ or public/ for a task (feature, fix or refactor), and when the human invokes /pre-dev or asks what needs checking before coding. Maps the task to its PRD decisions, user story and roadmap milestone; searches for existing components, schemas, helpers, messages and test harnesses so nothing gets duplicated; lists the cross-cutting obligations (tenant accessor, Zod boundary, i18n, role tests, mobile, size budget); hands any database change to backend-spec; and collects every questionable point as an explicit question. Produces a checklist and STOPS for the human's confirmation before any code is written. Plan-only: never edits files. Skips infra/CI/docs/test-only changes."
metadata:
  author: project
  version: "1.0.0"
---

# pre-dev

The gate **before** application code changes. It answers three questions, then stops:

1. **What exactly are we building, and where is it decided?** (PRD §, story, milestone)
2. **What already exists that we must reuse instead of re-creating?**
3. **What is still unclear?** — each unclear point becomes a question for the human.

If the task touches the database, `backend-spec` runs as part of this gate, not after it.

## Project configuration — Sandbucket

The steps below read from this table. Values point at their source (`§N` = `docs/prd.md` Decisions
Log); if a row and its source disagree, the source wins and this row is fixed.

| Setting | Value |
|---|---|
| Application code (triggers this skill) | `app/`, `lib/`, `components/`, `db/`, `messages/`, `public/` |
| Not application code (skip this skill) | `.devcontainer/`, `.github/`, `compose*`, `Dockerfile`, root config files, `docs/`, test-only changes under `tests/` / `e2e/` |
| Decision sources | `docs/prd.md` (§6 scope, §9 Decisions Log), `docs/user-stories.md`, `docs/business-logic-spec.md`, `docs/cash-custodian.md`, `docs/setup-config.md`, `docs/backlog.md` (parked = out of scope) |
| Plan + order | `docs/roadmap.md` — milestone, its dependencies and exit criteria, cross-cutting rules, open questions |
| Reuse inventory — where existing solutions live | UI: `components/ui/` (shadcn, §15) and `components/`. Validation: `lib/schemas/*.ts` (input + value-object schemas, §13). Data access: `lib/db/` — `forProfile` accessor (§19), generated `lib/db/types.ts`. Money: the `Money` value object (§9). Email: `lib/email/send.ts` (§22). Strings: `messages/en.json` / `messages/et.json` (§16). Design tokens (§27). Tests: `tests/` harnesses (cross-tenant helper from M1), `e2e/` |
| DB-change hand-off | `backend-spec` skill |
| Local checks to name in the plan | `pnpm lint`, `pnpm typecheck`, `pnpm test`; e2e/size are CI (see `pre-push-review`) |

## Operating rules

0. **Run in plan mode.** If the session is not already in plan mode, enter it (`EnterPlanMode`)
   before step 1, or ask the human to switch (Shift+Tab) if that isn't available. Research and
   ask questions inside plan mode; the finished checklist is the plan, presented with
   `ExitPlanMode`, so the human's plan approval is the OK in rule 1.
1. **Plan-only, then stop.** Produce the checklist and **wait for the human's explicit OK** before
   the first edit to application code. A checklist with no open questions still waits.
2. **Search before proposing anything new.** Every new component, schema, helper, message key,
   query or test helper in the plan needs a "searched for, found nothing reusable" line or a
   reuse target. "I didn't look" is never acceptable.
3. **Ask, don't assume.** Anything the sources don't settle, settle only partly, or contradict each
   other on, goes on the question list — with the options you see and your recommendation. Never
   resolve it silently in code.
4. **Point, don't restate.** Cite `§N` / story id / file path; don't copy decision text into the
   plan. A fact lives in one place (CLAUDE.md).
5. **DB changes go through `backend-spec` first.** Its spec is part of this checklist; no
   migration or query on a new shape is planned without it.
6. **Stay small.** A tight checklist, not an essay. Skip a step only if it plainly doesn't apply,
   and say so in one line.

## The checklist

### 1. Pin the task to its sources

- Restate the task in one sentence.
- Find the **user story** (`docs/user-stories.md`) and **PRD sections** that cover it; cite them.
- Find its **roadmap milestone**. Are the milestone's dependencies done? If the task jumps ahead of
  the plan, ask.
- Check `docs/backlog.md` and PRD §6 "Out of Scope — MVP": if the task (or part of it) is parked
  there, ask before building it.
- Check `docs/roadmap.md` **Open questions**: if one blocks this task, it goes on the question list.

### 2. Reuse search — find what already exists

Search the reuse inventory (config table) for every piece the task needs, by name **and** by
behaviour (grep the domain noun, the verb, the field names). For each piece record one of:

- **Reuse** `<path>` as-is.
- **Extend** `<path>` — what changes, and every existing caller still holds.
- **New** — what you searched (`grep`/paths) and why nothing fits.

Look in particular for:
- An existing **Zod schema** or value-object schema (`MoneySchema`, `Uuidv7Schema`, …) before writing
  validation (§13).
- An existing **shadcn component** before writing UI, and `shadcn add` before hand-rolling one (§15).
- An existing **accessor / query** before writing a new query; never reach for `lib/db/unsafe` (§12).
- Existing **message keys** before adding near-duplicate strings (§16).
- An existing **test harness** before writing setup code (the M1 cross-tenant helper, e2e seeds).
- **Two places doing the same thing already** — if the task would add a third, flag it and propose
  consolidating instead.

### 3. Cross-cutting obligations

Name which apply and how the plan meets them (roadmap "Cross-cutting rules"):

- **Tenant isolation** — feature code uses `forProfile` (§19); any owner-handle use is an allowlist
  change and a review event (§12).
- **Validation boundary** — Server Actions / Route Handlers parse input with the shared Zod schema and
  return the `Result<T>` shape (§13).
- **Roles** — every new action: which roles may do it (§6.20 / §32), with allowed **and** refused tests.
- **Money** — `bigint` minor units via `Money` only (§9).
- **i18n** — every user-facing string is a next-intl key with `en` (Estonian may lag, §16).
- **Mobile-first** — designed at 390 px; phone Playwright projects first (§27, §28).
- **Size budget** — initial JS ≤ 200 KB gzip; flag any new client-side dependency (§8, §29).

### 4. Database change? → `backend-spec`

The task is a DB change if it adds or reshapes a table, column, constraint, index, RLS policy,
grant or trigger, or needs data the current schema can't hold. If so:

- Run the `backend-spec` skill now, and put its spec in this checklist.
- Otherwise, write `DB change: none — <why the current schema covers it>`.

### 5. Test plan

List the tests by layer (§28): unit (Vitest), integration against real Postgres, e2e (Playwright).
Name the required ones explicitly — posting tests for new transaction types, role tests,
cross-tenant tests for new tables.

### 6. Questions for the human

Collect every open point from steps 1–5: unclear requirements, source conflicts, scope beyond the
milestone, a reuse-vs-new judgement call, anything `backend-spec` flagged. For each one, give the
options and your recommendation. If there are none, say so explicitly.

## Output format

```
pre-dev — <task>

Sources:     story <id> · PRD §<n>, §<n> · milestone M<n> (deps: <done | not done: …>)
Out of scope / parked: <none | what, and where it is parked>

Reuse:
  - Reuse  <path> — <for what>
  - Extend <path> — <change>; callers checked: <list>
  - New    <thing> — searched: <where/how>; nothing fits because <why>

Obligations: isolation <…> · validation <…> · roles <…> · money <…> · i18n <…> · mobile <…> · size <…>
DB change:   <none — why | backend-spec below>
<backend-spec block, if any>

Tests:       unit <…> · integration <…> · e2e <…>
Files to touch (planned): <paths>

Questions (need your answer before I code):
  1. <question> — options: <a / b>; I'd recommend <x> because <why>
  (or: none — ready to start on your OK)

Waiting for your OK (plan approval) before editing application code.
```

## Out of scope

- **Writing the code, migrations or tests** — that starts only after the human confirms.
- **The per-table data-model decisions** — owned by `backend-spec`; this skill only routes to it.
- **Reviewing the finished diff** — `code-review`, `security-review` and `pre-push-review` own that.
- **Infra, CI, docs and test-only changes** — not application code; this gate doesn't fire for them.
