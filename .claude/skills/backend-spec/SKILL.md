---
name: backend-spec
description: "Design-time gate for Sandbucket data-model work: fires before any Prisma schema change or migration in prisma/ is written whenever a feature adds or reshapes a Postgres table, column, constraint, index, RLS policy or join table, when pre-dev hands off a DB change, or when the human invokes /backend-spec or asks how a table should be modeled, scoped, deleted, or cascaded. Walks the per-table decisions the PRD has conventions for — reuse-before-rename, deploy-safety, data access, profile_id scope + RLS, UUIDv7 ids, deleted_at vs hard delete, cascades, indexes, field shape (text, bigint money), CHECK enums, json-vs-association, §7 audit columns, required isolation/role tests and type regen — suggesting the project default for each, flagging any choice that conflicts, and produces a short plan-only spec (it never edits the schema or runs migrations)."
metadata:
  author: project
  version: "2.1.0"
---

# backend-spec

The design-time gate for **data-model** work. It runs **before** any schema definition or migration
is written, and produces a short per-table spec that folds into the implementation plan.

It fires whenever a feature being planned adds or materially reshapes a database table. For each new
or changed table it walks the human through the decisions below, **suggests the project's default,
and flags any choice that conflicts with it.**

## Project configuration — Sandbucket

Everything project-specific lives in this section; the walk reads its defaults from here. Each value
**points at** the decision that owns it instead of restating it. In the **Value** column `§N` means a
`docs/prd.md` Decisions Log entry; "(for §N)" in the **Setting** column names this skill's walk step.
When a row and its source disagree, the source wins and this row is fixed. **A row marked "not
decided" must never be guessed at — ask the human instead.**

| Setting | Value |
|---|---|
| Database + ORM / migration tool | PostgreSQL 17 (version: `compose.yaml`) + **Prisma** (schema, Prisma Migrate, Prisma Client over `pg` via `@prisma/adapter-pg`) (§5, §18) |
| Schema source of truth | `prisma/schema.prisma` for tables, columns, relations and indexes. What it cannot express — RLS policies, triggers, CHECK constraints, grants — lives only in the migration SQL under `prisma/migrations/`. Client and row types in `lib/db/generated/` are **generated** by `prisma generate` — never hand-edited, not committed (§18) |
| Migration workflow rule | Edit `schema.prisma`, then `prisma migrate dev --create-only` to generate the migration; append the RLS policy, triggers, CHECKs and grants to **that same `migration.sql`** before applying it (§19). One migration per change; Prisma has no `down` (resettable until M11, roadmap Q3). better-auth models come from its CLI `generate` into `schema.prisma` (§21). CI's `prisma migrate diff` fails if schema and migrations disagree (§29) |
| Deploy model (for §0a) | Read `docs/roadmap.md` Q3 — today: **resettable until M11** (no deploy before then); expand/contract (§29, `release_command` runs while the old version serves) from M11 on |
| Live data exists? | **no** until M11 — re-check against roadmap Q3 / milestone status before relying on it |
| Ownership unit (for §1) | `none` — one Next.js app, no modules (§14). Skip §1's module questions; keep its data-access check |
| Cross-module read rule | `none` |
| Data-access layer rule | All feature code goes through `forProfile(profileId)` (§19). The owner handle `lib/db/unsafe.ts` bypasses RLS and is allowed only in `lib/db/**` plus `UNSAFE_DB_ALLOWLIST` in `eslint.config.js` (§12). A table needing an owner-handle write path is a **flag**, not a default |
| Scope / tenancy axis (for §2) | `profile_id uuid NOT NULL` on every tenant-scoped table + RLS `tenant_isolation` policy (§11, §19). User-keyed exceptions: `profile`, `profile_members` (§19). Global/platform tables (no `profile_id`) must be justified — flag them |
| Id rules (for §3) | **Override of §3's sequential default:** every persistent table uses `id uuid PRIMARY KEY`, UUIDv7 minted in Node by Prisma Client, `@id @default(uuid(7)) @db.Uuid` (§6). Never a DB sequence. Secrets (invitation tokens) are stored **hashed**, never as ids (§32). better-auth tables are vendor-owned |
| Delete/archive patterns (for §4) | `deleted_at timestamptz NULL` = **retained** soft delete (no purge job — historical balance views read these rows), only where §8 says (`profile`, `party`); write paths/pickers filter `deleted_at IS NULL`. Hard delete + `ON DELETE CASCADE` for owned children (`transaction_group` → `record`) and for memberships (§8, §11). No `archived_at` pattern yet — proposing one is a decision to confirm |
| Cascade vocabulary (for §5) | Postgres `ON DELETE CASCADE` / `RESTRICT` / `SET NULL` / `NO ACTION`, meanings as in walk step 5 below. **No FK to better-auth's `user` table** — user ids are soft references (`*_user_id uuid`, §7) |
| String column convention (for §7) | Always `text`; length caps live in the Zod input schemas in `lib/schemas/*.ts` (§13), the single validation source. Fixed-width codes keep their honest type (`currency_code char(3)`, §10). Money is `amount_minor bigint NOT NULL`, never numeric/float (§9) |
| Enum convention (for §8) | `text` + `CHECK (col IN (...))` storing short codes (precedent: `profile_members.role`, §11). Labels via next-intl keys (§16). App-side list from **one** source — a Zod enum in `lib/schemas/` — with a test pinning it to the CHECK. Adding a value = a migration replacing the CHECK |
| Structured-data column (for §9) | `jsonb` if ever needed — **none exist yet**; the first one is a decision to confirm |
| Audit mechanism (for §10) | The four §7 columns on every persistent table (`created_at`, `updated_at`, `created_by_user_id`, `updated_by_user_id`), `updated_at` via the shared §4a trigger. No audit-event table in MVP |
| Downstream skill (optional) | `none` as a skill. Field caps and form validation belong to the Zod schemas (§13), written in the implementation step |

