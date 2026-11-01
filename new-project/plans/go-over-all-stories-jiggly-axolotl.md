# Clarifications: user-stories.md vs Accounting module (and vs prd.md / setup-config.md)

## Context

Task: review every story in `new-project/user-stories.md` against (a) the legacy `Accounting` module it claims to be derived from, and (b) its sibling design docs `prd.md` + `setup-config.md` describing a Next.js + Supabase rebuild. Surface everything that needs clarification or correction.

`user-stories.md` opens with "Derived from analysis of the existing Accounting module" but lives next to forward-looking design docs and conflicts with both the legacy module AND the design docs in many places.

## The single question that has to be settled first

**Is `user-stories.md` (1) a legacy snapshot, (2) a forward-looking spec for the rebuild, or (3) a hybrid?**

**RESOLVED (2026-05-05):** Legacy snapshot. Layer A fixes applied. Layer B fixes deferred — `prd.md` remains the authoritative rebuild spec; a header note in `user-stories.md` points readers there.

---

## Already resolved (your answers from this session)

- **US-001 registration** — keep admin-managed (matches legacy). *Conflict:* `prd.md` §6.14 / `setup-config.md` §4.1 specify open self-service signup via Supabase Auth in the rebuild.
- **US-007 Profits/Expenses** — flag as open in the doc. *Note:* `setup-config.md` §3.1 already decides these are non-assignable system types.
- **BasicUser definition** — `setup-config.md` retires `BasicUser`, replaces with backlog `worker`. **Verified directly against the model:** legacy `BasicUser` has READ-only access on both `Party` and `Record` entities (no WRITE grants). So the Epic 13 row "Read own records and parties (limited fields)" is correct; the module *role description* ("add expenses pretty much anonymously") is the part that's wrong. Reverses my earlier read.
- **AccountantManager** — redundant, remove. **Confirmed (2026-05-05):** the role exists in legacy but is vestigial — granted only `ACT_Record_Save_Expense`, `ACT_Record_Save_Withdrawal`, and `DS_Party_PartyGroupSelection`, with no `VIEW` access to any new-edit page and no demo user assigned, so it is unreachable through the UI. Dropped from the Epic 13 table. US-005 carries a one-line footnote noting the role exists in legacy but is unused.

---

## Layer A — `user-stories.md` vs the legacy Accounting module

### Authentication & Multi-Tenancy
- **A1 (US-002)** — Story doesn't mention password reset. `Administration_MultiTenant` includes a password-change form (`ChangeMyPasswordForm`); rebuild adds reset via Supabase Auth. Worth adding.
- **A2 (US-004)** — Legacy module-level user management is via `Administration_MultiTenant.Account_New_Manager` (per-tenant). Story phrasing is fine for legacy.
- **A3 (US-005)** — Lists 3 roles; legacy has 5. Note: legacy role is misspelled `Admnistrator` in the actual project — flag whether stories should use the (correct) "Administrator" or preserve the typo.

### Party Management
- **A4 (US-006)** — `Party` entity attributes: `Name`, **`Descritpion`** (sic — typo in legacy), `PartyType`, `Active`, `SystemDefault`, `UseAsGroup`, `CreditBalance`, `DebitBalance`, `Owner`, `CreatedDate`. Story says "name, type, description" — accurate but doesn't mention the typo will need fixing on the way out.
- **A5 (US-007)** — `ENUM_PartyType` has 11 values: `Bank, Investment, Suppliers` (plural), `Warehouse, Partner, Utility, Worker, Profits, Expenses, Tenant, CashRegister`. Story lists 9 and uses singular "Supplier".
- **A6 (US-008)** — Legacy `Party` has no explicit "OpeningBalance" attribute; `CreditBalance`/`DebitBalance` are calculated from records. Need to confirm whether opening balance is supported via a special seed Record or simply isn't supported. Story may overstate the legacy.
- **A7 (US-010)** — Editing party `Type` after records exist would silently re-route ledger semantics. Worth confirming that's actually intended; if not, story should restrict type-change.
- **A8 (US-011)** — Legacy supports both `Active=false` (deactivate) and entity DELETE per access rules. Setup-config §1.2 says rebuild forbids hard-delete when records are linked. For legacy this is fine; if forward-looking, split the story.
- **A9 (US-012)** — Confirmed real: `Party.UseAsGroup` flag + `BelongsToGroup` self-association. ✓ Matches legacy.
- **A10 (Stories miss this)** — `Party_DefaultAccount` association links a Party to an `Administration_MultiTenant.Account` (a user). No story mentions party↔user linkage. `setup-config.md` §3.1 picks this up for `partner`/`worker`. Add a story.

