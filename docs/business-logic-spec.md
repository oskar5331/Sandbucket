# Legacy Business Logic Specification — `Accounting` Module

> **Scope:** This is a **legacy snapshot**, at the mechanics level, of the existing Mendix `Accounting` module. It is descriptive, not prescriptive. Where anything here conflicts with [`prd.md`](./prd.md) or [`setup-config.md`](./setup-config.md), those documents win — this document exists so an engineer can mirror legacy mechanics 1:1 in Server Actions *without* opening Studio Pro, not to argue for keeping them.
>
> **Siblings, not duplicates:** [`user-stories.md`](./user-stories.md) captures this module at a narrative/story level. [`plans/go-over-all-stories-jiggly-axolotl.md`](./plans/go-over-all-stories-jiggly-axolotl.md) is the story-vs-module verification pass. [`cash-custodian.md`](./cash-custodian.md) is a forward-looking design note about cash-register semantics. This document goes one level deeper than all three: every field, every validation condition + exact message, every credit/debit branch, and the exact balance algorithm, sourced directly from `DESCRIBE MICROFLOW` / `DESCRIBE ENTITY` output against `BookKeeper.mpr`. Everything stated here was read from the actual microflow body, not inferred from naming.
>
> **Typos are preserved verbatim** throughout (entity/attribute/enum names, validation messages) and flagged inline with *(sic)*. Do not silently correct them when implementing — decide explicitly whether to rename in the rebuild.
>
> Cross-references use `US-xxx` (user-stories.md) and `§N` (prd.md decisions log).

---

## 1. Helper-entity ↔ save-microflow reality check (read this first)

The module models "one helper entity per transaction type," and that's true for five of the seven. **It is not true for Withdrawal or Deposit** — this single fact changes how many distinct object shapes the rebuild actually needs to reason about:

| PRD §4 transaction type | Save microflow | Parameter type the microflow actually declares | Dedicated helper entity in the domain model? |
|---|---|---|---|
| Expense | `ACT_Record_Save_Expense` | `Accounting.ExpenseHelper` | Yes |
| Income | `ACT_Record_Save_Income` | `Accounting.IncomeHelper` | Yes |
| Received Invoice | `ACT_Record_Save_ReceivedInvoice` | `Accounting.ReceivedInvoiceHelper` | Yes |
| Issued Invoice | `ACT_Record_Save_IssuedInvoice` | `Accounting.IssuedInvoiceHelper` | Yes |
| **Withdrawal** | `ACT_Record_Save_Withdrawal` | **`Accounting.ExpenseHelper`** (same class as Expense) | No entity named `WithdrawalHelper`/`WithdrowalHelper` exists at all. `VAL_WithdrowalHelper` (sic) also takes an `$ExpenseHelper` parameter. |
| **Deposit** | `ACT_Record_Save_Deposit` | **`Accounting.IncomeHelper`** (same class as Income) | A `DepositHelper` entity *does* exist in the model (extends `TransactionHelper`, has its own access grants) but is **provably dead** — `SHOW CALLERS OF Accounting.DepositHelper` returns zero results. `VIEW_Deposit_New` creates an `IncomeHelper`, not a `DepositHelper`. |
| Micro-investment | `ACT_Record_Save_MicroInvestment` | `Accounting.MicroinvestmentHelper` | Yes |

**Implication for the rebuild:** legacy's real data shape is five families (Expense/Withdrawal share one, Income/Deposit share one), not seven. This doesn't have to be mirrored — Zod discriminated unions per §13 are a cleaner fit anyway — but it explains why, below, the Withdrawal and Deposit validation/bucketing logic looks structurally identical to Expense/Income with branches simply not wired up.

---

## 2. Domain model reference

### 2.1 Entities

| Entity | Persistence | Extends | Purpose |
|---|---|---|---|
| `Party` | Persistent | — | A counterparty / ledger account. See §2.2. |
| `Record` | Persistent | — | One double-entry line: `Credit` party, `Debit` party, `Amount`, `Date`, `Description`. Produced only by microflows (see §7, NFR-006). |
| `TransactionGroup` | Persistent | — | Groups one or more `Record`s into a user-visible transaction. |
| `TransactionHelper` | Non-persistent | — | Base form-backing object for all transaction entry. Never instantiated directly — always via a subtype. |
| `ExpenseHelper` | Persistent (form helper) | `TransactionHelper` | Backs Expense **and** Withdrawal forms. Adds no attributes of its own. |
| `IncomeHelper` | Persistent (form helper) | `TransactionHelper` | Backs Income **and** Deposit forms. Adds no attributes of its own. |
| `ReceivedInvoiceHelper` | Persistent (form helper) | `TransactionHelper` | Backs Received Invoice form. |
| `IssuedInvoiceHelper` | Persistent (form helper) | `TransactionHelper` | Backs Issued Invoice form. |
| `MicroinvestmentHelper` | Persistent (form helper) | `TransactionHelper` | Backs Micro-investment form. |
| `DepositHelper` | Persistent (form helper) | `TransactionHelper` | **Dead.** Exists with full access grants, zero callers anywhere in the module. |
| `PartyHelper` | Non-persistent | — | Form-backing object for Party create/edit. |
| `RecordEditHelper` | Non-persistent | — | Form-backing object for the SuperAccountant-only "advanced edit" (per-Record Credit/Debit rewiring). |
| `TransacitonGroupHelper` *(sic — "Transaciton")* | Non-persistent | — | Form-backing object for the basic TransactionGroup edit (date/amount/description only). |
| `DocumentFile` | Persistent | `System.FileDocument` | Non-image attachment. |
| `DocumentImage` | Persistent | `System.Image` | Image/photo attachment (camera capture path). |
| `DocumentViewHelper` | Non-persistent | — | Read-only helper for the attachment viewer; resolves to either a `DocumentFile` or `DocumentImage`. |
| `TenantProject` | Persistent | — | Per-tenant scoping anchor for `Party`. Zero role grants of its own (`AccessRules: 0`) — never shown on any page, only resolved internally via `ROC_TenantProject`. |
| `RecordExportToken` | Persistent | — | Export-wizard configuration object (Epic 11 — out of MVP scope per PRD §6). |
| `RecordTotal` | Non-persistent | — | `{DebitTotal, CreditTotal}` — feeds the party balance-summary view (US-037). |
| `M_Records_Owned_DataGrid` | Persistent, extends `System.Paging` | — | Mobile datagrid paging helper, UI-only. |

### 2.2 Key attribute lists

**`Party`** (9 own attributes + system columns):

| Attribute | Type | Notes |
|---|---|---|
| `CustomId` | AutoNumber | |
| `Active` | Boolean, default `true` | Deactivation flag (US-011). |
| `SystemDefault` | Boolean, default `false` | "Exactly one per `PartyType`" — enforced by `VAL_PartyHelper_SystemDefault` (see §5, with a bug noted in §8). |
| `UseAsGroup` | Boolean, default `false` | Backs US-012 party grouping. |
| `CreditBalance` | Decimal, default `0` | **Directly WRITE-granted to `Accountant` and `SuperAccountant`** on the real `Party` entity (not just the helper) — see §8 quirk on manual balance edits. |
| `DebitBalance` | Decimal, default `0` | Same write-grant as above. |
| `Descritpion` *(sic)* | String(unlimited) | |
| `Name` | String(unlimited) | |
| `PartyType` | Enumeration `ENUM_PartyType` | Writable by `Accountant` **and** `SuperAccountant` at any time — no check blocks changing type on a Party with existing Records (see §5.4, §8). |
| `Owner` / `ChangedBy` / `CreatedDate` | Auto* | |

**`Record`** (persistent, index present; two entity events):

| Attribute | Type | Notes |
|---|---|---|
| `CustomId` | AutoNumber | |
| `IsCustom` | Boolean, default `false` | **Never set by any microflow traced in this pass** (not by `SUB_Record_SetFields`, not by the initial-balance seeder). Purpose undetermined — possibly vestigial or used by an export path outside this task's scope. Flag, don't guess at behaviour. |
| `Amount` | Decimal | |
| `Description` | String(unlimited) | |
| `Date` | Date | "the date it actually happened" (doc comment) |
| `Owner` / `ChangedBy` / `CreatedDate` / `ChangedDate` | Auto* | |

