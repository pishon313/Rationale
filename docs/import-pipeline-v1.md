# Import Pipeline v1

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

- when a stable external execution ID is present: provider + Account ID + external execution ID;
- otherwise: Account ID + Stock ID + full execution timestamp + side + quantity + price + currency + deterministic occurrence number among otherwise identical rows in the file.

Order ID alone is not execution identity because one order can have multiple fills. Fee, tax, and exchange rate are deliberately excluded from the primary source identity, but remain part of the full economic comparison; a changed value therefore becomes a source conflict rather than a new silent import. Identical rows in one file receive distinct occurrence-based source keys, while later identical rows are visible possible duplicates and excluded by default. Reimporting the same file produces the same source keys.

## Provenance and journal semantics

Imported Trades are stored with `journalStatus: "unreviewed"` and `origin.kind: "fileImport"`, plus source key, optional provider/external execution ID, and import timestamp. Manual records are `recorded/manual`; system migrations are `unreviewed/system`. Legacy Trades normalize conservatively to `recorded/legacy`.

All economic ledger and performance calculations include imported Trades. Behavioral analytics—plan compliance, emotions, and rule snapshots—include only `recorded` Trades. Editing an imported Trade through the ordinary journal form marks it recorded while preserving its source provenance.

## Mapping profiles

Profiles are versioned local records containing only a user name, stable column bindings, a header signature, and timestamps. A unique exact header signature is reapplied automatically. Reordered columns are exact matches because signatures are order-independent; files with additional columns are compatible when every saved reference still resolves. Missing columns, duplicate-header occurrence changes, and binding collisions block application.

The `import-mapping-profiles` collection is device-local. It is intentionally excluded from Backup V5 and multi-device sync, and contains no raw file rows or broker data.

## Safety boundary

Preview does not persist Trades. Possible duplicates require explicit selection, and exact duplicates/source conflicts/rejected rows cannot be selected. Timezone-bearing generic values are rejected. Immediately before save, the selected batch is rebuilt against the current complete ledger. The final write uses the existing atomic trade mutation path, preserving backup, restore, and sync invariants.

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