### Transaction Entry & History
- **A11 (US-022)** — `ENUM_RecieivedInvoiceType` has values `Investment, Cost`. ✓ matches story. Note: enum name itself is misspelled (`Recieived` instead of `Received`) — flag for the rebuild rename.
- **A12 (US-015 / US-019)** — `ENUM_PaymentType`: `DirectTransfer, Indirect`. Story says "direct bank transfer or via an intermediary partner" — matches `Indirect` semantics. ✓
- **A13 (US-024)** — ~~Story is wrong.~~ **Verified against `ACT_Record_Save_IssuedInvoice` (2026-05-05):** the microflow does `Credit = $Profits, Debit = customer`. So legacy story is **correct as written** — Profits IS credited. The plan's earlier suspicion (and any apparent contradiction with `prd.md` §4) reflects a *prd.md* table that disagrees with the legacy code, not a story bug. No change to US-024 needed for legacy snapshot. Worth raising separately whether the rebuild intends to flip the direction.
- **A14 (US-028)** — Legacy `MicroinvestmentHelper` extends `TransactionHelper` which has `_Supplier`, `_Investment`, and `_Partner` (investor) associations — meaning the user picks all three. Story wording understates this; should explicitly list the three party choices.
- **A15 (US-031, US-034)** — `RecordEditHelper` exists with associations to `Record`, `TransactionGroup`, `Credit`, `Debit` parties — confirming legacy supports record-level edit. So US-034 matches legacy. (But it contradicts the rebuild — see B below.)
- **A16 (Stories miss this)** — `Record` entity has **no WRITE grant** for any role. Records are produced exclusively by microflows. `NFR-001` mentions double-entry but no story explicitly says "users never CRUD Records directly". Worth saying outright; otherwise US-031/US-034 read like the user edits records.

### Document Attachments
- **A17 (US-038/US-039)** — Legacy splits `DocumentFile` (`System.FileDocument`) and `DocumentImage` (`System.Image`) with separate pages/associations. Story treats both as one concept. Decide whether to mirror the split or describe a unified attachment.

### Mobile / Wizard
- **A18 (US-045)** — Wizard pattern is real in legacy: `TransactionHelper._PageNum` and `PageInstructions` attributes drive a multi-step page flow. ✓
- **A19 (US-046)** — Legacy `TransactionHelper.AmountTemp` (string) feeds amount parsing. ✓ Matches story intent.

### Roles table (Epic 13)
- **A20** — `Administrator` is described as "User and role management; read-only on all parties". Legacy access rules confirm: `Admnistrator` has READ on `Party` (no WHERE clause) and no WRITE — i.e. global read across tenants. ✓ Matches.
- **A21** — Recommend the table renames "tenant" → "tenant project" (or whatever the rebuild settles on) to avoid clash with the `Tenant` party type.

### Terminology / hygiene
- **A22** — Stories alternate "party" / "counterparty" — pick one.
- **A23** — `ENUM_TransactionType` has an 8th value `complete` not covered by any story. Almost certainly a wizard end-marker; either stays internal or gets retired in the rebuild. Worth noting in a "known-not-a-story" section.

---

## Layer B — `user-stories.md` vs `prd.md` / `setup-config.md` (the rebuild)

These are larger and only matter if the doc is forward-looking.

| # | Story | Issue (rebuild design says…) |
|---|---|---|
| B1 | US-005, Epic 13 | Rebuild has 2 tenant roles (`owner`, `accountant`) + platform `admin`. `worker` is backlog. 5-role model is obsolete. |
| B2 | US-001 | Open self-service registration via better-auth (`prd.md` §21), with `ALLOW_REGISTRATION` toggle, email verification. |
| B3 | US-003, US-004, NFR-003 | Rebuild uses **profile** (one user → many profiles), not "tenant". Profile sharing deferred to v2 — so US-004 (admin manages users *within* tenant) has no MVP analogue. |
| B4 | US-007 | Rebuild types: `Bank, CashRegister, Supplier, Customer, Partner, Utility, Worker, Investment, Profits, Expenses` (10). Adds **Customer**, drops **Tenant** and **Warehouse**. Story is missing Customer. |
| B5 | US-024 | `prd.md` §4 transaction-type table puts Profits on the debit side for issued invoices — story has the direction wrong. (Same finding as A13 — applies to both layers.) |
| B6 | Epic 11 (US-041–US-043) | `prd.md` §6 explicitly **defers Excel/PDF export to v2**. Epic 11 should not be MVP. |
| B7 | Epic 12, NFR-005 | Stories require "separate optimised UIs". `prd.md` §7 says **mobile-first single responsive UI** (390 px primary). Separate-UI requirement is a legacy artefact. |
| B8 | US-038 | `prd.md` §6.13: **one document per transaction**, Squoosh WASM client-side compression, formats JPEG/PNG/HEIC/PDF, Supabase Storage. Story is silent on these constraints. |
| B9 | US-030 | `prd.md` §6.10 supports search by description and filter by date range + transaction type — **not by party**. Story has "by party". |
| B10 | US-034 | `setup-config.md` §1.2 explicitly forbids changing credit/debit party wiring on existing transactions — corrections must be delete + re-enter. Directly contradicts US-034. |
| B11 | US-008 | `prd.md` §6.2 doesn't mention opening balance for newly created parties. Could be a feature drop. |
| B12 | US-012 | `prd.md` doesn't mention party hierarchy / parent party. Possible feature drop in the rebuild. |
| B13 | US-002 | Rebuild adds password reset via email link (`setup-config.md` §4.4). Story should include it. |
| B14 | US-013 | Rebuild's seed parties (`bank, cash_register, profits, expenses`) match story. ✓ |