Entity events: `on after commit call ADE_ACO_Record_CalculatePartyBalance($currentObject)`, `on after delete call ADE_ACO_Record_CalculatePartyBalance($currentObject)` — see §4.

**`TransactionGroup`**:

| Attribute | Type | Notes |
|---|---|---|
| `CustomId` | AutoNumber | |
| `_TransacitonType` *(sic — "Transaciton")* | Enumeration `ENUM_TransactionType` | |
| `Date` | DateTime | Doc comment: "not definitive, only indicates the latest transaction date — may not be the same for all transactions in the same grouping." |
| `Amount` | Decimal | **This is the nominal input amount from the form, not a sum of child Records' amounts.** For Micro-investment (2 Records), both Records carry the same Amount as the group — there is no case in the traced flows where they'd diverge, but the field is not computed as a sum. |
| `Description` | String(unlimited) | |
| `Owner` / `ChangedBy` / `CreatedDate` | Auto* | |

**`TransactionHelper`** (base, non-persistent — all subtypes inherit these):

| Attribute | Type | Default | Used by |
|---|---|---|---|
| `_PageNum` | Integer | `0` | Mobile wizard step counter (US-045). |
| `IsPaymentDone` | Boolean | `false` | |
| `NoDocument` | Boolean | `false` | Skips document validation entirely when true. |
| `TransactionDate` | Date | — | Expense, Income, Withdrawal, Deposit, Micro-investment. |
| `InvoiceDate` | Date | — | Received Invoice, Issued Invoice. Also present-but-unused-for-bucketing on other subtypes. |
| `Amount` | Decimal | — | All. |
| `DocumentType` | Enum `ENUM_DocumentType` (`file`/`image`) | — | Drives `DocumentFile` vs `DocumentImage` resolution. |
| `PaymentType` | Enum `ENUM_PaymentType` (`DirectTransfer`/`Indirect`) | — | **Only actually read by Expense and Income's bucketing logic.** Present on every subtype (inherited) but ignored by Withdrawal's and Deposit's save microflows even though `IncomeHelper`/`ExpenseHelper` carry it. Never validated as required anywhere (see §8). |
| `InvoiceType` | Enum `ENUM_RecieivedInvoiceType` (sic) (`Investment`/`Cost`) | — | **Only actually read by Received Invoice's bucketing.** `IssuedInvoiceHelper` inherits and even gets it defaulted to `Investment` on form-open, but Issued Invoice's save/validation never reads it — inert for that subtype. |
| `AmountTemp` | String(unlimited) | — | Mobile free-text amount entry (US-046), parsed into `Amount` client-side. |
| `PageInstructions` | String(unlimited) | — | Wizard step copy. |
| `UserDescription` | String(unlimited) | — | The user-entered description; validated by `VAL_RecordHelper_Description`. |
| `IsFutureAllowed` | Boolean | `false` | **Only actually read by Expense's validation** (`VAL_ExpenseHelper` passes it through to `VAL_RecordHelper_TransactionDate`). Withdrawal (same entity class) hardcodes `FutureAllowed = false` regardless of this flag's value. All other flows hardcode `false` too. |

Associations exposed on `TransactionHelper` (all `Reference` to `Accounting.Party` unless noted): `TransactionHelper_Bank`, `TransactionHelper_CashRegister` *(dead — see §8)*, `TransactionHelper_Credit`, `TransactionHelper_Debit`, `TransactionHelper_Investment`, `TransactionHelper_Partner`, `TransactionHelper_Supplier`, plus `TransactionHelper_TransactionGroup` (→`TransactionGroup`), `TransactionHelper_DocumentFile`/`TransactionHelper_DocumentImage`, `TransactionHelper_TenantProject`.

**`PartyHelper`**: `Active`, `CreditBalance`, `DebitBalance`, `Descritpion` (sic), `Name`, `PartyType`, `SystemDefault` — a 1:1 mirror of `Party`'s editable fields, plus associations `PartyHelper_Party` (→ real Party, empty when creating), `PartyHelper_PartyGroup` (→ Party, the "belongs to group" pick), `PartyHelper_DefaultAccount` (→ `Administration_MultiTenant.Account`), `PartyHelper_TenantProject`.

**`RecordEditHelper`**: `RecordId` (Integer — display/reference only), `Description`; associations `RecordEditHelper_Record`, `RecordEditHelper_TransactionGroup`, `RecordEditHelper_Credit`, `RecordEditHelper_Debit`.

**`TransacitonGroupHelper`** *(sic)*: `Amount`, `Description`, `Date` (DateTime), `OwnerName`, `_HasDocument`; association `TransacitonGroupHelper_TransactionGroup`.

### 2.3 Associations (business-relevant subset)

| Association | From → To | Type | Delete behaviour | Notes |
|---|---|---|---|---|
| `Credit` | `Record` → `Party` | Reference | `DELETE_IF_NO_REFERENCES` | A Party referenced by any Record as Credit **cannot be hard-deleted** — this is the mechanism, not just a policy, behind "parties with linked Records cannot be hard-deleted" (matches prd.md §8). |
| `Debit` | `Record` → `Party` | Reference | `DELETE_IF_NO_REFERENCES` | Same guarantee on the debit side. |
| `Record_TransactionGroup` | `Record` → `TransactionGroup` | Reference | `DELETE_CASCADE` | Deleting a `TransactionGroup` cascades to delete every child `Record` — each cascade-delete individually fires the Record's `on after delete` balance-recalc event. |
| `BelongsToGroup` | `Party` → `Party` (self) | Reference | `DELETE_BUT_KEEP_REFERENCES` | Backs US-012 party hierarchy. |
| `Party_DefaultAccount` | `Party` → `Administration_MultiTenant.Account` | Reference, owner `Both` | `DELETE_BUT_KEEP_REFERENCES` | Links a Party to a real user login (US-013a). **Only ever wired for `PartyType = Partner`** — see §5.1; never wired for `Worker` despite `Worker` being in the enum. |
| `Party_TenantProject` | `Party` → `TenantProject` | Reference | `DELETE_BUT_KEEP_REFERENCES` | Tenant scoping anchor. |
| `TransactionHelper_Bank` | `TransactionHelper` → `Party` | Reference | `DELETE_BUT_KEEP_REFERENCES` | Doc comment: "Bank account from which the expense is taken." Accepts `PartyType ∈ {Bank, CashRegister}` per `VAL_RecordHelper_Bank` (§3, shared validations) — i.e. cash-register-typed parties are *already* valid picks for this slot in the current model. |
| `TransactionHelper_CashRegister` | `TransactionHelper` → `Party` | Reference | `DELETE_BUT_KEEP_REFERENCES` | **Dead** — populated on the Expense form (via `ROC_Party_GetRegister`) but zero callers reference it in any bucketing decision (confirmed via `SHOW CALLERS`). Matches `cash-custodian.md`'s existing note; now tool-confirmed. |
| `TransactionHelper_Credit` / `TransactionHelper_Debit` | `TransactionHelper` → `Party` | Reference | `DELETE_BUT_KEEP_REFERENCES` | Generic "the other side" slots — used as Income's source, Issued Invoice's/Micro-investment's target, and the Advanced-Edit rewiring targets. |
| `TransactionHelper_Investment` | `TransactionHelper` → `Party` | Reference | `DELETE_BUT_KEEP_REFERENCES` | The Investment-type party for Received Invoice / Micro-investment. **Also overloaded** as an ad hoc "party group filter" scratch field inside four `DS_Party_Selection_*` picker microflows (Expense/Income/Issued-Invoice supplier/credit/debit pickers) — unrelated to its investment meaning in that context. |
| `TransactionHelper_Partner` | `TransactionHelper` → `Party` | Reference | `DELETE_BUT_KEEP_REFERENCES` | The Partner/investor slot. |
| `TransactionHelper_Supplier` | `TransactionHelper` → `Party` | Reference | `DELETE_BUT_KEEP_REFERENCES` | The Supplier slot. |
| `TransactionGroup_FileDocument` | `TransactionGroup` → `System.FileDocument` | **ReferenceSet** | `DELETE_BUT_KEEP_REFERENCES` | One `TransactionGroup` can technically reference multiple files at the model level (ReferenceSet), even though PRD §6.13 specifies one document per transaction for the rebuild. |
| `RecordEditHelper_Credit` / `RecordEditHelper_Debit` | `RecordEditHelper` → `Party` | Reference | `DELETE_BUT_KEEP_REFERENCES` | The *new* Credit/Debit picks for Advanced Edit. |

