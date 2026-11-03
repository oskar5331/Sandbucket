# Domain Model Options — Sandbucket Rebuild

## What this doc is

A walk-through of the design decisions that shape the data model for the Next.js rebuild. For each decision it lays out the realistic options, the pros and cons, and a recommendation. The end of the doc shows the recommended model in plain language.

> **Platform note (2026-08-05):** this doc was written against a Next.js + **Supabase** stack. The platform has since changed to **Fly.io + better-auth** — see `prd.md` §17–§22. The *data model* reasoning below is unaffected (it is plain Postgres throughout), but two mechanisms named in passing are superseded: user identity now comes from better-auth's `user` table rather than Supabase `auth.users`, and tenant isolation is now an application-side profile-scoped accessor with Row Level Security kept only as a database backstop (`prd.md` §19 — RLS was dropped 2026-08-05 and reinstated in that narrower role 2026-10-31). Where this doc and `prd.md` disagree, `prd.md` wins.

This is a planning doc — nothing is built yet. It reads top to bottom: concepts → decisions → recommended shape → things deliberately deferred.

Sources used:
- `prd.md` — product scope and tech constraints
- `setup-config.md` — roles, seeded data, environment
- `user-stories.md` — legacy snapshot, descriptive only
- `cash-custodian.md` — the cash-custodianship redesign
- `backlog.md` — supplier sub-categorisation parking lot

---

## The building blocks (plain language)

Five concepts make up the whole accounting model. Everything else is plumbing.

- **Profile** — one bookkeeping context. A company, a household, a side project. Everything below lives inside one profile and never leaks out.
- **Party** — anyone or anything money moves to or from. A bank account, a cash drawer, a supplier, a customer, a person. Each party has a *type*.
- **Record** — one line of double-entry bookkeeping: "money moved from party A (credit) to party B (debit), this much, on this date". Records are the truth of the ledger.
- **Transaction group** — what the user sees as "one transaction". A user records "I paid Telia €150"; underneath, that's one transaction group containing one record. A micro-investment is one group with two records.
- **Balance** — every party has a running credit total and debit total, recalculated from its records. Never typed in.

The user only sees transaction groups. Records exist for the bookkeeping engine. Balances are derived. This separation is the whole point of double-entry under the hood, single-entry in the UI.

---

# Decision 1 — How do we represent transactions?

This is the biggest schema decision. The legacy Mendix app uses a "helper-per-type" approach inherited from old patterns; a fresh start gives us choices.

## Option 1A — Pure records (two tables, type lives on the group)

Two tables do all the work:

- `transaction_groups` — id, profile, type (enum: expense / income / received_invoice / issued_invoice / withdrawal / deposit / micro_investment / settlement), date, description, amount, attachment, created_at, created_by
- `records` — id, group_id, credit_party_id, debit_party_id, amount

A simple expense → one group + one record. A micro-investment → one group + two records. A withdrawal → one group + one record (credit bank, debit cash register).

**Pros**
- Smallest possible schema. Two tables, one ledger table, clear.
- Pure double-entry. Every penny that moves leaves a trace in `records` — no hidden state.
- Adding a transaction type is a code change, not a schema migration.
- "Show me the ledger for this party" is one query.
- Reads the way bookkeepers actually think.

**Cons**
- Anything type-specific that *isn't* already a credit/debit party (e.g. an invoice number, a "cost vs investment" classifier) needs a home. Either extra nullable columns on the group, or a small JSON blob, or a separate side table.
- Validation rules ("a withdrawal's credit party must be of type bank") live in server-action code, not in the schema. Acceptable if the rules are centralised in one place.

## Option 1B — Typed helpers (one table per transaction type, legacy-style)

The Mendix legacy: `transaction_groups` parent + a separate `expense_helpers`, `withdrawal_helpers`, `microinvestment_helpers`, … Each helper has its own typed columns (e.g. `expense_helpers` carries `_Bank`, `_Supplier`).

**Pros**
- Each type is strongly typed in the database. "An Expense without a supplier" is impossible.
- Familiar from the legacy app — easy mental mapping if porting.

