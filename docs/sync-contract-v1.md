# Rationale Sync Contract v1

This contract is shared by Rationale macOS and the future iOS client. Local databases remain each device's source of truth. CloudKit Private Database is a synchronization transport, never a remote snapshot database.

## Cloud model

- Zone: `RationaleDataV1`
- Record type: `RationaleItemV1`
- Record name: `v1|<entityType>|<logicalId>`
- Entity types: `accounts`, `stocks`, `trades`
- Payload: UTF-8 JSON
- Schema version: `1`

Every record represents `SyncEnvelopeV1 { recordName, entityType, logicalId, schemaVersion, updatedAt, deletedAt, payload }`. CloudKit system fields and change tags are device-local sync metadata and never enter domain entities or Backup V6.

## Projections

Account syncs user-owned metadata, including the optional `feePolicy` v1 value, but excludes `isDefault`, which is a device preference. Missing `feePolicy` remains valid for older Sync V1 records, `null` means no configured policy, and a valid value round-trips without changing the Sync schema version. Unknown future versions and malformed rules fail closed through the same Account validator used by local storage and Backup V6. A newly imported Account defaults `isDefault` to false; device normalization may choose a default when none exists.

Stock syncs identity, classification, thesis, review dates, ledger initialization, tags, and lifecycle timestamps. The optional `marketSector` stable ID is additive; legacy Sync V1 payloads may omit it, while the user-authored My category continues through the existing `sector` field. It excludes authoritative `quantity` and `averagePrice`, all quote-cache fields, and the legacy device-local opening account label. Holdings are projected from merged Trades by the production ledger.

Trade syncs the complete normalized economic record without rounding, including fractional quantities, transfers, opening positions, `journalStatus`, `origin` provenance, rule snapshots, optional `feeMode`/`feeCalculation`, and `deletedAt`. Trade is the economic source of truth. Import source keys, provider/external execution metadata, and fee provenance therefore survive multi-device whole-record LWW merges. Older Sync V1 Trades may omit fee metadata; all four current modes and valid Account-policy snapshots are additive without a schema bump. Snapshot `policyAccountId` is historical provenance and need not equal the Trade's current Account after merge.

IDs beginning with `sample:v1:` are never synchronized. Sample Dataset remains device-local onboarding data.

## Merge and conflicts

Different IDs form a union. Identical payloads are no-ops. For the same ID with different payloads, the newer logical `updatedAt` wins as one complete record; Trades are never field-merged. Equal timestamps deterministically choose the server version. Every losing payload is retained in device-local conflict diagnostics. Clock skew remains a v1 risk.

Remote envelopes are decoded and schema-validated, merged into a candidate, checked for Account/Stock references and transfer pairing, and rebuilt with the production TradingLedger before one atomic local commit. Invalid batches do not partially apply.

`deletedAt` is synchronized as ordinary record state. Cloud records are not physically deleted in v1, preventing stale-device resurrection. Accounts continue to use `archivedAt`.

### Trade-ledger reset and undo

An account-wide Trade-ledger reset uses ordinary Trade tombstones: every affected Trade keeps its ID and payload while one shared timestamp becomes both `deletedAt` and `updatedAt`. A newer reset tombstone therefore wins over an older active remote record without a hard delete or a new Sync entity. Local undo restores the same IDs with a newer `updatedAt` and `deletedAt: null`, so ordinary whole-record LWW also carries the restoration. Every affected non-sample Trade is projected; sample Trades and the device-local `trade-ledger-reset-snapshots` collection are never synchronized. Sync schema version remains 1.

## Bootstrap

First sync compares deterministic record names and merges both sides. Local-only records become upload candidates, remote-only records become import candidates, and conflicts use the policy above. Neither side replaces the other wholesale.

## Local state and restore

Outbox, record state, conflicts, status, CloudKit tokens, serialized engine state, and the `import-mapping-profiles` collection are device-local and excluded from Backup V6. Mapping profiles contain no raw imported rows and are never synchronized. Portfolio Plan state, revisions, and allocation targets participate in Backup V6 but remain intentionally outside Sync V1. Local domain writes and outbox changes share a SQLite transaction. Remote, sample, derived, and backup sources never echo as ordinary local edits. Backup restore sets `needsReconciliation` and pauses outgoing sync until explicit reconciliation.

iCloud account sign-out/change pauses sync and preserves all local records. A different private database is never automatically merged without reconciliation.
