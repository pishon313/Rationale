# Trade-ledger Reset and Local Undo v1

Trade-ledger Reset provides a deliberately narrow reset under **Settings → Data management → Danger zone**. It removes every currently active Trade from ledger calculations while preserving the rest of the investment journal.

## Scope

The reset covers buys, sells, dividends, deposits, withdrawals, balance reconciliations, both sides of account transfers, opening positions, imported records, manual records, sample records, and system-derived records.

It does not delete or rewrite Stocks, Accounts, Buy Plans, Observations, Reviews, Notes, Rules, dashboard notes, earnings events, credentials, preferences, or import-mapping profiles. Stock prices, thesis, classification, tags, Account metadata, Plan state, and Review references remain unchanged. Holdings, average cost, cash balances, realized P&L, and position cycles become zero or empty only because they are derived from the active Trade ledger.

## Bulk soft delete

Reset is not a physical purge. The complete canonical Trade collection is retained. Every active Trade receives the same reset timestamp in `deletedAt` and `updatedAt`; IDs, creation time, economic fields, Account and Stock references, import provenance, fee provenance, and journal annotations remain available. Tombstones that existed before the reset remain unchanged.

This is not secure erasure or a privacy-deletion feature. Tombstones are retained for synchronization and recovery.

## Legacy holding preflight

The reset first runs the production `migrateTrades()` path. A legacy Stock with a safe generated opening position has that opening Trade included in the reset and persisted as a tombstone. The Stock is marked with `ledgerInitializedAt`, and only its legacy `quantity` and `averagePrice` caches are zeroed.

If any legacy Stock cannot be reconciled with its existing ledger, reset fails closed before persistence. No Trade, Stock, or undo snapshot changes.

## Device-local one-level undo

The collection `trade-ledger-reset-snapshots` contains at most one strict version-1 record with ID `latest`. It stores only the shared reset timestamp and the unique IDs changed by that reset. Full Trade payloads are not duplicated.

Undo is available only on the Mac that performed the most recent reset. Every affected Trade must still be the exact tombstone created by that reset: it must exist, remain deleted, and have both `deletedAt` and `updatedAt` equal to the snapshot timestamp. A missing, restored, edited, or re-deleted record makes the entire undo stale. Undo never partially restores.

A valid undo clears `deletedAt`, assigns one new `updatedAt`, preserves unrelated tombstones and post-reset Trades, validates transfer pairs and the combined production ledger, and clears the snapshot in the same commit. The interaction policy permits errors already explainable in either the restored set or the post-reset active set, but rejects newly introduced combined-ledger errors. Transfer validation is intentionally stricter and fails closed for any invalid combined pair.

## Atomic persistence

Reset commits these writes once through `saveCollectionsAtomically()`:

- complete Trade tombstones;
- the complete Stock collection only when legacy initialization changed it;
- the single local reset snapshot.

Undo commits the restored Trade collection and empty snapshot collection through the same boundary. Browser localStorage rolls back earlier collection writes if a later write fails. The Tauri command performs collection, Sync outbox, and state updates in one SQLite transaction. Mounted stores update only after persistence succeeds.

## Sync, Backup, and Import

Sync remains version 1. An ordinary Trade tombstone with a newer `updatedAt` wins over an older active record. Undo produces the same Trade ID with an even newer `updatedAt` and `deletedAt: null`. Sample IDs remain device-local, and the reset snapshot is never a Sync entity.

The current Backup format remains version 6 on this branch. Trade tombstones stay in the ordinary Trade array, while `trade-ledger-reset-snapshots` is excluded from manual Backup, encrypted Backup payloads, restore writes, and automatic-backup source counts. A pre-reset Backup can still restore active Trades; the device-local one-level undo does not travel with a Backup or another Mac.

Imported tombstones retain their source keys and journal fields. Reimporting the same source identifies a `previously_deleted` restoration candidate instead of inserting a duplicate. Explicit restoration reuses the same Trade ID and the established Import Pipeline preflight.

## Non-goals

Version 1 does not provide physical purge, secure erasure, a full-app factory reset, deletion by Account or date range, automatic Plan changes, Review unlinking, new Sync or Backup schemas, new import identity rules, CloudKit changes, broker API changes, or a Settings redesign.
