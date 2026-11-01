# PRD Creation Checklist

Open questions still to answer before building can start. Grouped by how much each blocks actual work. As decisions are made, move them into `prd.md` (Decisions Log + relevant section) and tick the box here.

---

## ⏸ Resume here (paused 2026-10-31)

**Stage 3 — platform switch closed. Supabase is out; Fly.io + better-auth are in.** New PRD decisions: §17 hosting and runtime (app on Fly Machines as a Docker image, Vercel dropped), §18 Fly Managed Postgres + dbmate SQL migrations + Kysely/kysely-codegen, §19 tenant isolation enforced app-side (RLS dropped — **reinstated 2026-10-31 as a backstop**, see below), §20 Tigris object storage (private bucket, presigned URLs), §21 better-auth with email+password now and email OTP planned, §22 transactional email (Resend hosted / SMTP self-host). Revised in place: §4, §5, §7, §11 (membership model stands, RLS mechanism superseded), §12 (now guards the unscoped DB handle), §13, §14, plus §6.14, §8, §7 principles, and the MVP goals.

**2026-10-31 — RLS reinstated as a backstop (PRD §19 rewritten; §11, §12, §6.14, §8 revised).** The accessor stays the primary path; every tenant-scoped table also gets RLS with a profile-only policy (Option A), transaction-local `app.profile_id` / `app.user_id` settings, and two Postgres roles (`sandbucket_app` subject to RLS, `sandbucket_owner` for migrations + the quarantined bootstrap handle).

**Stage 2 items closed by the switch:** §7 auth specifics (→ PRD §21) and §8 document storage layout (→ PRD §20).

**Design tokens closed 2026-10-31 (PRD §27) — no blockers remain for MVP form work.** HEIC handling closed the same day (PRD §23a: native browser decode + jSquash, uncompressed fallback). Toast component closed too (PRD §23b: sonner). Testing plan closed (PRD §28). CI/CD closed (PRD §29). Observability closed (PRD §30).

**2026-11-01 — scope review:** cash custody & Settlement written up (PRD §6.19, §31); **profile sharing moved into MVP** with `owner` / `accountant` / `worker` roles and email invitations (PRD §6.20, §32). List sign rules per type (PRD §6.10). Invoices extended with their payments: grouped display, payment status, open-invoices view, invoice number + due date, overpayment refused (PRD §6.18, §26 — storage unchanged).

**All PRD decisions are made.** What remains is the "Low" list at the bottom: pre-launch tasks, not open questions.

> ⚠️ Read alongside PRD §19: the per-table cross-tenant integration tests named there (through the accessor *and* as a raw query on the app role) are a hard requirement of the testing plan (§10 below), not a nice-to-have — they are what proves each table's RLS policy exists.

---

## Blocking — must answer before code

### 1. Data schema source of truth
PRD describes Party / Record / TransactionGroup / Balance conceptually, but there is no table list, no column list, no types.

- [x] **Schema migration tool** (§5, revised by §18) — **dbmate + hand-written SQL migrations in `db/migrations/`.** No ORM. Row types generated from the live schema by `kysely-codegen`; queries via Kysely on a `pg` Pool. Database is Fly Managed Postgres. *(Originally Supabase CLI + `supabase gen types` — superseded 2026-08-05 with the platform switch; the "SQL is the source of truth, no ORM" principle is unchanged.)*
- [x] **IDs** (§6) — **UUIDv7, generated in Node** (via the `uuidv7` npm package). Globally unique, time-sortable so index locality holds, ready for offline writes in v2, and parent IDs can be minted before insert so multi-row transactions don't need `RETURNING id` round-trips.
- [x] **Audit fields** (§7, §4a) — Every persistent table gets `created_at`, `updated_at`, `created_by_user_id`, `updated_by_user_id`. Timestamps default `now()`; user-id columns are plain `uuid` with no FK to better-auth's `user` table, populated by Server Actions from the session. System-seeded rows leave `created_by_user_id` null. `updated_at` is maintained by a shared `BEFORE UPDATE` trigger that only fires when `NEW IS DISTINCT FROM OLD` (per §4a — the carve-out that loosens §4's strict trigger ban for pure column hygiene).
- [x] **Soft-delete vs hard-delete** (§8) — Split: `profile` and `party` use **soft-delete** via `deleted_at timestamptz NULL` (Records reference parties; profile loss is unrecoverable); `transaction_group` → `record` use **hard-delete** with `ON DELETE CASCADE` (a soft-deleted Record would force `IS NULL` filters into every balance/double-entry sum and one missed filter silently breaks the books). `deleted_at` participates in §4a's `IS DISTINCT FROM` guard. Preserving deleted-record history (separate archive table or JSONB tombstone) is in `backlog.md` under "Deleted-record preservation".
- [x] **Money type** (§9) — Integer minor units stored as `amount_minor bigint NOT NULL`. TS carries values as `bigint`; a `Money = { amountMinor: bigint, currency: string }` value object is the only place majors/minors are bridged. Zod boundary refuses non-integers, negatives, and values ≥ 2^53. Display formatting via `Intl.NumberFormat`. FX rates (v2+) get their own `numeric(20,10)` column on a separate `fx_rate` table — rates and amounts do not share a representation.
- [x] **Currency scope** (§10) — single currency per profile. `currency_code char(3) NOT NULL` on both `profile` and `transaction_group`; MVP `CHECK` constraint enforces equality. Picker on profile creation, EUR pre-selected; immutable thereafter. FX deferred to v2.