### 2.4 Enumerations (exact values, exact order)

**`ENUM_PartyType`** (11 values):
`Bank`, `Investment`, `Suppliers` *(sic — plural)*, `Warehouse` (caption "Warehouse (Supplier)"), `Partner`, `Utility` (caption "Utility (Supplier)"), `Worker` (caption "Worker (Supplier)"), `Profits`, `Expenses`, `Tenant`, `CashRegister` (caption "Cash register (Bank)").

**`ENUM_TransactionType`** (8 values, all lower/snake_case — not PascalCase): `withdrawal`, `deposit`, `expense`, `received_invoice`, `income`, `issued_invoice`, `microinvestment`, `complete`. The last (`complete`) is not produced by any of the 7 save microflows — see §8.

**`ENUM_PaymentType`** (2 values): `DirectTransfer`, `Indirect`.

**`ENUM_RecieivedInvoiceType`** *(sic — "Recieived")* (2 values): `Investment`, `Cost`.

**`ENUM_DocumentType`** (2 values, previously undocumented in sibling files): `file`, `image` — drives whether a `DocumentFile` or `DocumentImage` gets attached (see `SUB_RecordHelper_GetDocument`, §3).

---

## 3. Transaction-save flows

Every flow follows the same skeleton:
1. Call the type's `VAL_*Helper` validator; if it returns `false`, `return` immediately (page stays open, no commit).
2. Resolve/attach the document via `SUB_RecordHelper_GetDocument` (returns the `DocumentFile` or `DocumentImage` per `DocumentType`, or `empty` if `NoDocument`).
3. Create (or, Expense only, resolve) the `TransactionGroup` via `SUB_TransactionGroup_New` (or `ROC_TransactionGroup` for Expense).
4. Commit the `TransactionGroup`.
5. Create one or more `Record`s via `SUB_Record_SetFields` (sets `Debit`, `Credit`, `Amount`, `Description`, `Date = TransactionDate param`, `Record_TransactionGroup`).
6. Commit the `Record`(s) **with events** — this is what fires `ADE_ACO_Record_CalculatePartyBalance` (§4).
7. Close the page.

`SUB_Record_SetFields` (the shared record-creation primitive, "the single most important microflow"):

```
SUB_Record_SetFields(NewRecord, TransactionDate, Credit, Debit, Description, Amount, TransactionGroup):
  change NewRecord (
    Debit = Debit,
    Credit = Credit,
    Amount = Amount,
    Description = Description,
    Date = TransactionDate,
    Record_TransactionGroup = TransactionGroup
  )
```
It performs no validation and no branching — every credit/debit decision happens in the caller before this is invoked.

`SUB_TransactionGroup_New` defensively re-checks `DescriptionString`/`Amount`/`Date`/`TransactionType` are non-empty and returns `empty` if any is missing — by construction this is unreachable in practice because the caller's `VAL_*` chain already guarantees all four, but it means a silent `empty` TransactionGroup is theoretically possible if that invariant is ever broken upstream.

### 3.1 Expense

- **Helper entity:** `ExpenseHelper`. **Entry microflow:** `VIEW_Expense_New` → desktop `D_Expense_NewEdit` / mobile `M_Expense_NewEdit`.
- **Prefill on open:** `TransactionDate = today`, `PaymentType = DirectTransfer`, `TransactionHelper_Bank = ROC_Party_GetBank()`, `TransactionHelper_Supplier = ROC_Party_GetDefaultSupplier()`, `TransactionHelper_Partner = DS_Party_GetDefaultPartner()`, `TransactionHelper_CashRegister = ROC_Party_GetRegister()` (fetched but never read by the save logic — dead, see §8).
- **Input fields:** `Amount`, `TransactionDate`, `UserDescription`, `PaymentType`, Supplier party pick, Partner party pick (only meaningful if `Indirect`), Bank party pick (only meaningful if `DirectTransfer`), document (file or image) unless `NoDocument`.
- **Supplier picker** (`DS_Party_Selection_ExpenseSupplier`): prepends the current default Supplier, then appends all Parties where `BelongsToGroup = TransactionHelper_Investment` (this DS reuses the Investment slot purely as a scratch "group filter" — unrelated to actual investments), sorted by name.

**Validation (`VAL_ExpenseHelper`):**

| Rule | Condition | Bypass | Message |
|---|---|---|---|
| Partner | `TransactionHelper_Partner` not empty, and its `PartyType = Partner` | Bypassed when `PaymentType != Indirect` | "Investor cannot be empty." / "Investor can only be type of partner" |
| Bank | `TransactionHelper_Bank` not empty, and its `PartyType ∈ {Bank, CashRegister}` | Bypassed when `PaymentType != DirectTransfer` | "Cannot be empty." / "Investor can only be type of Bank or subversions of it." *(sic — message says "Investor" for the bank field)* |
| Supplier | `TransactionHelper_Supplier` not empty | Never bypassed | "Supplier cannot be empty." |
| Amount | not empty and `> 0` | — | "Amount cannot be empty." / "Amount can only be positive and larger than 0." |
| Transaction date | not empty, and `<= EndOfCurrentDayUTC` unless `IsFutureAllowed` | — | "Day cannot be empty." / "Day cannot be set to future." |
| Description | `UserDescription` not empty (`AdministrationCenter.StringNotEmpty`) | — | "Cannot be empty" |
| Document | if `NoDocument` skip; else `DocumentType` set and the resolved file/image has contents | — | "Document needs to be included..." / "Docment content cannot be empty" *(sic)* |

Note: `PaymentType` itself is **never validated as required** (no caller of `VAL_TransactionHelper_PaymentType` exists anywhere — see §8).

**Credit/Debit bucketing:**

| PaymentType | Credit | Debit | Description suffix |
|---|---|---|---|
| `DirectTransfer` | `TransactionHelper_Bank/Party` | `TransactionHelper_Supplier/Party` | `(Direct transfer)` — the enum caption |
| `Indirect` **or empty** | `TransactionHelper_Partner/Party` | `TransactionHelper_Supplier/Party` | `(<Partner name>)` |

Full description: `'Tasutud arve: ' + UserDescription + ' ' + suffix` (Estonian: "Paid invoice: ...").

