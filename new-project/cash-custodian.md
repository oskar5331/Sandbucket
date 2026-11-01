# Cash Custodianship — Per-Party Cash Counters

## Context

In the existing Bapp-main app, when an accountant records a `Withdrawal` ("I took €500 cash out of the bank to give to John"), the bucketing is:

```
Credit: Bank      (asset goes down)
Debit:  Partner   (Partner's debit balance goes up — John "owes" the system that cash)
```

When that same partner later spends the cash on a supplier (`Expense` via partner intermediary), the bucketing is:

```
Credit: Partner   (Partner's credit balance goes up — clears the debit)
Debit:  Supplier
```

The Partner's running balance (`DebitBalance − CreditBalance`) thus **implicitly** acts as their personal cash counter: positive means they're holding company cash; zero means settled.

**Problem:** this overloads a single number with two unrelated meanings:
1. Cash this person is currently holding for the company.
2. Money the company genuinely owes the person (loans, capital contributions, unreimbursed expenses).

A Partner with `+€500` could mean either "they have €500 of company cash in their pocket" or "the company owes them €500 they personally fronted" — and there's no way to tell the two apart, which makes settlements and reporting unreliable.

This pattern is a real bookkeeping concept ("aruandekohustuslik isik" / accountable person in Estonian small-business accounting) and the new project should model it explicitly.

---

## Recommended Approach: Per-Custodian CashRegister Party with `Custodian` link

Make `CashRegister` a first-class Party type with an optional association to another Party (the custodian). One `CashRegister` Party per cash-holding context. Examples:

| Party (PartyType) | Custodian (→ Party) | Purpose |
|---|---|---|
| `Main bank account` (Bank) | — | Owned bank account |
| `Office petty cash` (CashRegister) | — | Unattended petty cash drawer |
| `Cash held by John` (CashRegister) | → `John` (Partner) | Money John is currently holding |
| `Cash held by Mari` (CashRegister) | → `Mari` (Worker) | Money Mari is currently holding |

The Partner / Worker Party itself is never debited or credited for cash custody. Their balance reflects only true receivables / payables (loans, equity, reimbursements).

### Data model change

Add one association to the new project's domain model:

```
CashRegister_Custodian  (Party → Party, [0..1] → [0..1])
```

- Owner side: a CashRegister-typed Party.
- Target side: any Party (typically Partner or Worker, but the model doesn't enforce this — could be any custodian-eligible Party).
- A CashRegister with no custodian is an unattended cash drawer (petty cash, till, etc.).

### Bucketing changes

The transaction helper's existing `_Bank` slot remains the generic "money store" slot, accepting any Party with `PartyType ∈ {Bank, CashRegister}`. The dead `TransactionHelper_CashRegister` slot in the existing app stays dead — we don't need a separate slot, since the CashRegister Party plugs into `_Bank`.

**Revised Withdrawal bucketing:**

| Side | Party |
|---|---|
| **Credit** | `_Bank/Party` (the source — main Bank account) |
| **Debit** | `_Bank/Party` (the destination — a CashRegister Party, optionally with a custodian) |

The destination is just another money-store Party. The Partner/Worker is **not** part of the bucketing — they're identified via `CashRegister_Custodian` if reporting needs it.

> Schema note: a single transaction needs *two* `_Bank` slots (source + destination). Either rename to `_BankSource` / `_BankDestination`, or introduce a `Transfer` transaction type with its own helper. See open questions.

**Revised Expense bucketing (when paid from a custodian's cash):**

| Side | Party |
|---|---|
| **Credit** | The CashRegister Party (e.g. `Cash held by John`) |
| **Debit** | `_Supplier/Party` |

The Partner is not part of the bucketing — the custodianship link tells you whose cash drawer this came from.

**New transaction type — Settlement (custodian returns cash):**

| Side | Party |
|---|---|
| **Credit** | A custodian's CashRegister Party |
| **Debit** | `_Bank/Party` (back to the main bank) |

This is structurally identical to a Withdrawal in reverse. Could share the same helper and microflow with a "direction" flag.

### Effects on Party balances after this change

| Scenario | Old model | New model |
|---|---|---|
| John takes €500 cash from bank | Partner John debit +500 | `Cash held by John` debit +500; Partner John balance unchanged |
| John buys supplies for €300 with that cash | Partner John credit +300 | `Cash held by John` credit +300; Partner John balance unchanged |
| John returns €200 leftover | Partner John credit +200 | `Cash held by John` credit +200; Partner John balance unchanged |
| Company genuinely owes John €100 reimbursement | Partner John debit +100 (indistinguishable from cash held) | Partner John debit +100 (clear receivable, no cash mixed in) |

Net result: a custodian's balance is now exactly "what the company owes this person" with no cash-custody noise.

---

## UX implications

- **Withdrawal form** must let the user pick a destination CashRegister Party (existing or "create new"). For a one-off withdrawal to John, the user creates `Cash held by John` and links the custodian to John in the same step.
- **Expense form**, when "pay via cash" is selected, lets the user pick which CashRegister to draw from. If only one custodian's register is non-empty, default it.
- **Party list / dashboard** should group CashRegister parties by custodian (or "Unattended") so the user can see at a glance "John holds €200, Mari holds €0, Office cash drawer holds €150".
- **Settlement** is a new explicit action — "John returns leftover cash" — that posts a CashRegister → Bank record. Replaces today's implicit settlement via expense.

---

## Open questions (parking lot)

1. **Schema for "two banks per transaction"** — Withdrawal/Settlement need both source and destination money-store. Options: (a) rename `_Bank` to `_BankSource` and add `_BankDestination`; (b) introduce a dedicated `Transfer` transaction type with its own helper; (c) reuse existing `_Bank` and `_Partner` slots semantically (overload). Recommend (a) for clarity; defer until transaction-helper schema is being designed.
2. **Which Party types may be a custodian?** The data model allows any. Constrain at UI level (only Partner + Worker)? Or leave open in case Suppliers occasionally hold cash (unusual but possible)?
3. **Auto-create vs. manual** — should the Withdrawal form auto-create a `Cash held by <Person>` register the first time, or always require explicit creation? Auto-create is faster for the common case but makes the data model less visible to the user.
4. **Closing a custodian's register** — when a person leaves the company and their cash is fully settled, what happens to the CashRegister Party? Soft-delete (mark inactive, keep history) is the obvious answer.

---

## Related user stories

This design replaces the implicit cash-custody behaviour of the existing app and shapes several user stories:

- **US-013** — system-default parties: extend to seed an `Office petty cash` CashRegister at profile creation.
- **US-015** — Expense payment-method selection: "via partner" path becomes "via custodian's cash register".
- **US-027** — Withdrawal: destination is now a CashRegister Party, not a Partner.
- **US-035** — balance auto-recalc: no logic change, but the cleaner separation means balances are now meaningful per party.

Plus the new stories added under Epic 6 (US-027a, US-027b, US-027c, US-027d) — see `user-stories.md`.
