# User Stories — Sandbucket Accounting App

> **Scope:** This document is a **legacy snapshot** of the existing Mendix `Accounting` module. It is descriptive, not prescriptive. For the Next.js rebuild requirements, see [`prd.md`](./prd.md) and [`setup-config.md`](./setup-config.md). For the mechanics-level trace behind these stories (exact fields, validation conditions, credit/debit bucketing, sourced directly from the microflows), see [`business-logic-spec.md`](./business-logic-spec.md). Stories may describe behaviour that the rebuild intentionally drops, changes, or defers.

Derived from analysis of the existing Accounting module. Stories are grouped by epic and ordered from foundational to advanced.

---

## Epic 1: Authentication & Multi-Tenancy

**US-001** — As an **administrator**, I want to create user accounts on behalf of new users (no public self-service signup) so that access to a tenant is controlled. *(Legacy uses `Administration_MultiTenant.Account_New_Manager` per-tenant; there is no public registration page.)*

**US-002** — As a **user**, I want to log in with my email and password, and to change my password from a profile form, so that my data is private and secure. *(Legacy form: `Administration_MultiTenant.ChangeMyPasswordForm`. Email-based password reset is not implemented in legacy.)*

**US-003** — As a **user**, I want my data to be completely isolated from other tenants so that no other organisation can see my records.

**US-004** — As an **administrator**, I want to create and manage user accounts within my tenant so that I can control who has access.

**US-005** — As an **administrator**, I want to assign roles to users — `BasicUser`, `Accountant`, `SuperAccountant`, `Admnistrator` (sic — the role name is misspelled in the legacy module) — so that access is appropriately restricted by responsibility. *(Legacy also defines an `AccountantManager` role but it is vestigial — unreachable through the UI and unused — and is not surfaced as a real role here.)*

---

## Epic 2: Party Management

**US-006** — As an **accountant**, I want to create a new party with a name, type, and description so that I can reference it in transactions. *(Legacy attribute is misspelled `Descritpion` on `Accounting.Party` — preserved here as a known typo to be renamed during any rebuild.)*

**US-007** — As an **accountant**, I want to choose a party type from a predefined list — `Bank, Investment, Suppliers` (plural in legacy enum), `Warehouse, Partner, Utility, Worker, Profits, Expenses, Tenant, CashRegister` — so that parties are consistently categorised. *(`Profits` and `Expenses` are system-managed types: the app expects exactly one of each per tenant and routes ledger entries to them automatically; users do not create additional `Profits`/`Expenses` parties.)*

**US-008** — As an **accountant**, I want to view a party's current credit and debit balances so that I always know its position. *(`CreditBalance`/`DebitBalance` are recalculated from the full record set on every commit/delete via `ADE_ACO_Record_CalculatePartyBalance`. **Correction (2026-09-28):** this doc previously claimed legacy has no opening-balance feature at all — that's wrong. `SUB_SetInitialBalances` is a real mechanism, run at party creation from the (writable) `CreditBalance`/`DebitBalance` fields on the create form, but it's broken: it writes single-sided orphan Records with no `TransactionGroup`, invisible to any transaction-history view. See `business-logic-spec.md` §5.2 for the exact mechanism, and `prd.md` §25 for the rebuild's fixed version.)*

**US-009** — As an **accountant**, I want to view a list of all parties with their current credit and debit balances so that I can get a quick financial overview.

**US-010** — As an **accountant**, I want to edit an existing party's name and description so that I can correct or update party details. *(Caveat: legacy permits editing `PartyType` after records exist, which silently re-routes ledger semantics. Treat type changes on a party with history as out of scope.)*

**US-011** — As a **super accountant**, I want to deactivate or delete a party so that retired parties no longer appear in selection lists. *(Legacy supports both `Active=false` and entity DELETE.)*

**US-012** — As a **super accountant**, I want to group parties under a parent party so that I can organise parties hierarchically. *(Backed by `Party.UseAsGroup` flag and the `BelongsToGroup` self-association.)*

**US-013** — As a **super accountant**, I want to designate system-default parties (e.g. main bank account, profits account, expenses account, office petty cash register) so that the app can automatically route transactions to the correct accounts. *(See `cash-custodian.md` for the seeded petty-cash register.)*