## Operating rules

1. **Plan before schema, every time.** The per-table spec is a deliverable of the *plan*, not a
   mid-build detour. If you've reached the schema file or a migration without it in hand, this skill
   fired late — stop and produce it.
2. **Suggest the project default, then confirm.** State the configured default for each decision,
   give the one-line *why*, and confirm with the human — do not silently apply it.
3. **Flag conflicts loudly.** When a requested shape conflicts with a configured convention, say so
   explicitly and name the convention it breaks. Surfacing the conflict is the point.
4. **Confirm, don't guess, product/domain decisions.** Whether a row is ever purged, whether deleting
   a parent should tear down its children, whether an id is security-sensitive — these are decisions,
   not defaults to assume. Ask when the spec doesn't say.
5. **Reuse before rename — a rename/drop of an existing column is opt-in, never a default.** See §0.
6. **Plan-only.** This skill defines the table spec; it does **not** edit the schema, run migrations,
   or sign off correctness/security — those belong to the implementation step and to review.

## When to run

- A feature being scoped/designed/planned adds a **new table / model / entity**, a
  **join/association table**, or a material schema change (new column, changed nullability, new
  relation, **or a renamed / dropped / repurposed column** — see §0), or a new/changed RLS policy,
  grant, CHECK, index or trigger.
- `pre-dev` flagged a DB change for the task — it hands off here before any code.
- The human invokes `/backend-spec`, or asks how a table should be modeled, deleted, scoped, or
  cascaded.

---

## The per-table walk

For a **changed** table, run **§0 first** — it can make the rest moot. Then run §0a–§12 for each
new/changed table. The first three (**ownership → scope → id**) frame the table; the rest fill it in.
Skip a step only when it plainly doesn't apply (or the configuration says `none`) and say so.

### 0. Reuse before rename/drop — changed tables only (STOP-and-alert)

Before speccing *any* change to an existing table, **diff the model against the current schema
source** (the model in `prisma/schema.prisma`, plus the migrations under `prisma/migrations/` for the SQL-only parts: policy, triggers, CHECKs, grants) and classify each column touched: **added** (net-new — fine, proceed) vs. **renamed /
dropped / repurposed** (an existing column changing name, going away, or holding a different
payload). A rename/drop is a migration, and a migration is real, often-avoidable work: a migration
file, re-proving seed/fixture data still applies, and a rename ripple through schema → data access →
API → UI → tests.

**When you see a rename/drop/repurpose, STOP and alert — do not put it in the plan yet:**

- **A JSON / structured column is shapeless at the DB.** A new payload shape fits the **existing**
  column with **no migration** — only application code (validation + service + UI) changes.
  Renaming it for a nicer name is cosmetic churn.
- **A cosmetic rename has zero functional benefit.** Semantic clarity and dead-column cleanup are
  valid reasons, but they are a judgement call the human makes against the migration cost.