**Cons**
- Seven helper tables for seven transaction types, with a lot of overlap.
- Adding a new transaction type is always a migration plus a new table.
- "Show me all transactions" is a UNION across seven tables or a maintained view.
- Doesn't actually gain much in a Next.js codebase — type-level validation already happens in the server action; duplicating it in schema is double-entry of a different kind.
- Carries forward the "two `_Bank` slots problem" from `cash-custodian.md` (one slot in the schema, but a withdrawal needs source and destination).

## Option 1C — Hybrid: one transaction_groups table + JSON payload

Common columns on the group, plus a `type_payload` JSON column for the per-type extras.

**Pros**
- One row per transaction = one row to read in the UI.
- Avoids seven helper tables.
- Adding a type is mostly a code change.

**Cons**
- JSON payload is opaque to schema constraints. Validation lives in code anyway.
- Future maintainers may treat the JSON as a dumping ground.
- In practice, most "type-specific" data is *already* captured by the parties on the records — so the JSON column may end up mostly empty. If it does, you didn't need it.

## Recommendation: **1A — Pure records**

Start with the smallest schema that does the job. Look at the seven types and ask: *what do they actually need beyond credit/debit/amount/date/description?*

| Type | Extra data beyond record(s) |
|---|---|
| Expense | none — supplier is the debit party |
| Income | none — customer is the credit party |
| Received Invoice | a "cost vs investment" choice — already encoded by which debit party (Expenses vs Investment) is used |
| Issued Invoice | none — Profits is auto-credited |
| Withdrawal | none — both ends are money-store parties on the record |
| Deposit | none |
| Micro-investment | none — three parties already appear across the two records |
| Settlement *(new)* | none |

The answer is: nothing extra. Two tables cover all seven transaction types cleanly.

If a future type genuinely needs side data (e.g. an invoice number for received invoices), add a nullable column or a small dedicated side table at that point. Don't pre-build for it.

