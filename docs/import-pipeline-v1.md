# Import Pipeline v1.1

Import Pipeline v1 converts broker-neutral tabular files into reviewed ledger candidates without creating Stocks or Accounts silently. CSV, TSV, XLS, and XLSX files are parsed locally; source files never leave the device.

## Architecture

1. `tabular-parser.ts` enforces the 10 MB limit, decodes supported legacy encodings, parses quoted delimited text, and reads the first Excel sheet.
2. `column-mapping.ts` represents a column as `ColumnReference { normalizedHeader, occurrence }`, where occurrence is zero-based among equal normalized headers. Header order therefore does not change a saved binding, and duplicate headers remain distinct.
3. `import-pipeline.ts` adapts each row to provider-neutral `CanonicalExecution`, resolves existing Account and Stock identities, classifies duplicates, and builds an unreviewed Trade candidate.
4. `preflightImport` validates the complete selected batch with the production transfer and TradingLedger guards.
5. The existing trade mutation path performs one normalized atomic replacement. A failed validation or write never appends a partial batch.

No broker API or broker-specific domain model is part of v1. `provider` is optional metadata and `generic-tabular-v1` is the only adapter. `CanonicalExecution` contains source evidence and normalized execution values, but no Rationale Stock ID, Account ID, Trade ID, plan, memo, emotion, or rule fields.

## Time and numeric policy

- Execution seconds are preserved. `10:11:12` and `10:11:13` are distinct executions.
- A supplied `Z` or numeric UTC offset is rejected with `IMPORT_UNSUPPORTED_TIMEZONE`; generic file import never strips or guesses a timezone. A future documented provider adapter may normalize provider timestamps before the canonical boundary.
- A timestamp without an offset is retained as local wall-clock time with seconds, matching the existing Trade contract.
- A missing time defaults to `09:00:00`, records `timePrecision: "date"`, and produces a warning. Multiple same-Account/same-Stock date-only events are blocked because their intraday Ledger order is ambiguous.
- Ambiguous DMY/MDY dates such as `08/09/2026` are rejected. ISO `YYYY-MM-DD` is the recommended form.
- Locale-aware decimal and grouping separators are accepted only when their interpretation is structurally valid.

## Resolution and issues

Ticker resolution is exact after conservative normalization; name fallback is used only when it yields one active Stock. Conflicting ticker/name results, ambiguous matches, missing Stocks, duplicate Account names, archived Accounts, and unknown Accounts are structured candidate errors. The importer never creates a Stock or Account.

Domain issues contain a stable code, severity, and optional row/field/candidate identity or structured details. The UI translates each code at the boundary; user-facing strings are not the domain protocol. Candidate statuses are:

- `ready`: safe and selected by default.
- `exact_duplicate`: same stable source identity and economic values; never selected.
- `possible_duplicate`: fuzzy/economic match to another record; never selected without explicit user action.
- `source_conflict`: same source identity with different economic values; blocked.
- `rejected`: parsing, mapping, or resolution failure; blocked.

## Identity and deduplication

Source identity is SHA-256 based:

- when a stable external execution ID is present: adapter ID + Account ID + external execution ID;
- otherwise: Account ID + Stock ID + full execution timestamp + side + quantity + price + currency + deterministic occurrence number among otherwise identical rows in the file.

New identities use a canonical, separator-safe `file:v2` serialization. The free-text provider label is display-only provenance and never changes trusted identity. Existing `file:v1` keys are not rewritten: lookup also uses a unique Account ID + external execution ID match and deterministically recomputable legacy keys. Multiple trusted matches block safely. Order ID alone is not execution identity because one order can have multiple fills. Fee, tax, and exchange rate are deliberately excluded from the primary source identity, but remain part of the full economic comparison; a changed value therefore becomes a source conflict rather than a new silent import. Identical fallback rows without an external execution ID receive distinct occurrence-based source keys, while later identical rows are visible possible duplicates and excluded by default. Reimporting the same file produces the same source keys.

### In-file trusted identity reconciliation

Preview candidate identity is separate from persisted Trade identity. Every source row receives a deterministic `candidate:v1` ID from its import batch and row position for React keys, selection, and issue attribution. A proposed Trade retains the stable `import:<source-key hash>` ID; candidate IDs are never persisted in provenance.