### 2. Tenant isolation strategy — security-critical
- [x] **Membership authority** (§11) — `profile_members(user_id, profile_id, role)` is the source of truth. Every tenant-scoped table carries `profile_id NOT NULL`. Role CHECK admits `owner|accountant|worker`; ~~MVP write paths require `role = 'owner'`.~~ *Superseded 2026-11-01 by PRD §6.20 / §32: write rights are role-scoped (owner / accountant / worker).* Indexes: `unique(user_id, profile_id)` and `index(profile_id, user_id)`. Hard-delete memberships. `user_id` is a soft reference to better-auth's `user.id`.
- [x] **Enforcement mechanism** (§19, revised 2026-10-31) — **Accessor + RLS backstop.** A per-request profile-scoped accessor verifies membership once, sets transaction-local `app.user_id` / `app.profile_id`, then injects `profile_id` into every read, sets it on every insert, and strips it from update payloads. Behind it, every tenant-scoped table has RLS with a profile-only policy (Option A); `profile_members` and `profile` are keyed by user so the membership check and profile switcher work. App traffic runs as `sandbucket_app` (subject to RLS); `sandbucket_owner` bypasses it and is quarantined by §12. A forgotten setting returns zero rows, not another tenant's. *(The 2026-08-05 "no RLS" decision is superseded.)*
- [x] **Unscoped DB access** (§12) — Scoped accessor is the default; the raw Kysely instance lives in `lib/db/unsafe.ts` behind ESLint `no-restricted-imports`, allowed only from `lib/db/`, the signup seed, new-profile seed, and migration/seed scripts. Per §4, security-definer function bootstrap is not an alternative.

### 3. Validation contract
- [x] **Zod as single source of truth** (§13) — schemas in `lib/schemas/*.ts`, shared between client (react-hook-form via `zodResolver`) and Server Actions / Route Handlers (`.parse()` on entry). Server **always** re-parses; client copy is UX-only. Split into input schemas (forms + handlers), reusable value-object schemas (`MoneySchema`, `Iso4217Schema`, `Uuidv7Schema`, `TransactionTypeSchema`), and DB row types (from `kysely-codegen` per §18 — *not* Zod, never runtime-parsed). The nine transaction types (§4) modelled as `z.discriminatedUnion('type', [...])`. `MoneySchema` accepts a locale-formatted string and transforms to `{ amountMinor: bigint, currency: string }` per §9. Server Actions return `Result<T> = { ok: true, data } | { ok: false, fieldErrors, formError? }` rather than throwing, so the same RHF error rendering handles both client-side and server-side failures (incl. the cross-row §10 currency check). File uploads via `z.instanceof(File)` with MIME + size refinements per §6.13 and §8.