**US-013a** — As an **administrator**, I want to link a party to a specific user account so that party-scoped behaviours (e.g. "the partner whose payments you can see") are tied to the right person. *(Backed by the `Party_DefaultAccount` association from `Accounting.Party` to `Administration_MultiTenant.Account`.)*

---

## Epic 3: Expense Entry

**US-014** — As an **accountant**, I want to record a paid expense by entering an amount, date, description, and supplier so that outgoing payments are tracked.

**US-015** — As an **accountant**, I want to choose the payment source when recording an expense (direct bank transfer, the office petty-cash register, or a specific custodian's cash register) so that the correct source account is credited. *(Cash-from-custodian flow is specified in `cash-custodian.md`.)*

**US-016** — As an **accountant**, I want to attach a receipt file or photo to an expense so that I have documentary evidence linked to the transaction.

**US-017** — As an **accountant**, I want the system to validate all required fields before saving an expense so that incomplete records are never committed.

---

## Epic 4: Income Entry

**US-018** — As an **accountant**, I want to record received income by entering an amount, date, description, and source party so that incoming payments are tracked.

**US-019** — As an **accountant**, I want to choose whether income arrived via direct bank transfer or through an intermediary so that the destination account is credited correctly.

**US-020** — As an **accountant**, I want to attach a document to an income entry so that proof of payment is stored alongside the record.

---

## Epic 5: Invoice Management

**US-021** — As an **accountant**, I want to record a received invoice (from a supplier) by entering amount, invoice date, supplier, and invoice type (cost or investment) so that liabilities are tracked accurately.

**US-022** — As an **accountant**, I want to classify a received invoice as either a **cost** (routed to expenses) or an **investment** (routed to an investment party) so that the chart of accounts remains accurate. *(Backed by `ENUM_RecieivedInvoiceType` — enum name itself is misspelled `Recieived` in legacy.)*

**US-023** — As an **accountant**, I want to record an issued invoice (sent to a customer) by entering amount, invoice date, and the customer party so that outstanding receivables are tracked.

**US-024** — As an **accountant**, I want issued invoices to automatically credit the Profits account so that revenue is recognised without manual journal entries.

**US-025** — As an **accountant**, I want to attach a PDF or image of the invoice to each invoice record so that I can retrieve source documents later.

---

## Epic 6: Bank Movements (Deposit & Withdrawal)

**US-026** — As an **accountant**, I want to record a deposit (cash/transfer into the bank) by specifying the source party and bank account so that incoming bank movements are logged.

**US-027** — As an **accountant**, I want to record a withdrawal of cash from the bank into a specific cash register (the office petty cash drawer or a custodian's cash register) so that the cash is tracked in the right counter rather than mixed into the recipient's general balance. *(Bucketing specified in `cash-custodian.md`.)*

**US-027a** — As an **accountant**, when withdrawing cash to a person who has no cash register yet, I want to create a new "Cash held by *Name*" register and link the custodian in the same step so that I don't need to set it up beforehand.

**US-027b** — As an **accountant**, I want to record a settlement (a custodian returning unspent cash to the bank) so that the custodian's cash register can be reduced or zeroed out without confusing the entry with an income or deposit.

**US-027c** — As an **accountant**, I want to view how much cash each custodian is currently holding (and how much is in the unattended petty-cash register) so that I can see at a glance where the company's cash is distributed.

**US-027d** — As a **super accountant**, I want to deactivate a custodian's cash register once it is fully settled (e.g. the person has left the company) while preserving the historical records so that retired registers stop appearing in selection lists without losing audit history.

---

## Epic 7: Micro-Investment

**US-028** — As an **accountant**, I want to record a micro-investment transaction in a single step where I pick three parties — the **supplier** being paid, the **investment account** the funding posts to, and the **investor (partner)** providing the funds — so that both sides of the funding event are captured atomically. *(Backed by `MicroinvestmentHelper` extending `TransactionHelper`, with `_Supplier`, `_Investment`, and `_Partner` associations.)*

---

## Epic 8: Transaction Overview & History

**US-029** — As an **accountant**, I want to view a paginated list of all transaction groups ordered by date so that I can browse the full transaction history.

**US-030** — As an **accountant**, I want to search and filter transactions by date range, description, or party so that I can find specific records quickly.

**US-031** — As an **accountant**, I want to click into a transaction group to see all its individual double-entry records (credit party, debit party, amount, date) so that I understand the full accounting detail.

**US-032** — As a **super accountant**, I want to edit the description, date, and amount of an existing transaction group so that data entry errors can be corrected. *(**Correction (2026-09-28):** verified against `ACT_TransactionGroupHelper_Save_Edit` — this basic edit is actually granted to **both** `Accountant` and `SuperAccountant`; the only real gate is `currentUser == TransactionGroup.Owner`. It is the separate *advanced* edit — rewiring a Record's credit/debit parties, US-034 — that is SuperAccountant-exclusive. See `business-logic-spec.md` §6.1.)*

**US-033** — As a **super accountant**, I want to delete a transaction group and all its records so that erroneous entries can be fully removed.

**US-034** — As a **super accountant**, I want to add or modify individual records within a transaction group (credit/debit parties, amount) so that complex corrections can be made at the line level.

---

## Epic 9: Balance Tracking

**US-035** — As an **accountant**, I want every party's credit and debit balance to update automatically whenever a record is saved or deleted so that balances are always accurate without manual recalculation.

**US-036** — As an **accountant**, I want to view a party's full transaction history (all records where it appears as credit or debit) so that I can audit its activity.

**US-037** — As an **accountant**, I want to see a summary of total debits and total credits for a selected party so that I can quickly assess its net position.

---

## Epic 10: Document Attachments

**US-038** — As an **accountant**, I want to upload a non-image file (e.g. PDF) as a document attachment to a transaction so that source documents are stored in the system. *(Backed by `DocumentFile` extending `System.FileDocument`.)*

**US-039** — As a **mobile user**, I want to take a photo with my camera and attach it directly to a transaction so that I can capture receipts on the go without a separate upload step. *(Backed by `DocumentImage` extending `System.Image`. Legacy keeps file and image attachments as separate entities/pages.)*

**US-040** — As an **accountant**, I want to view the attached document from the transaction detail screen so that I can verify the source document without leaving the app.

---

## Epic 11: Export

**US-041** — As a **super accountant**, I want to initiate a record export by selecting a date range and one or more parties so that I can produce a filtered report.

**US-042** — As a **super accountant**, I want to choose an export template and Excel function separator so that the output is compatible with the accounting tool used by my organisation.

**US-043** — As a **super accountant**, I want to download the export as an Excel file so that I can share or archive the data outside the app.

---

## Epic 12: Mobile Experience

**US-044** — As a **mobile user**, I want a simplified, touch-friendly form for entering each transaction type so that I can record transactions from my phone in the field.

**US-045** — As a **mobile user**, I want a multi-step wizard for transaction entry (one input per screen) so that data entry on a small screen is clear and error-free.

**US-046** — As a **mobile user**, I want to type a free-text amount and have the app parse it automatically so that I don't have to worry about decimal separators.

---

## Epic 13: Roles & Permissions Summary

| Role | Capabilities |
|---|---|
| **BasicUser** | Read-only on own `Party` and `Record` rows (no WRITE grants). Cannot create transactions. |
| **Accountant** | Add all transaction types (expense, income, received/issued invoice, deposit/withdrawal, micro-investment), manage parties, view history. |
| **SuperAccountant** | Full access: edit/delete transaction groups, edit individual records, export, manage system-default parties. |
| **Administrator** | Misspelled `Admnistrator` in the legacy module. User and role management; global read-only on all parties (no tenant WHERE clause). |

---

## Non-Functional Requirements (derived from existing implementation)

**NFR-001** — All financial records must follow double-entry bookkeeping: every transaction must have at least one Credit party and one Debit party.

**NFR-002** — Party balances must be recalculated from the full record set on every save or delete — no manual balance adjustments.

**NFR-003** — All data must be scoped to a tenant project; cross-tenant data access must be impossible.

**NFR-004** — All transaction entry forms must validate fully before any data is persisted.

**NFR-005** — The app must support both desktop and mobile form factors with separate optimised UIs.

**NFR-006** — `Accounting.Record` rows are produced exclusively by microflows (`ACT_Record_Save_*`). No user role has a WRITE grant on `Record`; users never create, modify, or delete records directly. All edits at the line level (US-031, US-034) go through dedicated record-edit microflows.
