# Backlog

## Supplier sub-categorization

When we consolidated `Warehouse` and `Utility` into the `Supplier` PartyType, we lost the ability to break down supplier reporting by category. Decide later whether to reintroduce this distinction.

**Options:**

1. **Secondary attribute on Party** — add `SupplierCategory: Enumeration(ENUM_SupplierCategory)` with values `Warehouse`, `Utility`, `Service`, `Other`. Only meaningful when `PartyType = Supplier`. Pros: keeps reporting flexibility, allows a supplier to be reclassified without changing PartyType. Cons: nullable for non-suppliers; UI must conditionally show the field.
2. **Tag/label entity** — a separate `PartyTag` entity with many-to-many to Party. Pros: a supplier can have multiple tags (e.g. both Warehouse and Utility); user-extensible. Cons: more moving parts; harder to filter in reports.
3. **Do nothing** — accept that suppliers are flat. Reintroduce categorization only if a concrete reporting requirement appears.

**Decision driver:** wait until someone asks for a "spend by supplier category" report. If that never comes up, option 3 is fine.

**Related dropped enum values:** `Warehouse`, `Utility` (from `Accounting.ENUM_PartyType`).

---

## Deleted-record preservation

PRD §8 establishes that `transaction_group` and `record` are **hard-deleted** with `ON DELETE CASCADE`, on the grounds that soft-deleted Records would force an `IS NULL` filter into every balance recalculation and every double-entry sum check (one missed filter silently breaks the books). For MVP this is the right call.

**Open question for v2+:** how to preserve a deleted-transaction history without polluting the live tables. Drivers: forensic / audit needs (who deleted what, when, why), accidental-delete recovery, and tax-compliance retention rules in some jurisdictions.

**Options to evaluate when this comes up:**

1. **Archive table** — `transaction_group_archive` and `record_archive` with the same schema plus `archived_at`, `archived_by_user_id`. Server Action's delete path copies the row to the archive before issuing the cascade. Pros: queryable with normal SQL; easy to restore. Cons: schema drift between live and archive tables.
2. **JSONB tombstone** — single `deleted_record_archive` table with `(id, profile_id, deleted_at, deleted_by_user_id, payload jsonb)`. Server Action serialises the TransactionGroup + its Records into one JSONB blob before delete. Pros: no schema drift; one table for any future archived entity. Cons: querying needs `jsonb_path_query` etc.; restoration is custom code.
3. **WAL-based / logical replication to a cold store** — out of scope for app-level concern, but worth knowing about if a regulator ever demands tamper-evident retention.

**Decision driver:** wait until either (a) a real user asks for "show me my deleted transactions", or (b) a tax-compliance requirement forces our hand. Until then, hard-delete is fine.

**Related PRD decisions:** §4 (no business logic in DB), §4a (trigger carve-out — would *not* cover the archive copy; it's cross-table and belongs in the Server Action), §7 (audit fields supply `created_by_user_id`; archive needs `deleted_by_user_id` analogously), §8 (the hard-delete decision this is the safety net for).