### 4. Repo bootstrap
- [x] **Where does the new Next.js app live?** (§14) — Brand-new repo named **`sandbucket`** (product name already established in `prd.md` §1, `user-stories.md`, and `plans/domain-model-options.md`). Single Next.js app at repo root, no monorepo, one `package.json`. Layout: `app/`, `lib/`, `components/`, `public/`, `db/` (dbmate migrations + seed scripts per §18), `Dockerfile` + `fly.toml` (deploy per §17), `compose.yaml` (self-host / local dev), `.env.example`, and a top-level `docs/` folder carrying over the rebuild docs from `new-project/` (`prd.md`, `setup-config.md`, `backlog.md`, `cash-custodian.md`, `user-stories.md`, `plans/`). Package manager: **pnpm**, lockfile committed; strict dep resolution refuses to satisfy imports of undeclared packages, which is what makes §13's single-source Zod contract actually enforceable rather than dependent on developer discipline.
- [x] **Does the legacy Mendix project stay in this repo** (§14) — No. This repo (`Bapp-main`) is **archived on GitHub** the moment `sandbucket` is bootstrapped, becoming a read-only historical artifact. The bet: `user-stories.md` (legacy attribute names verbatim with `(sic)` typo markers), `plans/go-over-all-stories-jiggly-axolotl.md` (verified one-pass over every story against the live `.mpr`), `setup-config.md` (legacy → new role-mapping), and `cash-custodian.md` together capture the legacy at the precision the rebuild needs. If anything not covered surfaces, un-archiving on GitHub is one click and `./mxcli` works against a clone unchanged — so occasional lookups are cheap while carrying legacy in the active repo (mixed CLAUDE.md context, tooling spillover, decade-old commits in `git log`) is paid every day.

---

## High-priority but parallelizable

### 5. UI / design system
- [x] **Component library** (§15) — **shadcn/ui + Tailwind CSS.** Components scaffolded into `components/ui/` as plain TypeScript (no `shadcn` runtime dep), wrapping Radix primitives for behaviour/a11y and Tailwind for styling. shadcn `<Form>` wrapper pairs with react-hook-form + `zodResolver` (§13). Initial set: `button`, `input`, `label`, `form`, `select`, `dialog`, `dropdown-menu`, `sheet`, `tabs`, `card`, `badge`, `sonner` (toasts, §23b), `skeleton`, `separator`, `popover`. Mobile-first: 44 px tap targets, `<Sheet>` as the responsive mobile-drawer counterpart to `<Dialog>`. No built-in user-facing strings, so §6.15 i18n stays at call sites.
- [x] **Design tokens** (§27) — **Zinc neutrals · Blue primary · system font · sign + colour for amounts**, confirmed 2026-10-31 against an interactive mobile preview. Tailwind 4 px spacing, 8 px radius, 16 px inputs, 44 px tap targets, dark mode from day one, tabular digits.