---

## Recommended next step

1. ~~**Decide the top-level question**~~ — Done: legacy snapshot.
2. ~~**Apply Layer A fixes**~~ — Done (2026-05-05). See "Edits applied" below.
3. ~~**Apply Layer B fixes only if forward-looking.**~~ — Skipped per scope. Header note added to `user-stories.md` pointing to `prd.md`.
4. Optional housekeeping: typos `Descritpion` (Party attribute), `Recieived` (enum name), `Admnistrator` (role name) — **explicitly preserved** in stories with "(sic)" / "(misspelled)" annotations so the typo→rename work is captured for the rebuild without silently fixing legacy state.

## Edits applied to `user-stories.md` (2026-05-05)

- Added scope header marking the doc as a legacy snapshot and linking `prd.md` / `setup-config.md`.
- US-001: flipped to admin-managed account creation.
- US-002: added password change (legacy `ChangeMyPasswordForm`); noted no email reset in legacy.
- US-005: listed 4 active legacy roles + `Admnistrator` (sic); `AccountantManager` mentioned only in a footnote as vestigial/unused.
- Epic 2 heading: "(Counterparties)" dropped — "party" used throughout.
- US-006: noted `Descritpion` attribute typo.
- US-007: replaced 9-value list with the actual 11 enum values (plural `Suppliers`, plus `Warehouse`, `Tenant`); flagged `Profits`/`Expenses` as system-managed.
- US-008: rewritten — legacy has no `OpeningBalance`, balances are always derived.
- US-010: caveat that editing `PartyType` after records exist re-routes ledger semantics.
- US-011: noted both deactivate and DELETE are supported in legacy.
- US-012: confirmed against `Party.UseAsGroup` + `BelongsToGroup`.
- New US-013a: party↔account link via `Party_DefaultAccount`.
- US-022: noted `ENUM_RecieivedInvoiceType` enum-name typo.
- US-024: **left as-is** (verified correct against the microflow).
- US-028: expanded to make explicit the three party choices (supplier, investment, partner).
- US-038/US-039: split into `DocumentFile` vs `DocumentImage` to match the legacy entity split.
- Epic 13 table: removed AccountantManager row entirely; rewrote Administrator description and noted `Admnistrator` typo.
- New NFR-006: `Record` rows produced exclusively by microflows (no WRITE grants).

## Open items not addressed in this pass

- **A23** `ENUM_TransactionType.complete` — likely an internal wizard end-marker; not user-visible. Left out of stories deliberately. If the rebuild keeps the wizard, decide whether `complete` survives.

## Also fixed (2026-05-05)

- **`prd.md` §4 Issued Invoice direction** — verified all 7 transaction-type rows against the actual `ACT_Record_Save_*` microflows. Only the Issued Invoice row was inverted (`Customer → Profits` vs legacy `Profits → Customer`). Confirmed as a pure typo (every other row matches legacy and standard double-entry: debit A/R, credit revenue). Edited `prd.md:72` to `Profits → Customer`.

## Files to modify

- `/workspaces/Bapp-main/new-project/user-stories.md` — only file edited. No code changes for this task.

## Verification

After edits, re-read `user-stories.md` end-to-end and confirm:
- Every role mentioned is defined in the chosen target.
- Every party type listed matches the target's enum/seed.
- Every transaction type maps to a real microflow (legacy) or `prd.md` §6 sub-section (rebuild).
- "Tenant" is used in only one sense per story.
- US-024 has the correct credit/debit direction.