- **Present both paths and let the human choose:** (a) reuse the existing column, no migration; (b)
  rename/drop with a migration, for the stated reason. **Add the rename/drop to the plan ONLY with
  explicit approval.** If unsure, default to (a).

Record the classification and chosen path on the spec's `Changed-column review:` line.

### 0a. Deploy-safe schema changes — expand/contract

Read the configured deploy model. **If old and new app revisions share the database during a deploy**
(rolling, canary, blue/green), every migration must be backward-compatible with the
currently-running revision. If live data exists, data loss is a blocker, not a note. If the project
is pre-production with resettable data, say so and skip the staging below.

| Change | Safe in one deploy? | Why |
|---|---|---|
| Add nullable column / new table / new index | ✅ | old revision ignores it |
| Add `NOT NULL` column **with** a default | ✅ | old revision's inserts still satisfy it |
| Add `NOT NULL` column **without** a default | ❌ | old revision's inserts omit it → fail |
| Drop / rename a column or table | ❌ | old revision still reads it → error |
| Narrow a type / add a `CHECK` / tighten a unique | ❌ | old revision writes rejected values |

A ❌ change is **split across deploys** — expand → transition → contract:

1. **Expand** — additive migration only; deploy.
2. **Transition** — deploy code that writes both shapes and reads the new; backfill.
3. **Contract** — a later deploy drops the old shape, once no running revision reads it.

A rename is a drop + add, so it is a three-deploy sequence — another reason §0 prefers reuse. Record
the staged sequence for any ❌ change on the `Deploy-safety:` line.

### 1. Ownership

If an ownership unit is configured, every table has exactly **one** owner. Confirm:

- **Which module/service owns it**, and that writes go only through the owner's public surface —
  never a direct write from another module.
- **Is ownership physical?** If the project namespaces tables per owner (a DB schema, a table
  prefix), the table must declare it. A *missing* declaration is often caught by tooling; a
  **plausible-but-wrong owner** is not — that is what this step guards.