Rows with an external execution ID are reconciled in a second pass using the provider-independent adapter + Account ID + external execution ID group key. Identical members keep one earliest representative action and show later rows as non-actionable in-file exact duplicates. Differing economics block every member as a source conflict. If Account identity resolves but one member later fails parsing, Stock resolution, or economic validation, the invalid row remains rejected and otherwise valid members are conservatively blocked. Existing active, deleted, and possible-match classification is retained on the representative. There is no first-row-wins policy.

Rows without an external execution ID do not enter trusted grouping. They retain occurrence-based fallback behavior, including separate full-second identities and visible possible duplicates.

## Provenance and journal semantics

Imported Trades are stored with `journalStatus: "unreviewed"` and `origin.kind: "fileImport"`, plus source key, optional provider/external execution ID, and import timestamp. Manual records are `recorded/manual`; system migrations are `unreviewed/system`. Legacy Trades normalize conservatively to `recorded/legacy`.

All economic ledger and performance calculations include imported Trades. Behavioral analytics—plan compliance, emotions, and rule snapshots—include only `recorded` Trades. Editing an imported Trade through the ordinary journal form marks it recorded while preserving its source provenance.

## Mapping profiles

Profiles are versioned local records containing only a user name, stable column bindings, a header signature, and timestamps. A unique exact header signature is reapplied automatically. Reordered columns are exact matches because signatures are order-independent; files with additional columns are compatible when every saved reference still resolves. Missing columns, duplicate-header occurrence changes, and binding collisions block application.

Compatible matching additionally requires the saved and current occurrence count to be identical for every bound normalized header. Additional unrelated columns are allowed, but adding or removing another occurrence of a bound header is incompatible. Profile identity and dirty state are separate: editing a selected profile permits an explicit in-place update or save-as-new action, while normalized duplicate names are rejected.

The `import-mapping-profiles` collection is device-local. It is intentionally excluded from Backup V5 and multi-device sync, and contains no raw file rows or broker data.

## Safety boundary

Preview does not persist Trades. Possible duplicates require explicit selection, and exact duplicates/source conflicts/rejected rows cannot be selected. Timezone-bearing generic values are rejected. Immediately before save, the selected batch is rebuilt against the current complete ledger. The final write uses the existing atomic trade mutation path, preserving backup, restore, and sync invariants.

v1.1 also treats soft-deleted imported Trades as trusted identity records. An economic match is shown as `previously_deleted`, excluded by default, and may be explicitly restored. Restore reuses the tombstone ID, creation time, complete provenance, journal status, plan, memo, emotion, scores, and rule annotations; it only clears `deletedAt` and updates `updatedAt`. Changed economics remain a blocked source conflict. The mutation plan separates inserts from restores and guarantees every Trade ID is unique across active records and tombstones before Ledger calculation or persistence.

Candidate review is paginated in groups of 100. Files larger than one page initially select ready candidates on the first page only. Hidden pages remain unselected until the user selects ready rows on that page or explicitly selects every ready candidate. Possible duplicates and deleted-record restores are never included in bulk ready selection. Counts distinguish current-page, other-page, inserted, restored, and blocked items, and every row exposes account, currency, exchange rate, fees, taxes, source label, external execution ID, and matched-record details.

Embedded and separately mapped times are normalized independently. Equal clocks such as `10:30` and `10:30:00` are accepted with the highest available precision; differing clocks produce `IMPORT_TIME_CONFLICT`. A timezone suffix in either value remains a blocking unsupported-timezone issue.

Submit-time preflight reconstructs the mutation plan against the latest complete Trade collection. A newly active match, changed tombstone, source conflict, ambiguous trusted identity, or duplicate ID makes the old preview stale and blocks the write until candidates are reviewed again.

## Future broker adapter boundary

A future connector enters after provider-specific transport and before Rationale resolution:

```text
Rust/Tauri broker connector
  → authenticated provider request
  → fill-level provider DTOs
  → provider adapter
  → CanonicalExecution[] + ImportIssue[]
  → existing resolution, dedup, preview, Ledger preflight, atomic commit
```

Such an adapter must fetch executions/fills rather than aggregate orders because one order can produce multiple executions. It must use read-only account/history capabilities, explicit pagination and date windows, and prefer the provider's external execution ID for idempotency. Provider DTOs must stop at the adapter and must not leak into `Trade`.

Credentials and refresh tokens belong in macOS Keychain. They must not be retained in React state longer than necessary and must never enter localStorage, SQLite Trade records, backups, CloudKit, analytics, or logs. Provider cursors/checkpoints are device-local. No provider adapter may bypass candidate preview or the production Ledger validation boundary.

No network connector, endpoint, credential UI, Rust command, permission, or API policy is implemented in v1.