### 6. i18n library
- [x] **Library** (§16) — **next-intl.** App-Router-native, ICU MessageFormat (handles Estonian plural rules via CLDR), `getTranslations` in Server Components / Server Actions, `useTranslations` in client components, ~12 KB client runtime. Type-safe message keys via TS plugin + `Messages` declaration. Messages in `messages/<locale>.json` at repo root.
- [x] **Locale source** (§16) — **Cookie** (`NEXT_LOCALE`, next-intl's default). No URL prefix — clean URLs (`/transactions/123`). New visitors: middleware reads `Accept-Language`, picks highest-priority supported locale, falls back to `en`. Settings-page picker writes the cookie via a Server Action. **No `profile.preferred_locale` column for MVP** — locale is per-device; v2 path is a single column + sign-in hook that seeds the cookie from the profile field. Locale governs strings + decimal separator (via `Intl.NumberFormat`); date format is app-defaulted to DD.MM.YYYY for both locales per §6.15; currency stays per-profile per §10.

### 7. Auth specifics
- [x] **Auth library** (§21) — **better-auth** in the Next.js Node runtime; `user`/`session`/`account`/`verification` tables in the same Postgres, schema committed as a dbmate migration, built-in Kysely adapter sharing the §18 pool.
- [x] **Password policy** (§21) — Email + password for MVP: **10-char minimum, no composition rules, no forced rotation, no account lockout** (lockout would be a DoS against the legitimate user); better-auth's built-in rate limiting on sign-in / sign-up / reset. Sessions are httpOnly + Secure + SameSite=Lax cookies.
- [x] **Email verification** (§21) — **Required before first sign-in.** Password reset is an emailed single-use link. Delivery per §22 (Resend hosted / SMTP self-host), sent fire-and-forget so response timing can't leak account existence.
- [x] **OTP** (§21) — Email one-time codes are the **planned follow-on** sign-in method, not MVP: `otpLength: 6`, `expiresIn: 300`, `allowedAttempts: 3`, `resendStrategy: 'rotate'`, `storeOTP: 'hashed'`. Additive — enabling it later migrates nothing.

### 8. Document storage layout
- [x] **Object store** (§20) — **Tigris** on Fly (`fly storage create`), one private bucket per environment; MinIO for self-host via the same S3 SDK. *Capture the access keys at creation — Tigris does not let you retrieve them again.*
- [x] **Bucket structure** (§20) — `<profile_id>/<transaction_group_id>/<uuidv7>.<ext>`; metadata row in Postgres carries `profile_id` and is the authority on ownership.
- [x] **Storage authorization** (§20) — Tigris has no RLS of its own; the §19 accessor (reading the RLS-guarded attachment row) checks the attachment's row belongs to the active profile *before* any URL is minted.
- [x] **URL access** (§20) — **Presigned only, never public.** Presigned GET with 60 s TTL for display; presigned PUT for direct browser→Tigris upload so files never transit the app Machine.
- [x] **Max file size** (§20) — **10 MB** after client-side compression, plus MIME allowlist JPEG/PNG/HEIC/PDF, enforced at the presign request and in the Zod boundary (§13).

---

## Medium — can defer to Day 2

### 9. Legacy data migration
- [x] **Fresh start.** No production Mendix data is being carried over — Sandbucket launches with empty profiles. No cutover script needed; the role-mapping table in `setup-config.md` remains useful only as a conceptual cross-reference, not as migration input.

### 10. Testing plan
- [x] **Unit tests for the double-entry engine** (PRD §28) — Vitest. Records must net to zero; balances must reconcile; each transaction type posts the expected Records.
- [x] **Cross-tenant isolation tests** (PRD §28, §19) — Vitest integration tests on real Postgres, non-negotiable per PRD §19: one integration test per tenant-scoped table, two seeded profiles, asserting profile B cannot read / update / delete profile A's rows (a) through the accessor and (b) via a raw query on `sandbucket_app` — (b) proves the table's RLS policy exists. Plus one shared test: with no settings applied, the app role sees zero rows everywhere. Runs against the Compose Postgres.
- [x] **E2E** (PRD §28) — Playwright on every PR against the production Docker image built in CI; iPhone (WebKit) + Android (Chromium) emulation first, desktop Chromium second. No coverage-percentage gate.

### 11. CI/CD
- [x] GitHub Actions on PR (PRD §29): lint / typecheck / all §28 tests (Postgres service container), `kysely-codegen` drift check, `size-limit` 200 KB check.
- [x] `fly deploy` from GitHub Actions on `main` (PRD §29); dbmate migrations run as Fly `release_command` (aborts deploy on failure). Migrations must be expand / contract compatible.
- [x] Preview environments (PRD §29) — **none for MVP**, and no staging. Revisit staging + tag-promoted production once real users depend on the hosted service.
- [x] Self-host build pipeline (PRD §29) — same Docker image published to GitHub Container Registry on `v*` tags.

### 12. Observability
- [x] Error tracking (PRD §30) — **none for MVP** (no Sentry / GlitchTip). Browser-only errors are an accepted gap; revisit when the hosted version has real users.
- [x] Logs / metrics (PRD §30) — structured JSON to stdout, read via Fly logs + managed Grafana; no log drain. Never log financial data or emails.
- [x] Self-host (PRD §30) — same stdout via `docker compose logs`.

### 13. Legacy business-logic review
- [x] **Deep mechanics pass against the live `.mpr`** — `business-logic-spec.md` traces every transaction-save microflow, validation, balance-recalc algorithm, party lifecycle, and TransactionGroup edit/delete rule exactly, sourced from `DESCRIBE MICROFLOW`/`DESCRIBE ENTITY` output rather than inferred from naming. Surfaced several legacy bugs (not mirrored — see the doc's §8) and three real features not previously scoped: **party hierarchy** (§24, kept), **opening balance** (§25, kept — rebuilt correctly, legacy's version is broken), **invoice-payment linking** (§26, kept — rebuilt as a reference between two TransactionGroups rather than legacy's group-reuse mechanism). Also resolved a party-type-list discrepancy: legacy's `Utility`/`Tenant`/`Warehouse` enum values are dropped, `Utility` folding into `Supplier` (§6.2).

---

## Low — call out so they aren't forgotten

- [ ] PWA manifest, icons, splash screens, app update strategy. *Tooling decided (Serwist, PRD §23); assets and update prompt are build-time work.*
- [ ] Privacy policy / ToS for hosted version (legal, not eng).
- [ ] Backups documentation for self-host (`pg_dump` + object-store copy). **Also confirm with Fly what MPG's backup retention and point-in-time-recovery actually are** — Fly advertises automatic backups but does not publish retention or PITR specifics, and §18 flags it as a pre-launch item.
- [x] Performance budget enforcement in CI (PRD §29) — `size-limit` fails any PR whose initial JS exceeds 200 KB.