- **Does another module need to read it?** Then apply the configured cross-module read rule (e.g. a
  query function on the owner's public surface).
- **Data-access registration.** If the project funnels queries through a data-access layer, the new
  table's access must go through it, registered per the configured rule.

### 2. Scope axis

If the project is multi-tenant or otherwise scoped, decide the scope columns using the configured
default:

- Which scope columns does the table carry (e.g. tenant, location, organisation, user) — or none (a
  global lookup)?
- A row scoped **wider** than the default needs the project's justification marker at its query
  sites. **A widened scope with no justification is a conflict — flag it.**

### 3. Id strategy

An id is an **address, never a capability**: knowing it must not grant access. Pick the form, then
confirm the read path that makes that form safe.

> **Sandbucket:** the configured Id rule (UUIDv7 everywhere, §6) replaces the sequential default
> below — skip the "Form" choice, record `uuid(7)` on the `Id:` line, and flag any proposed sequence
> or serial as a conflict. The read-path rules still apply: `forProfile` + RLS give the
> "resolve with scope in one query" and "out-of-scope = 404" behaviour for free **only** if the
> query goes through the accessor.

**Form**

- **Simple sequential id by default** for ordinary domain data — clean URLs (`/orders/42`), cheap
  joins. Safe *only* together with the read-path rules below; without them a sequential id lets
  anyone walk the table.
- **Opaque random id (uuid / cuid / ulid) for rows that are themselves a security boundary** —
  accounts, credentials, sessions, API keys, reset/invitation tokens, device pairings. There, a
  guessable id is a risk on its own (account enumeration, token guessing), beyond data exposure.
  Flag a sequential id on such a row as a conflict. The read-path rules still apply on top.
- **Allocation:** record whether sequential ids come from one sequence per table (the usual ORM
  default) or per scope (e.g. per tenant). Per-scope numbering is a deliberate design choice with
  its own uniqueness key — never assume it.
- **Composite primary key** only for a pure join table whose identity *is* the pair; give it a
  surrogate id instead once the row gains its own attributes or lifecycle.
- **External / legacy ids are never the primary key.** An id from another system (an import source,
  a partner, a legacy app) goes in its own nullable, unique column (e.g. `legacyId`, `externalId`),
  typed for the source's range. The primary key stays under this system's control.
- **Vendor-owned tables are exempt.** Tables whose shape a library owns (auth, job queues) keep the
  library's id form; note them as exceptions rather than flagging them.

**Read path — what makes the form safe**

- **Resolve every fetch-by-id together with the caller's scope, in one query** — never fetch the row
  and compare its scope afterwards. Fetch-then-compare is one forgotten `if` away from a leak.
- **Out-of-scope = not found (404), never forbidden (403).** A 403 confirms the row exists.
- **Check the caller's permission *before* resolving the row** in a mutating operation.
  Resolve-then-check returns 403 for an existing in-scope row but 404 for a missing one — an
  existence oracle for anyone who may read but not act. Check-first makes the response uniform.

Record the form, the allocation, and any external-id column on the spec's `Id:` line.

### 4. Delete / archive semantics — the 3-way fork

> **Sandbucket:** `deleted_at` here means **retained** — the row is hidden from write paths and
> pickers but kept forever for historical balances, with no purge job (§8). That is what the table
> below calls *archive*, under the soft-delete column name. Record it as
> `deleted_at (retained, §8)`, and do not flag "purge job owed" for it. A table **not** listed in §8
> defaults to hard delete; proposing `deleted_at` for it is a decision to confirm with the human.

**Mark removal with a timestamp column, never an enum value** (`deletedAt` / `archivedAt`, not
`status = Archived`). Pick one and justify it:

| Pattern | Shape | Use when |
|---|---|---|
| **Soft delete** | `deletedAt` nullable timestamp | Removed *now*, **physically purged later** by a cleanup job — a transient staging state. |
| **Archive** | `archivedAt` nullable timestamp | **Retained indefinitely**, hidden from active views; the record must stay. |
| **Hard delete** | no column; cascade from the parent | An owned child with no independent life — it dies with its parent. |

> **Soft delete ≠ archive.** One is headed for purge, the other is kept forever. Don't conflate them,
> and don't add both unless the row genuinely passes through archive *then* deletion.
>
> **Removal is not a lifecycle status.** A domain state machine (`draft → active → closed`) can live
> alongside a removal timestamp; it is never a substitute for one.
>
> **Purge reality check:** choosing soft delete commits the feature to a purge job. If the
> configuration says that job does not exist yet, flag it as owed — or choose archive.

### 5. Association cascading

For every relation, pick the on-delete behaviour from the configured vocabulary, suggest the fit, and
flag deviations. Typical meanings:

- **Cascade** — owned children that should die with the parent.
- **Restrict** — lookup / config rows that must not be deleted while referenced.
- **Set null** — optional links on a nullable FK.
- **No action** — like Restrict, but checked at statement end (useful for historical actor pointers
  that a parent-level cascade must still be able to tear down together).

### 6. Indexes & uniqueness

- **Index the scope and FK columns** you filter and join on. Here, composite indexes lead with
  `profile_id` (the accessor always filters by it, §19); a unique key on a tenant table includes
  `profile_id` unless it is genuinely global.
- **Uniqueness is coupled to the delete/archive decision:** a unique constraint on a table that
  carries `deletedAt` / `archivedAt` must ignore removed rows — a **partial / filtered unique index**
  (`WHERE deleted_at IS NULL`) where the database supports it, otherwise an equivalent (a generated
  column, or including the timestamp in the key). A plain unique on such a table is a conflict —
  flag it, because a re-created active row will collide with a removed one.

### 7. Field shape

- Apply the configured string convention and flag deviations (e.g. a `varchar(n)` in a
  "text everywhere" project, or an uncapped string in a "varchar with caps" project).
- Use the honest type for non-string data: date-only values as a date type (no spurious time),
  money/measures as fixed-point decimal (never float), timestamps as timezone-aware where supported.
- **Length caps:** if a downstream skill owns validation caps, record only the field list,
  nullability and format intent here and hand caps to it — one owner per decision.

### 8. Enums

- Apply the configured enum convention. Whatever it is: **store a short code, never a display
  string** — user-facing labels live in i18n / presentation code.
- **Derive the application-side value list from one source** (e.g. the ORM-generated type, or a
  single constant) rather than restating it, so the DB and the validation layer cannot drift.
- Note how adding a value later works in this database (e.g. Postgres `ALTER TYPE … ADD VALUE`
  needs its own migration and cannot be removed easily).
- **A shared enum gets exactly one home** — the module it originates in; others reference it, never
  duplicate it.

### 9. Structured column vs association table

When a field holds a *collection* or a *flexible structure*, choose deliberately and justify:

- **JSON / structured column** — for a self-contained, application-validated structure read and
  written as a whole, never joined or FK-referenced.
- **Association / join table** — when items need **real FK constraints**, independent querying,
  indexing, or their own scope / lifecycle. Don't bury a relationship that needs referential
  integrity inside a JSON blob.

### 10. Audit

If an audit mechanism is configured, confirm **every mutating operation** on the table will emit an
audit event through it — built in as the feature lands, not retrofitted. Name which operations
mutate and therefore audit.

Sandbucket's mechanism is columns, not events: confirm the table carries the four §7 columns, the
shared `updated_at` trigger (§4a) is attached in the migration, and the Server Actions that write it
set `created_by_user_id` / `updated_by_user_id` from the session. A trigger doing anything beyond
§4a's carve-out (cross-table reads/writes, validation, cascades) is a conflict — flag it.

### 11. Isolation & required tests (Sandbucket)

These ship **in the same PR** as the table; without them it is a review blocker (§19, §28, roadmap
cross-cutting rules). Name each one in the plan:

- **RLS** — tenant-scoped table: `ENABLE ROW LEVEL SECURITY` + the `tenant_isolation` policy (§19),
  in the creating migration. A user-keyed or global table needs its policy shape argued and confirmed.
- **Grants** — `sandbucket_app` gets only the privileges the feature needs (§19).
- **Cross-tenant test** — the per-table test through the accessor **and** as a raw query on
  `sandbucket_app`, via the reusable harness from M1 (search `tests/` for it; don't hand-roll one).
- **Zero-rows test** — discovers tables from the catalog, so it covers the new table automatically;
  confirm the table actually appears in it.
- **Role tests** — every new action gets allowed **and** refused tests per the §6.20 permission
  table, including a worker's own-entries-only scope (§32).
- **Invariant tests** — a new transaction type or posting rule gets its posting unit test (§28).

### 12. Generated types

Types come from `prisma generate` (run on install and build) into `lib/db/generated/`, which is
not committed. What CI checks instead is that the committed migrations still produce exactly
`schema.prisma` (`prisma migrate diff`, §29). Never hand-edit the generated client.

---

## Output format

```
backend-spec — <feature>

Table: <Name>  (owner: <module>; cross-module reads: <none | <read seam>>)
  Changed-column review: <new table — n/a | added: <cols> | RENAME/DROP: <col> — no-migration reuse possible? <y/n>; approved? <y/n>>
  Deploy-safety: <✅ additive — safe in one deploy | expand/contract sequence for each ❌ change | n/a — <reason>>
  Scope:    <scope columns | global | single-tenant>   # justification if wider than default
  Id:       <sequential (per-table | per-<scope> sequence) | opaque <uuid|cuid|ulid> — why | composite | vendor-owned>; external id: <none | <column>>
  Delete:   <soft delete (purge job: exists/owed) | archive (retained) | hard cascade>
  Cascades: <relation → on-delete — why>, …
  Indexes:  <indexes>; unique: <plain | partial WHERE <removed> IS NULL | none>
  Fields:   <name: type, required/nullable, format intent>
  Enums:    <Enum: value set; app-side source of truth>
  Json:     <field → structured column | "association table <Name>" — why>
  Audit:    <§7 columns + §4a trigger: yes | exception — why>; writers set *_by_user_id: <Server Actions>
  RLS:      <tenant_isolation (§19) | user-keyed — policy | global — why>; grants: <privileges for sandbucket_app>
  Tests:    <cross-tenant (harness) · zero-rows covers it · role tests: <actions> · invariants: <if any>>
  Types:    prisma generate + `prisma migrate diff` clean: <yes>

Conflicts flagged: <any choice that breaks a configured convention, or "none">
Hand-off: <downstream skill and what it owns | none>
```

Repeat the `Table:` block per new/changed table. Keep it short — a plan input, not an essay.

## Out of scope

- **Length caps, form wiring and field-level validation UX** — owned by the downstream skill if one
  is configured, otherwise by the implementation step.
- **Editing the schema or running migrations** — this skill specs the model; the implementation step
  writes it per the configured migration workflow.
- **Judging correctness, scope-leak risk, or security of the finished diff** — code review and
  security review own the review-time verdict.
- **Migration mechanics / data backfill SQL** — this skill decides the *shape* and the deploy
  staging, not the migration text.
