# Buy Plan stock search v1

Buy Plans continue to require a real `Stock.id`. Online discovery does not introduce ticker-only Plans or a second instrument model. The Plan form always searches registered Stocks first, and an online EODHD request occurs only when the user explicitly chooses the online-search action after entering a query.

## Online boundary

The browser preview keeps registered search available but does not return fake remote data. Online discovery is available only through the existing native `search_instruments` command, API-key path, result contract, and supported-currency guard. Queries, failed results, result lists, and search history remain transient and are never written to local storage, SQLite, Backup, Sync, or telemetry.

Selecting an online result does not create anything. The result is first resolved against the complete Stock collection, including tombstones, using authoritative listing identity:

1. exact provider reference identity;
2. exact non-empty ISIN.

Names and tickers are display and search data, not authoritative identity. One active match reuses the existing Stock ID. A deleted match requires explicit restoration. Multiple authoritative matches block selection. A genuinely new identity opens an explicit confirmation before a non-persisted draft Stock is prepared.

## Shared Stock creation

`createStockFromInstrumentSearchResult` is the shared Stock-domain factory used by ordinary Stock search-add and Plan draft creation. It preserves provider identity, country/exchange/ISIN metadata, supported currency, asset type, and previous-close provenance. New records use the ordinary observation-only defaults: `관찰`, `관찰 전용`, no sector/category/thesis/tags, zero holdings, and initialized ledger timestamps.

The draft receives its final UUID before Plan persistence and behaves like the selected Stock in the form. Closing the confirmation or canceling the Plan discards the draft without writing a Stock.

## Atomic persistence

Final submission rebuilds complete candidate Stocks and Plans from the latest in-memory collections. It reruns identity resolution to prevent a duplicate created by concurrent or stale state, validates both stored collection shapes and every Plan→Stock reference, and then issues one `saveCollectionsAtomically` call:

```text
new or restored Stock
  → candidate Stocks + candidate Plans
  → complete validation
  → one atomic Stocks/Plans commit
  → apply committed state to both stores
```

The browser repository rolls both localStorage values back when either write fails. The Tauri path delegates both collections to the existing single-transaction Rust command. In-memory stores update only after the commit succeeds, so failure leaves the form open for retry and cannot create an orphan Stock or partial Plan.

Restoration reuses the tombstone ID, clears only `deletedAt`, updates `updatedAt`, and preserves historical identity, category, thesis, and journal metadata. An existing Plan linked to a deleted Stock may remain unchanged; changing another Plan to that Stock requires explicit restoration.

Backup remains V5 and Sync remains V1. A created or restored record is an ordinary Stock, and the Plan schema remains linked by `stockId`.