**Side effect:** the "two `_Bank` slots" question from `cash-custodian.md` (open question #1) disappears — see Decision 2.

---

# Decision 2 — How do we handle transactions that move money between two money-stores?

Withdrawals (bank → cash register) and the new Settlements (cash register → bank) involve two money-store parties on a single transaction. The legacy schema has only one `_Bank` slot, which is what triggered open question #1 in `cash-custodian.md`.

## Option 2A — Use the records table as designed

A withdrawal is just one record: credit party = source bank, debit party = destination cash register. Both ends are money-store parties (bank or cash_register). That's all there is to it. A settlement is the same in reverse.

**Pros**
- Already supported by Decision 1A. No new fields, no new helper.
- Same path that records use for everything else.

**Cons**
- None worth listing. This is what double-entry is for.

## Option 2B — Add `bank_source` / `bank_destination` to a typed helper

Only relevant if you took Decision 1B. Renames `_Bank` to `_BankSource` and adds `_BankDestination`.

**Pros**
- Explicit about what each end is.

**Cons**
- Only needed because of the typed-helper schema in the first place.

## Option 2C — Dedicated `Transfer` transaction type

A separate type for any money-store-to-money-store move.

**Pros**
- Lets the UI treat all transfers identically.

**Cons**
- Withdrawal and Settlement are already meaningful user-facing concepts; collapsing them loses the language users speak.
- Doesn't solve any actual schema problem.

## Recommendation: **2A — use records as designed**

Once Decision 1A is taken, this question dissolves. Withdrawal, Deposit, and Settlement are each a single record with two money-store parties — same shape as Expense or Income, just with different party types on each end.

Consequence: `cash-custodian.md` open question #1 (option a/b/c) is answered by *not building a schema problem in the first place*.

---

# Decision 3 — How do we link a cash register to its custodian?

This is the core of `cash-custodian.md`. The recommendation in that doc is to make `CashRegister` a first-class party type and add a self-association from a cash-register Party to a custodian Party. Worth confirming against alternatives.

## Option 3A — Custodian on the Party (cash-custodian.md recommendation)

`parties` gets a nullable `custodian_party_id` column, only used when `type = cash_register`. Each custodian's cash drawer is its own party ("Cash held by John"), pointing at John.

**Pros**
- Custodian's running cash balance falls out automatically — it's just the balance of their cash-register party.
- "How much cash is John holding?" = read one balance.
- Cleanly separates two things that were tangled in legacy: cash custody (now on a CashRegister party) vs real receivables (on the Partner party).
- Reporting "where is the company's cash right now" is a single grouping query.
- Custodian appears in pickers as a real, named entity ("Cash held by John") — matches the UX in §"UX implications" of `cash-custodian.md`.

**Cons**
- One nullable column with a soft constraint ("only meaningful when type = cash_register") — enforced by a small CHECK or partial index.
- A register has at most one custodian. This is the right rule, not a limitation.

## Option 3B — Custodian on each transaction

Don't link custodian to the cash register. Instead, every cash-related transaction carries a `custodian` field.

**Pros**
- One fewer party per custodian.
- Same drawer can be "for John today, Mari tomorrow".

**Cons**
- Loses the running balance per custodian — you'd recompute it from transactions every time.
- Re-mixes the very confusion `cash-custodian.md` exists to fix.
- Custodian field is meaningful for some transaction types and not others — schema gets fuzzier, not cleaner.
- No party in the picker for "Cash held by John".

## Option 3C — A separate `cash_holdings` view

Cash registers stay generic; a derived view sums per-custodian based on transaction metadata.

**Pros**
- Doesn't change the party schema.

**Cons**
- Adds a derived layer that needs its own correctness story.
- Doesn't help the UX (still no "Cash held by John" party in pickers).
- More moving parts for less clarity.

## Recommendation: **3A — custodian on the Party**

This is the recommendation already worked through in `cash-custodian.md`. It's the simplest schema change and it directly enables the desired UX. Adopt it.

---

# Cash-custodian open questions — proposed answers

The four open questions parked at the bottom of `cash-custodian.md`:

### 1. Schema for two-money-store transactions
**Answered by Decision 2A.** Records hold both ends; no `_Bank` rename needed; no dedicated transfer type needed.

### 2. Which party types may be a custodian?
**Recommendation: leave the data model open; constrain in the UI.**

The `custodian_party_id` column points at any party. The UI's "pick a custodian" picker filters to `Partner` and `Worker` because those are the only types that map to real people. If a future edge case needs a Supplier custodian (rare but possible), unlock it in the UI without a migration.

**Pros** — flexibility costs nothing here; constraint lives where it can change cheaply.
**Cons** — someone could in theory point at a Bank as a custodian via direct DB access. Acceptable; nothing in production paths allows it.

### 3. Auto-create vs. manual register on Withdrawal
**Recommendation: auto-create.**

When the user picks a destination on a Withdrawal form, they pick a **person**. If that person already has a "Cash held by …" register, use it. Otherwise create one (named "Cash held by *Name*", custodian linked) as part of the same submit.

**Pros**
- Makes US-027a literally true ("create register and link custodian in the same step").
- Removes the most common reason a user would have to leave the form mid-task.
- Matches the "zero setup for the happy path" principle in §7 of the PRD.

**Cons**
- Hides the existence of the cash-register party from a first-time user. Mitigated by the dashboard ("Cash held by John €200") making it visible right after.

### 4. Closing a register when a person leaves
**Recommendation: soft-delete only.**

When a person leaves and their register is settled to €0, the `owner` deactivates the register (`active = false`). It disappears from pickers but stays in history. Hard-delete is blocked while any record references it — same rule as parties generally per `setup-config.md` §1.2.

**Pros** — preserves audit trail; reuses the deactivation rule the rest of the app already follows.
**Cons** — old "Cash held by …" parties accumulate over time. Acceptable; they're cheap and historically meaningful.

---

# Backlog / parked items

These don't need a decision now; recording them so they're not forgotten.

- **Supplier sub-categorisation** (`backlog.md`). Suppliers used to split into Warehouse / Utility. Don't reintroduce until someone actually asks for "spend by supplier category" reporting. If/when needed: a tag table is the most flexible answer; a dropdown attribute is the cheapest.
- **Opening balances.** Legacy doesn't support them. PRD doesn't promise them. If a user wants to start mid-year with existing balances, current workaround is a single seed transaction per party. Revisit if it comes up.
- **Hierarchical party grouping** (US-012, legacy `UseAsGroup` + `BelongsToGroup`). Skipped from MVP. If reporting needs it, add a `parent_party_id` self-reference later.
- ~~**Multi-user profiles / `worker` role.**~~ *No longer deferred: sharing with all three roles ships in MVP (`prd.md` §6.20, §32).*

---

# Recommended model — at a glance

What the database actually looks like if all the recommendations above are taken. Expressed in plain English; SQL details are an implementation step.

## Profiles & users

**`profiles`** — one row per bookkeeping context.
- Name, currency, locale, fiscal year start, decimal/date format
- `created_by` — the user who owns it
- Settings stored on the row (no separate settings table needed for MVP)

**`profile_members`** — links an authenticated user to a profile with a role (`user_id` now references better-auth's `user.id`; see `prd.md` §11/§21).
- `profile_id`, `user_id`, `role` (enum: `owner`, `accountant`, `worker`)
- Exactly one `owner` per profile (enforced by partial unique index)
- This is what every membership check keys off — "the current user must have a row here for this profile". Checked once per request by the profile-scoped accessor (`prd.md` §19). RLS on this table is keyed by user — a user sees only their own memberships — so the check can run before an active profile is set

> *Updated 2026-11-01:* all three roles (`owner`, `accountant`, `worker`) ship in MVP, with email invitations (`prd.md` §6.20, §32).

## Parties

**`parties`** — every entity money moves to or from.
- `profile_id` — what scopes it
- `name`, `description`, `active`
- `type` — enum: `bank`, `cash_register`, `supplier`, `customer`, `partner`, `worker`, `investment`, `profits`, `expenses`
- `is_system`, `system_key` — for the seeded ones (Bank, Cash Register, Profits, Expenses); resolved by key, renaming is safe
- `linked_user_id` — nullable soft reference to better-auth's `user.id` (no FK, per the `prd.md` §7 convention), only meaningful for `partner` and `worker` types (US-013a)
- `custodian_party_id` — **nullable self-reference**, only meaningful for `cash_register` type (Decision 3A)
- `parent_party_id` — **nullable self-reference**, `is_group` boolean — optional party grouping/hierarchy, ported from legacy's `BelongsToGroup`/`UseAsGroup` (`prd.md` §24, `business-logic-spec.md` §2.2–2.3). Purely organisational — no effect on bucketing or balances.
- `credit_balance`, `debit_balance` — recomputed from records on every record change (NFR-002)

## Records & transaction groups

**`transaction_groups`** — what the user sees as "one transaction".
- `profile_id`, `type` (enum of the 9 transaction types — the 7 from PRD, plus `settlement` from `cash-custodian.md`, plus `opening_balance` from `prd.md` §25)
- `date`, `description`, `amount`
- `attachment_url` — single document per transaction (PRD §6.13)
- `linked_transaction_group_id` — **nullable self-reference**, set only by the "Record Payment" action linking an invoice to its later settlement (`prd.md` §26, §6.18). Not FK-restricted to invoice types; multiple payments may reference the same invoice group.
- `created_at`, `created_by`

**`records`** — the ledger.
- `profile_id` (denormalised for tenant scoping, kept consistent with the parent group)
- `group_id`, `credit_party_id`, `debit_party_id`, `amount`
- One record for most types; two for micro-investments

That's it for the core ledger. No type-specific helper tables.

## How each transaction type lays out

| Type | Group rows | Record(s) created |
|---|---|---|
| Expense | 1 | 1 — credit `bank` or `cash_register`, debit `supplier` |
| Income | 1 | 1 — credit `customer`, debit `bank` or `cash_register` |
| Received Invoice | 1 | 1 — credit `supplier`, debit `expenses` (cost) **or** an `investment` party |
| Issued Invoice | 1 | 1 — credit `profits` (system), debit `customer` |
| Withdrawal | 1 | 1 — credit `bank`, debit `cash_register` (the custodian's drawer or the office one) |
| Deposit | 1 | 1 — credit `cash_register` or `partner`, debit `bank` |
| Micro-investment | 1 | 2 — (a) credit `supplier`, debit `investment`; (b) credit `partner` (investor), debit `supplier` |
| Settlement *(new)* | 1 | 1 — credit `cash_register` (custodian's), debit `bank` |
| Opening Balance *(new, `prd.md` §25)* | 1 | 1 — credit `party`/debit system `opening_balances` party (crediting a starting balance), or the reverse (debiting one) |

## Balance semantics after the cash-custodian change

| Scenario | What it now looks like |
|---|---|
| John takes €500 cash | "Cash held by John" debit balance +500. John (the Partner) untouched. |
| John spends €300 of it on supplies | "Cash held by John" credit +300. John untouched. |
| John returns €200 leftover | "Cash held by John" credit +200. John untouched. The register is now at €0. |
| Company actually owes John €100 reimbursement | John (Partner) debit +100. No cash mixed in — this is a clean payable. |

A custodian's *Partner* balance now means exactly "what the company owes this person". A custodian's *cash-register* balance means exactly "what cash they're holding right now". The two stop being tangled.

## Attachments

One document per transaction group, stored in S3-compatible object storage (Tigris hosted / MinIO self-host, `prd.md` §20). The transaction group keeps the **object key** plus MIME type, byte size, and original filename — not a URL, since access is via short-lived presigned URLs minted per request. No separate `attachments` table needed for MVP. If multi-attachment ever becomes a thing, split it then.

## Tenant isolation (one paragraph)

> **Superseded** — the original membership-checking RLS design (below) was dropped 2026-08-05 for application-side scoping, then RLS was reinstated 2026-10-31 in a narrower backstop role (`prd.md` §19). Original text kept for context: *"Every profile-scoped table has a `profile_id` column. RLS policy on each table: 'row is visible to the current user iff a row exists in `profile_members` for `(current_user, row.profile_id)`'. Service-role key bypasses RLS and is held only server-side, used by seed/admin paths. This is the entire isolation story — no application-layer fallback is load-bearing."*

Current design (2026-10-31): every profile-scoped table has a `profile_id` column and the membership rule is unchanged. Two layers enforce it. **The accessor** checks membership once per request in application code, sets the active user and profile as transaction-local Postgres settings, then injects `profile_id` into every read, sets it on inserts, and strips it from updates. **RLS** sits behind it as a backstop: each data table has one profile-only policy (`profile_id` must equal the active profile), so a query that skips the accessor returns no rows instead of another tenant's — and a forgotten setting also returns nothing, never the wrong tenant. `profile_members` and `profiles` are keyed by user instead, so the membership check and profile switcher work. Request traffic runs as an app role subject to RLS; the owner role bypasses it and is used only for migrations and profile bootstrap, quarantined behind a lint rule. Each table carries a cross-tenant integration test, through the accessor and as a raw query on the app role. Unlike the original design, the policies check tenant equality only, not membership — that stays in the accessor. See `prd.md` §19 for the reasoning.

---

# Summary of the recommendations

1. **Two tables for the ledger** (`transaction_groups`, `records`). No typed helpers per transaction type.
2. **Withdrawal and Settlement are just records** with two money-store parties. No `bank_source`/`bank_destination` columns; no dedicated `Transfer` type.
3. **Custodian lives on the cash-register Party** as a nullable self-reference. Cash custody and real receivables stop overlapping.
4. **Auto-create cash registers** on the Withdrawal form when withdrawing to a person who doesn't have one yet.
5. **Soft-delete on close.** Hard-delete blocked when records exist.
6. **Custodian eligibility constrained in UI**, not schema. Partner and Worker by default; opens up cheaply if needed.
7. **Multi-attachment deferred to v2.** *(The `worker` role, originally deferred too, now ships in MVP — `prd.md` §32.)*

If this lands, the next plan to write is the actual table-level migration with column types, indexes, and the seed script for new profiles — as dbmate SQL per `prd.md` §18, with tenant scoping in the data-access layer and an RLS policy per tenant-scoped table, both per §19.