**TransactionGroup:** via `ROC_TransactionGroup`, which is Expense-specific (hardcodes `TransactionType = expense`) and behaves as:
```
if ExpenseHelper.TransactionHelper_TransactionGroup is empty:
    create a new TransactionGroup (SUB_TransactionGroup_New)
else:
    reuse the existing TransactionGroup, append ' (Täiendatud)' to its Description,
    attach the new file(s), and return it unchanged otherwise
```
The "reuse" branch is what happens when this Expense is actually **paying a previously-recorded Received Invoice** (see 3.1a). **Records committed:** 1 (or 2 total in that group, if the group was reused from a Received Invoice — the invoice's original Supplier→Expenses/Investment Record plus this new payment Record).

#### 3.1a Extending a Received Invoice into a paid Expense (`ACT_Expense_Extend`)

Not in any of the sibling docs. `ACT_Expense_Extend($TransactionGroup)` — called from the invoice's TransactionGroup detail view — opens a **fresh** `ExpenseHelper` via `VIEW_Expense_New`, then pre-fills it from the invoice's existing Record(s):
- Looks up the Party(ies) already linked to that `TransactionGroup` via `Credit`/`Debit`.
- If exactly one distinct Party is found and it has a `BelongsToGroup` parent, sets `TransactionHelper_Investment = that parent`; otherwise re-retrieves any one Party on the group as `$Party_Investment`.
- Sets `TransactionHelper_Supplier = <the found party>`, `TransactionHelper_TransactionGroup = <the original group>`, `Amount = TransactionGroup.Amount`, `AmountTemp = toString(Amount)`, `_PageNum = 1`, `UserDescription = 'Arve makstud, ' + TransactionGroup.Description` (Estonian: "Invoice paid, ...").
- If more than one distinct Party is found on the group, throws (`CommunityCommons.ThrowException`) rather than proceeding — this flow assumes the invoice's group has exactly one counterparty.

When that pre-filled `ExpenseHelper` is saved through the normal `ACT_Record_Save_Expense` path, `ROC_TransactionGroup` sees `TransactionHelper_TransactionGroup` is already set and takes the "reuse" branch above — so a single `TransactionGroup` ends up holding both the original `received_invoice`-type Record and the new payment Record, with the group's `_TransacitonType` still literally `received_invoice` (never changed to `expense`) even though it now has a payment Record attached. **This whole mechanic — invoice-to-payment linking that reuses the group — is absent from prd.md/user-stories.md/cash-custodian.md.**

### 3.2 Income

- **Helper entity:** `IncomeHelper`. **Entry microflow:** `VIEW_Income_New` → `D_IncomeForm_NewEdit` / `M_IncomeForm_NewEdit`.
- **Prefill:** `TransactionDate = today`, `PaymentType = DirectTransfer`, `TransactionHelper_Bank = ROC_Party_GetBank()`, `TransactionHelper_Partner = DS_Party_GetDefaultPartner()`. Note: **the Credit/source party (`TransactionHelper_Credit`) is not prefilled at all** — the user must always pick it.
- **Credit picker** (`DS_Party_Selection_IncomeCredit`): same "prepend default + append BelongsToGroup-via-Investment-slot" pattern as Expense's supplier picker.

**Validation (`VAL_IncomeHelper`):**

| Rule | Condition | Bypass | Message |
|---|---|---|---|
| Partner | not empty, `PartyType = Partner` | Bypassed when `PaymentType != Indirect` | same as Expense |
| Bank | not empty, `PartyType ∈ {Bank, CashRegister}` | Bypassed when `PaymentType != DirectTransfer` | same as Expense |
| Source (`VAL_IncomeHelper_Source`) | `TransactionHelper_Credit` not empty | Never | "Source cannot be empty." — doc annotation notes no party-type restriction is applied ("could be issued to anybody... restrict client-side"). |
| Amount | as Expense | — | |
| Transaction date | not empty, `<= EndOfCurrentDayUTC` — **`FutureAllowed` is hardcoded `false`**, `IsFutureAllowed` is not read | — | "Day cannot be set to future." |
| Description | as Expense | — | |
| Document | as Expense | — | |

**Credit/Debit bucketing:**

| PaymentType | Credit | Debit |
|---|---|---|
| any | `TransactionHelper_Credit/Party` (always) | — |
| `DirectTransfer` | — | `TransactionHelper_Bank/Party` |
| `Indirect` or empty | — | `TransactionHelper_Partner/Party` |

Description: `'Laekunud arve: ' + UserDescription + ' ' + suffix` (Estonian: "Received invoice: ..."), same suffix rule as Expense. **TransactionGroup:** always new (`SUB_TransactionGroup_New`, `TransactionType = income`, `Date = TransactionDate`). **Records committed:** 1.

### 3.3 Received Invoice

- **Helper entity:** `ReceivedInvoiceHelper`. **Entry microflow:** `VIEW_ReceivedInvoice` → `D_ReceivedInvoice_NewEdit` / `M_ReceivedInvoice_NewEdit`.
- **Prefill:** `InvoiceDate = today`, `InvoiceType = Investment` **(default is Investment, not Cost — undocumented UX default)**, `TransactionHelper_Supplier = ROC_Party_GetDefaultSupplier()`, `TransactionHelper_Bank = ROC_Party_GetBank()`, `TransactionHelper_Partner = <Party linked to current user via Party_DefaultAccount>`.
- **Supplier picker** (`DS_Party_Selection_ReceivedInvoiceSupplier`): **buggy** — see §8. It retrieves `TransactionHelper_Investment` as `$Party_group` but never uses it; it then retrieves *all* tenant Parties twice (once into `$Party_default`, without `limit 1`, and again into `$PartyList_grouped`) and concatenates the two, producing a duplicated, unfiltered picker list rather than "default first, then group members."

**Validation (`VAL_ReceivedInvoiceHelper`):**

| Rule | Condition | Bypass | Message |
|---|---|---|---|
| Bank (`$BankOK`) | computed via `VAL_RecordHelper_Bank` | — | **Computed but marked `@excluded` and not included in the final `return` expression — dead validation, has no effect.** |
| Partner/Investor (`$InvestorOK`) | computed via `VAL_TransactionHelper_Partner` | — | **Same — computed, `@excluded`, discarded.** |
| Investment | `TransactionHelper_Investment` not empty, and its `PartyType = Investment` | — | "Investment cannot be empty." / "Investment can only be type of investment" |
| Invoice type | `InvoiceType` not empty | — | "Invoice type cannot be empty." |
| Supplier | not empty | Bypassed when `InvoiceType != Cost` (i.e. required only for Cost invoices) | "Supplier cannot be empty." |
| Amount | as Expense | — | |
| Invoice date | not empty, `<= EndOfCurrentDayUTC`, `FutureAllowed = false` hardcoded | — | "Date cannot be set to future." |
| Description | as Expense | — | |
| Document | as Expense | — | |

**Credit/Debit bucketing:**

| InvoiceType | Credit | Debit |
|---|---|---|
| `Cost` | `TransactionHelper_Supplier/Party` | System `Expenses` party, resolved via `ROC_Party_GetExpenses()` |
| `Investment` | `TransactionHelper_Supplier/Party` | `TransactionHelper_Investment/Party` |

Description: `UserDescription` verbatim (no suffix). **TransactionGroup:** always new, `TransactionType = received_invoice`, `Date = InvoiceDate` (not `TransactionDate`). **Records committed:** 1. This Record can later become 2-in-one-group if extended into an Expense payment (§3.1a).

### 3.4 Issued Invoice

- **Helper entity:** `IssuedInvoiceHelper`. **Entry microflow:** `VIEW_IssuedInvoice` → `D_IssuedInvoice_NewEdit` / `M_IssuedInvoice_NewEdit`.
- **Prefill:** `InvoiceDate = today`, `InvoiceType = Investment` (inert — see §1/§2.2), `TransactionHelper_Bank = ROC_Party_GetBank()`, `TransactionHelper_Partner = <Party linked to current user>`.
- **Debit (customer) picker** (`DS_Party_Selection_IssuedInvoiceDebit`): prepend-default + BelongsToGroup-via-Investment-slot pattern, same as Expense's.

**Validation (`VAL_IssuedInvoiceHelper`):**

| Rule | Condition | Bypass | Message |
|---|---|---|---|
| Bank / Partner | computed | — | **Same dead-validation pattern as Received Invoice — `@excluded`, discarded, no effect.** |
| Investment | `TransactionHelper_Investment` not empty, `PartyType = Investment` | — | same messages as Received Invoice |
| Target (`VAL_IssuedInvoiceHelper_Target`) | `TransactionHelper_Debit` not empty | — | "Invoice receiver cannot be empty." — doc annotation notes no type restriction ("could be issued to anybody"). |
| Amount / Invoice date (`FutureAllowed=false`) / Description / Document | as Received Invoice | — | |

**Credit/Debit bucketing (single, unconditional):**

| Credit | Debit |
|---|---|
| System `Profits` party, via `ROC_Party_GetProfits()` | `TransactionHelper_Debit/Party` (the customer) |

This confirms and restates the finding already verified in `go-over-all-stories-jiggly-axolotl.md` (A13/US-024): **Profits is credited, the customer is debited.** Description: `UserDescription` verbatim. **TransactionGroup:** always new, `TransactionType = issued_invoice`, `Date = InvoiceDate`. **Records committed:** 1.

### 3.5 Withdrawal

- **Helper entity:** `ExpenseHelper` (see §1 — no dedicated Withdrawal entity exists). **Entry microflow:** `VIEW_Withdrawal_New` → `D_Withdrawal_NewEdit` / `M_Withdrawal_NewEdit`.
- **Prefill:** `TransactionDate = today`, `TransactionHelper_Bank = ROC_Party_GetBank()`, `TransactionHelper_Partner = DS_Party_GetDefaultPartner()`. **No `PaymentType` is set or read at all for this flow.**

**Validation (`VAL_WithdrowalHelper`, sic):**

| Rule | Condition | Bypass | Message |
|---|---|---|---|
| Partner | not empty, `PartyType = Partner` | Never (`BypassValidation = false` hardcoded) | as Expense |
| Bank | not empty, `PartyType ∈ {Bank, CashRegister}` | Never | as Expense — called **twice** (once as `$OkBank`, once as `$AccountOK`, identical call, redundant but harmless) |
| Transaction date | not empty, `<= EndOfCurrentDayUTC`, `FutureAllowed = false` hardcoded (`IsFutureAllowed` on the underlying `ExpenseHelper` is ignored here even though Expense itself reads it) | — | |
| Amount / Description / Document | as Expense | — | |

**Credit/Debit bucketing (single, unconditional):**

| Credit | Debit |
|---|---|
| `TransactionHelper_Bank/Party` | `TransactionHelper_Partner/Party` |

This matches `cash-custodian.md`'s description exactly: Bank credited, Partner/Person debited, no `PaymentType` branching. Description: `UserDescription` verbatim. **TransactionGroup:** always new, `TransactionType = withdrawal`, `Date = TransactionDate`. **Records committed:** 1.

### 3.6 Deposit

- **Helper entity:** `IncomeHelper` (see §1 — `DepositHelper` entity is dead). **Entry microflow:** `VIEW_Deposit_New` → `D_Deposit_NewEdit` / `M_Deposit_NewEdit`.
- **Prefill:** `TransactionDate = today`, `TransactionHelper_Bank = ROC_Party_GetBank()`, `TransactionHelper_Partner = DS_Party_GetDefaultPartner()`. **`PaymentType` is not set on creation and is not read by the save logic.**

**Validation (`VAL_DepositHelper`):**

| Rule | Condition | Bypass | Message |
|---|---|---|---|
| Partner | not empty, `PartyType = Partner` | Never | as Expense |
| Bank | not empty, `PartyType ∈ {Bank, CashRegister}` | Never | as Expense |
| Amount / Transaction date (`FutureAllowed=false`) / Description / Document | as Expense/Withdrawal | — | |

**Credit/Debit bucketing (single, unconditional):**

| Credit | Debit |
|---|---|
| `TransactionHelper_Partner/Party` | `TransactionHelper_Bank/Party` |

Exact mirror of Withdrawal, direction reversed. Description: `UserDescription` verbatim. **TransactionGroup:** always new, `TransactionType = deposit`, `Date = TransactionDate`. **Records committed:** 1.

### 3.7 Micro-investment

- **Helper entity:** `MicroinvestmentHelper`. **Entry microflow:** `VIEW_MicroExpense` → `D_MicroInvestment_NewEdit` (param name `$RecordHelper` on desktop vs `$MicroinvestmentHelper` on mobile — inconsistent parameter naming across the two pages, cosmetic only) / `M_MicroInvestment_NewEdit`.
- **Prefill:** `TransactionDate = today`, `TransactionHelper_Supplier = ROC_Party_GetDefaultSupplier()`, `TransactionHelper_Partner = DS_Party_GetDefaultPartner()`. **The Investment party (`TransactionHelper_Debit`, used as the investment target — see below) is never prefilled**, always a manual pick.

**Validation (`VAL_MicroinvestmentHelper`):**

| Rule | Condition | Bypass | Message |
|---|---|---|---|
| Supplier | not empty | Never | "Supplier cannot be empty." |
| Investor/Partner | not empty, `PartyType = Partner` | Never | as Expense |
| Amount / Transaction date (`FutureAllowed=false`) / Description / Document | as Withdrawal/Deposit | — | |

**`VAL_MicroinvestmentHelper_Debit` is never called from `VAL_MicroinvestmentHelper` (zero callers found module-wide). This means the Investment-side party's `PartyType` is never actually checked to be `Investment` for Micro-investment**, unlike Received Invoice and Issued Invoice which do enforce this via `VAL_TransactionHelper_Investment`. Also note: the association actually used as the investment target in the save microflow is `TransactionHelper_Investment` (per the bucketing below), not `TransactionHelper_Debit` as `VAL_MicroinvestmentHelper_Debit`'s own body checks — that validation microflow is checking the *wrong association* for this helper even if it were wired in.

**Credit/Debit bucketing — two Records, one TransactionGroup:**

| Record | Credit | Debit | Description |
|---|---|---|---|
| 1 — the cost | `TransactionHelper_Supplier/Party` | `TransactionHelper_Investment/Party` | `UserDescription` verbatim |
| 2 — the funding | `TransactionHelper_Partner/Party` (the investor) | `TransactionHelper_Supplier/Party` | `'Arve tasumine: ' + UserDescription` (Estonian: "Invoice payment: ...") |

Both Records use the same single `Amount` value. **TransactionGroup:** always new, `TransactionType = microinvestment`, `Date = TransactionDate`, `Amount` = the one input amount (not a sum of the two Records — see §2.2). **Records committed:** 2.

---

## 4. Balance recalculation — `ADE_ACO_Record_CalculatePartyBalance`

**Trigger:** entity events on `Record` — `on after commit` and `on after delete`, both calling this microflow with `$currentObject` (the Record) as parameter. Every one of the 8 commit call-sites above (`commit ... with events`) fires it; a `TransactionGroup` hard-delete cascade-deleting its child Records fires it once per cascaded Record.

**Exact algorithm** (full re-derivation, not incremental):

```
ADE_ACO_Record_CalculatePartyBalance(Record):
  PartyList = retrieve Party where id = Record.Debit or id = Record.Credit   # 1 or 2 parties

  for each Party in PartyList:
      CreditRecordList = retrieve all Records where Record.Credit = Party   # every Record ever, not just this one
      SumCredit = sum(CreditRecordList.Amount)

      DebitRecordList = retrieve all Records where Record.Debit = Party
      SumDebit = sum(DebitRecordList.Amount)

      change Party (CreditBalance = SumCredit, DebitBalance = SumDebit)

  commit PartyList with events, refresh
```

Key properties:
- It recalculates **from scratch** (full sum over the party's entire Record history) for exactly the 1–2 parties touched by the triggering Record — it does not do an incremental `+= amount`.
- On **delete**, `$currentObject` retains its pre-delete `Debit`/`Credit` association values (Mendix's after-delete phantom-object semantics), so the correct 1–2 parties are still identified and correctly recalculated (their sums now naturally exclude the deleted Record).
- **On the Advanced-Edit rewiring path (§6.2) this has a real gap:** when a Record's `Debit`/`Credit` are *changed* (not deleted) — e.g. moved from Party A to Party B — the subsequent `commit ... with events` fires this microflow with the Record's **new** `Debit`/`Credit` values only. Party A (the *old* counterparty, no longer referenced by this Record) is never looked up and never recalculated. Party A's `CreditBalance`/`DebitBalance` stay stale — still including the amount from a Record that no longer touches it — until some *other* Record involving Party A happens to be committed or deleted. **This is a concrete, previously undocumented bug**, and it is a strong independent justification for `setup-config.md` §1.2's rule that the rebuild must forbid changing a Record's credit/debit wiring in place (delete + re-enter instead) — that policy sidesteps this exact staleness class of bug entirely, since delete correctly recalculates.
- There is no cross-party invariant check anywhere (e.g. "does the sum of all Records' `Amount` across the whole ledger balance to zero") — the rebuild's own zero-sum invariant (prd.md §9) is a genuine strengthening, not a like-for-like port.

---

## 5. Party lifecycle

### 5.1 Create / Edit (`ACT_Party_Save_PartyHelper`)

```
ACT_Party_Save_PartyHelper(PartyHelper):
  if not VAL_PartyHelper(PartyHelper): return   # see below

  close page
  Party = SUB_Party_ROC(PartyHelper)            # retrieve existing (via PartyHelper_Party) or create new, TenantProject-scoped
  SUB_Party_CopyData(PartyHelper, Party)        # copy editable fields onto the real Party

  if isNew(Party):
      RecordList = SUB_SetInitialBalances(Party, PartyHelper)
      commit RecordList with events            # see finding below

  commit Party with events, refresh
```

`SUB_Party_ROC`: if `PartyHelper_Party` is already set, return that Party; otherwise `create Party (Party_TenantProject = PartyHelper_TenantProject)` — nothing else set yet.

`SUB_Party_CopyData`: copies `PartyType`, `Active`, `CreditBalance` (defaults to `0` if the helper's value is empty), `DebitBalance` (same), `Descritpion`, `Name`, `SystemDefault`, `BelongsToGroup = PartyHelper_PartyGroup`. **`Party_DefaultAccount` is copied only `if PartyType = Partner`** — never for `Worker`, despite `Worker` being a valid `ENUM_PartyType` value and `setup-config.md` §3.1 treating both `partner` and `worker` as user-assignable in the rebuild. Legacy's account-linking mechanism simply does not fire for Worker-type parties.

**`VAL_PartyHelper`** = `NameOK and TypeOK and SystemDefaultOk and OkPartyGroup`:

| Rule | Condition | Message |
|---|---|---|
| Type (`VAL_PartyHelper_Type`) | `PartyType` not empty | "Cannnot be empty" *(sic)* |
| Name (`VAL_PartyHelper_Name`) | `Name` not empty | "Cannnot be empty" *(sic)* |
| System default (`VAL_PartyHelper_SystemDefault`) | see below | "Only one system default can exist per type" |
| Party group (`VAL_PartyHelper_PartyGroup`) | if `PartyHelper_PartyGroup` empty → pass; else must differ from `PartyHelper_Party` (can't group under self) | "Party cannot belong to same gorup as itself" *(sic)* |

`VAL_PartyHelper_SystemDefault` in detail:
```
if not TypeOK: return false                       # cascades TypeOK's failure
if not PartyHelper.SystemDefault: return true      # unchecked box, nothing to validate
Party_systemDefault = retrieve Party
    where PartyType = PartyHelper.PartyType and SystemDefault
    limit 1
return Party_systemDefault is empty
```
**Bug:** this query does not exclude the Party currently being edited (`PartyHelper_Party`) from the "does one already exist" check — it retrieves `$Party` via `PartyHelper_Party` but never filters against it. **Editing and re-saving an already-designated system-default Party (leaving the checkbox checked) will find itself as the pre-existing default and fail validation.** Not previously flagged in any sibling doc.

### 5.2 Initial balances (`SUB_SetInitialBalances`) — corrects an existing document claim

`user-stories.md` (US-008) and `go-over-all-stories-jiggly-axolotl.md` (A6) both state legacy has **no** opening-balance feature. That is incorrect at the mechanism level — it exists, but it is broken:

```
SUB_SetInitialBalances(Party, PartyHelper):
  RecordList = []
  if PartyHelper.CreditBalance not empty and != 0:
      NewExpense = create Record
      SUB_Record_SetFields(NewExpense, TransactionDate=now, Credit=Party, Debit=empty,
                            Description='Initial credit balance', Amount=PartyHelper.CreditBalance,
                            TransactionGroup=empty)
      add NewExpense to RecordList
  if PartyHelper.DebitBalance not empty and != 0:
      NewExpense_1 = create Record
      SUB_Record_SetFields(NewExpense_1, TransactionDate=now, Credit=empty, Debit=Party,
                            Description='Initial debit balance', Amount=PartyHelper.DebitBalance,
                            TransactionGroup=empty)
      add NewExpense_1 to RecordList
  return RecordList
```

Runs only `if isNew(Party)`, i.e. only at Party-creation time, when the (writable, per §2.2) `CreditBalance`/`DebitBalance` fields on the creation form are non-zero. **Both seed Records deliberately populate only one side of the double-entry** (`Debit = empty` or `Credit = empty`) and **have no `TransactionGroup`** at all — they are orphan Records that will never appear in any TransactionGroup-based history view (US-031, transaction list, transaction detail), yet they do feed straight into `ADE_ACO_Record_CalculatePartyBalance`'s sums since the entity's `on after commit` event fires regardless of grouping. **Do not mirror this mechanism as-is** — if the rebuild wants an opening-balance feature, it needs a real double-entry design (e.g. against a dedicated `opening_balance` system party), not single-sided orphan rows.

### 5.3 Deactivate

No dedicated microflow — `Active` is just one of the fields `SUB_Party_CopyData` copies from `PartyHelper` on any save. Deactivation and reactivation are both ordinary edits.

### 5.4 Type-change hazard (confirmed exact mechanism)

`go-over-all-stories-jiggly-axolotl.md` (Layer A, A7) already flagged this as a suspected hazard; this pass confirms the mechanism precisely: **nothing in `VAL_PartyHelper` or `SUB_Party_CopyData` checks whether the Party already has Records before allowing `PartyType` to change.** Any `Accountant` or `SuperAccountant` (both have WRITE on `Party.PartyType`, per §7) can silently re-type a Party with transaction history at any time, immediately changing how `VAL_RecordHelper_Bank`/`VAL_TransactionHelper_Partner`/`VAL_TransactionHelper_Supplier`/`VAL_TransactionHelper_Investment` treat every future transaction involving it, with zero effect on historical Records (which don't store type at time-of-transaction).

### 5.5 Delete (`ACT_Party_Delete`)

Plain hard delete by id, no ownership check in the microflow itself (relies on page/entity access rules). Enforced safety comes from the association layer, not application logic: `Credit`/`Debit` both have `delete_behavior DELETE_IF_NO_REFERENCES`, so the platform itself refuses to delete a Party that any Record still references — this is the actual mechanism behind "parties with linked Records cannot be hard-deleted," confirmed at the schema level rather than assumed.

### 5.6 `ACT_Party_Fix` — a data-repair utility, not a user story

Grant: `SuperAccountant` only. If `Party_TenantProject` is empty, resolves and sets it via `ROC_TenantProject` and shows "Fix implemented"; otherwise shows "Nothing to fix." Its mere existence indicates the legacy multi-tenancy wiring for `Party` could get out of sync in production. Not a feature to port — the rebuild's `profile_id NOT NULL` + accessor design (prd.md §19) makes this class of drift structurally impossible.

---

## 6. TransactionGroup edit / delete

### 6.1 Basic edit — `ACT_TransactionGroupHelper_Save_Edit`

```
if currentUser != TransactionGroup.Owner: return     # silent no-op, not a page-level block
if not VAL_TransactionGroupHelper(...): return
close page
SUB_TransactionGroup_CopyData_TransactionGroupHelper(...)   # copies Amount, Date, Description onto the TransactionGroup
RecordList = SUB_RecordList_Update(TransactionGroup)         # see below
commit TransactionGroup with events
commit RecordList with events
```

**`SUB_RecordList_Update`** pushes the group's (single) `Amount`/`Description`/`Date` onto **every** child Record of the group identically:
```
for each Record in TransactionGroup.Record_TransactionGroup:
    change Record (Amount = TransactionGroup.Amount, Description = TransactionGroup.Description, Date = TransactionGroup.Date)
```
For a 2-Record group (Micro-investment), both Records get overwritten to the same Amount — consistent with how they were created (both already shared one Amount), so no divergence is introduced. Committing with events re-fires `ADE_ACO_Record_CalculatePartyBalance` per Record, correctly reflecting a changed Amount for the (unchanged) parties.

**Validation (`VAL_TransactionGroupHelper`)** = `AmountOK and DateOK and DescriptionOK`:

| Rule | Condition | Message |
|---|---|---|
| Amount | not empty | "Cannot be empty" |
| Date | not empty and `<= CurrentDateTime` (no future-allowed exception here at all) | "Cannot be empty" / "Cannot be in the future" |
| Description | not empty (`ProcessaCommons.IsNotEmptyString` — a *different* string-empty helper than the `AdministrationCenter.StringNotEmpty` used everywhere else, cosmetic inconsistency only) | "Cannot be empty" |

**Authorization, precisely:** granted to both `Accountant` and `SuperAccountant`; the only actual gate is `currentUser == TransactionGroup.Owner`. **This means, contrary to how `user-stories.md` US-032 frames it ("As a super accountant, I want to edit..."), any `Accountant` can perform this basic edit on a TransactionGroup they personally created — it is not a SuperAccountant-exclusive capability in legacy.** Only the *advanced* edit below is SuperAccountant-only.

### 6.2 Advanced edit (Credit/Debit rewiring) — `ACT_TransactionGroup_SaveAdvanceEdit_Records`

Grant: **`SuperAccountant` only.**

```
RecordEditHelperList = retrieve TransactionGroup.RecordEditHelper_TransactionGroup
if not VAL_RecordEditHelperList(RecordEditHelperList): return
close page
for each RecordEditHelper in RecordEditHelperList:
    Record = RecordEditHelper.RecordEditHelper_Record
    change Record (Debit = RecordEditHelper.RecordEditHelper_Debit, Credit = RecordEditHelper.RecordEditHelper_Credit)
    add Record to RecordList
delete RecordEditHelperList
commit RecordList with events, refresh
```

**Validation (`VAL_RecordEditHelperList`)**, per item in the list, `AllOK = OkCredit and OkDebit and OKDifferentParties` across all items:

| Rule | Condition | Message |
|---|---|---|
| Credit not empty | `RecordEditHelper_Credit` set | "Cannot be empty" |
| Debit not empty | `RecordEditHelper_Debit` set | "Cannot be empty" |
| Different parties | (only checked if both above pass) `Debit != Credit` | "Parties have to be different" (shown on both fields) |

**This is exactly the operation `setup-config.md` §1.2 forbids in the rebuild** ("Changing the credit/debit party wiring is not supported — that requires deleting and re-entering the transaction"). §4's finding sharpens why: this legacy operation has a real balance-staleness bug on the *old* counterparty. **Do not mirror §6.2 at all — the rebuild's delete+re-enter policy is the correct fix, not merely a simplification.**

### 6.3 Delete — two entry points with different authorization

| Microflow | Ownership check? | Grant |
|---|---|---|
| `ACT_TransactionGroup_Delete` | **No** — relies entirely on entity/page access rules | `Accountant`, `SuperAccountant` |
| `ACT_TransactionGroup_DeleteByOwner` | **Yes** — `currentUser == TransactionGroupFromDB.Owner`, silent no-op otherwise | `Accountant`, `SuperAccountant` |

Both do a plain hard delete by id after re-fetching from the database. Deletion cascades (`Record_TransactionGroup` is `DELETE_CASCADE`) to every child `Record`, each of which fires its own `on after delete` balance recalculation individually (§4) — this is correct, unlike the advanced-edit rewiring case, because deletion's phantom object still carries the correct pre-delete `Debit`/`Credit`.

---

## 7. Security matrix

### 7.1 Module roles (Accounting)

| Role | Description in model (verbatim, typos preserved) |
|---|---|
| `Accountant` | "User who can add expenses and do soma more low level stuff" *(sic — "soma")* |
| `SuperAccountant` | "User who can make edits on architectural level" |
| `BasicUser` | "User who can only add expenses pretty much anonymously" — **this description is misleading**: BasicUser has no WRITE grant on `Record` or `Party` anywhere (confirmed below); it cannot actually add anything. |
| `Admnistrator` *(sic)* | "Can edit and users and do other andministrative work" *(sic — "andministrative")* |
| `AccountantManager` | *(no description)* — vestigial, see §7.3. |

### 7.2 Entity access (R/W), by role

| Entity | Accountant | BasicUser | SuperAccountant | Admnistrator |
|---|---|---|---|---|
| `Party` | RW (name/description/type/balances, tenant-scoped) | R only (tenant-scoped) | RW (broader field set incl. Active/SystemDefault, tenant-scoped) | R only, **no tenant WHERE clause** (global read) |
| `Record` | **R only** | **R only** | **R only** | *(no grant listed)* |
| `TransactionGroup` | R only | R only | R only | *(no grant listed)* |
| `TransactionHelper` and all subtypes (`ExpenseHelper`, `IncomeHelper`, `ReceivedInvoiceHelper`, `IssuedInvoiceHelper`, `MicroinvestmentHelper`, `DepositHelper`) | RW | *(no grant)* | RW | *(no grant)* |
| `PartyHelper` | *(no grant)* | *(no grant)* | RW | *(no grant)* |
| `RecordEditHelper` | *(no grant)* | *(no grant)* | RW | *(no grant)* |
| `TransacitonGroupHelper` | RW | RW | RW | *(no grant)* |
| `DocumentFile` / `DocumentImage` | RW (tenant-scoped) | RW (own-owner-scoped) | RW (tenant-scoped) | *(no grant)* |
| `M_Records_Owned_DataGrid` | CRW | CRW | CRW | *(no grant)* |
| `RecordExportToken` | *(no grant)* | *(no grant)* | RW | *(no grant)* |

**Confirms NFR-006 exactly:** no role — including `SuperAccountant` — has a WRITE grant on `Record` anywhere in the module. All Record creation/mutation happens exclusively inside microflows running with elevated (system) rights, never through direct end-user entity access.

**Party WRITE is broader than NFR docs imply:** both `Accountant` and `SuperAccountant` (not just SuperAccountant) can write `PartyType`, `CreditBalance`, and `DebitBalance` directly on `Party` — relevant to §5.4 (type-change hazard) and §8 (manual balance edits).

### 7.3 Microflow access — the vestigial `AccountantManager` role, exact scope

Confirmed by `SHOW SECURITY MATRIX`: `AccountantManager` has execute grants on exactly **three** microflows module-wide:
- `ACT_Record_Save_Expense`
- `ACT_Record_Save_Withdrawal`
- `DS_Party_PartyGroupSelection`

No page grants at all for this role anywhere in the module (confirmed — it does not appear in the Page Access section of the security matrix), meaning there is no UI path that could invoke those three microflows under this role. `SHOW USER ROLES` shows `AccountantManager` composed of 6 module roles cross-module (i.e. it also picks up grants from `Administration_MultiTenant` etc.) — but within `Accounting` specifically it is unreachable. Matches and confirms `go-over-all-stories-jiggly-axolotl.md`'s prior finding exactly; no new information here beyond precise confirmation.

### 7.4 Demo users

| User | Role |
|---|---|
| `demo_administrator` | `Administrator` |
| `demo_user` | `Accountant` |
| `Accountant_Demo` | `SuperAccountant` |

No demo user is assigned `BasicUser` or `AccountantManager`.

---

## 8. Known legacy quirks — do not mirror (with reasons)

Items already flagged in sibling docs are marked *(known)*; everything else is new to this pass.

| # | Quirk | Why it exists / mechanism | Why not to mirror |
|---|---|---|---|
| 1 | *(known)* `AccountantManager` role is vestigial (§7.3) | 3 microflow grants, 0 page grants | Unreachable through any UI; `setup-config.md` already merges it into `accountant`. |
| 2 | *(known)* `ENUM_TransactionType.complete` is unused | Not produced by any of the 7 save flows | Likely an internal wizard end-marker never wired up; drop it. |
| 3 | *(known, now tool-confirmed)* `TransactionHelper_CashRegister` association is dead | Populated on the Expense form via `ROC_Party_GetRegister`, zero callers read it | `cash-custodian.md`'s planned `_Bank`-slot-accepts-CashRegister-type design is unaffected — this slot was never load-bearing. |
| 4 | `DepositHelper` entity is entirely dead | Zero callers anywhere; Deposit actually uses `IncomeHelper` (§1) | Don't design around an entity that was never wired into any flow. |
| 5 | No `WithdrawalHelper` entity exists | Withdrawal reuses `ExpenseHelper` (§1) | The rebuild's discriminated-union approach (§13) doesn't need a matching split anyway. |
| 6 | `VAL_TransactionHelper_PaymentType` has zero callers module-wide | `PaymentType` is never validated as required anywhere | An Expense/Income submitted with `PaymentType` unset silently falls into the `Indirect`/Partner branch (the `if PaymentType = DirectTransfer` check is false when empty) rather than erroring. The rebuild's Zod discriminated union should make payment method a required field for the variants that branch on it. |
| 7 | `VAL_MicroinvestmentHelper_Debit` has zero callers | Never wired into `VAL_MicroinvestmentHelper`'s return expression | Micro-investment's Investment-side party type is never actually checked to be `Investment`-typed, unlike Received/Issued Invoice. Also note the microflow checks the wrong association (`TransactionHelper_Debit`) versus the one actually used in bucketing (`TransactionHelper_Investment`) — it was never correct even if wired in. |
| 8 | `VAL_TransactionHelper_Investment` only has 2 callers (`VAL_IssuedInvoiceHelper`, `VAL_ReceivedInvoiceHelper`) | Not called from Expense/Income/Micro-investment despite those exposing the same slot | Confirms #7; the type check only exists for 2 of the 3 flows that touch an Investment-typed party. |
| 9 | `ROC_Party_GetDefaultSupplier` has no tenant scoping on its retrieve | `retrieve Party where PartyType = Suppliers limit 1` — no `Party_TenantProject` filter (unlike the otherwise-identical `GetBank`/`GetExpenses`/`GetProfits`/`GetRegister`, which do filter) | **Cross-tenant data leak**: the "default supplier" preselected on Expense/Received-Invoice/Micro-investment forms can silently be a *different tenant's* Supplier party. This is precisely the class of bug prd.md §19's mandatory per-table cross-tenant integration test exists to catch — cite this as a concrete example when writing that test. |
| 10 | `VAL_PartyHelper_SystemDefault`'s uniqueness check doesn't exclude the Party being edited | Query has no `id != Party.id` filter | Re-saving an already-`SystemDefault` Party without change appears to spuriously fail with "Only one system default can exist per type." Rebuild's equivalent check must exclude the current row. |
| 11 | `Party_DefaultAccount` is only ever wired for `PartyType = Partner`, never `Worker` | `SUB_Party_CopyData`'s `if PartyType = Partner` guard | Legacy's Worker↔user linkage is non-functional even though the enum value and the association exist; don't assume legacy "supports" worker account-linking just because the schema allows it. |
| 12 | Opening-balance mechanism (`SUB_SetInitialBalances`) produces single-sided, ungrouped orphan Records | Only one of Credit/Debit is set per seed Record, and `TransactionGroup = empty` | Breaks double-entry and is invisible to any TransactionGroup-based view. **Corrects `user-stories.md` US-008 / A6, which state legacy has no opening-balance feature at all** — it does, but it's broken; if the rebuild wants this feature it needs a real design, not a port. |
| 13 | Advanced-edit rewiring (§6.2) leaves the *old* counterparty's balance stale | `ADE_ACO_Record_CalculatePartyBalance` only recalculates the Record's *current* Debit/Credit parties at commit time | Directly justifies `setup-config.md` §1.2's forbid-in-place-rewiring rule with a concrete bug, not just a simplicity preference. |
| 14 | Basic TransactionGroup edit is not SuperAccountant-exclusive | Granted to `Accountant` + `SuperAccountant`, gated only by `currentUser == Owner` | `user-stories.md` US-032 frames this as super-accountant-only; legacy actually lets any accountant edit their own transactions' date/amount/description. Decide deliberately whether the rebuild's `owner`-only "edit/delete transactions" row in `setup-config.md` §1.2 is intentionally *stricter* than legacy here (it is) rather than assuming it's a like-for-like port. |
| 15 | Two TransactionGroup-delete entry points with different authorization | `ACT_TransactionGroup_Delete` (no ownership check) vs `ACT_TransactionGroup_DeleteByOwner` (ownership-checked) | Not previously distinguished in any sibling doc; if reconstructing legacy behavior exactly mattered, note that a plain "delete" path without the ownership check exists (though page-level access likely restricts which users reach it — not traced here). |
| 16 | `DS_Party_Selection_ReceivedInvoiceSupplier` is buggy | Retrieves the entire unfiltered tenant party list twice (into `$Party_default` without `limit 1`, and into `$PartyList_grouped`), ignores the retrieved `$Party_group` entirely | Copy-paste-looking bug unique to this one picker; the analogous Expense/Income/Issued-Invoice pickers are internally consistent (prepend one default + append a filtered list). Don't use this one as your template. |
| 17 | `DS_ExpenseHelper_Debit` is dead and mistyped | `@excluded`; parameter typed `Accounting.MicroinvestmentHelper` despite the name; calls a microflow name (`SUB_TenantProject_ROC`) that doesn't match any microflow found in this module (`ROC_TenantProject` is the real one) | Broken, disabled, never wired into any active flow — ignore entirely. |
| 18 | Several `TransactionHelper` fields are set on subtype creation but functionally inert for that subtype | `TransactionHelper_CashRegister` (Expense, #3 above), `PaymentType` (Deposit — set nowhere, read nowhere), `InvoiceType` (Issued Invoice — defaulted to `Investment` on open, never read by save/validation) | Symptomatic of all seven forms sharing one base entity; don't assume "the field is prefilled" implies "the field matters" for a given transaction type — check the specific save microflow. |
| 19 | Party `CreditBalance`/`DebitBalance` are directly WRITE-granted on the real `Party` entity to `Accountant` and `SuperAccountant` | Entity access rule grants write on these fields alongside the automatic recalculation event | A manual edit between Record-triggered recalculations could leave the field inconsistent with its true derived value until the next Record commit/delete touches that party. prd.md's "balances are never entered or edited manually" is a genuine correctness improvement, not a stylistic one — make sure the rebuild has no analogous writable path. |
| 20 | Received/Issued Invoice validators compute-then-discard a Bank/Partner check | `$BankOK`/`$InvestorOK` computed via real sub-microflow calls, marked `@excluded`, omitted from the final boolean `return` expression | Harmless (extra DB round-trips only) but worth knowing these aren't real gates if reading the legacy validators as a reference. |
| 21 | System-default parties (`Bank`/`Suppliers`/`Expenses`/`Profits`/`CashRegister`) are lazily auto-provisioned | `ROC_Party_Get*` creates the party on first use inside a transaction form if none exists yet for the tenant, rather than at tenant/profile setup | Differs from `setup-config.md` §3.2's plan to eagerly seed these at profile creation — a deliberate, reasonable divergence, just noting it's a divergence rather than a like-for-like carry-over. |
| 22 | `Record.IsCustom` is never set by any traced microflow | Present on the entity, default `false`, not touched by `SUB_Record_SetFields` or the initial-balance seeder | Purpose undetermined from this module's Accounting-folder microflows; don't assume a meaning for it without checking the export module (`ACT_ExportRecords_*`, out of this task's scope) if it resurfaces. |
| 23 | `TenantProject` has zero role grants of its own | `AccessRules: 0` on the entity | Purely a backend join-anchor, resolved only via `ROC_TenantProject` inside other microflows; never exposed on a page. Not a UI concept to preserve. |

---

## 9. Not covered by this pass (explicitly out of scope)

- Full widget-level page layout (`DESCRIBE PAGE ...`) for any of the New/Edit forms — this document traces data and logic, not pixel layout. Page names are given so an implementer can look them up if needed.
- The Excel/CSV export flow (`ACT_ExportRecords_Step1/Step2`, `RecordExportToken`) — Epic 11, explicitly deferred to v2 per prd.md §6, so not traced in depth here.
- `Record.IsCustom`'s actual producer, if one exists outside the microflows traced above.
