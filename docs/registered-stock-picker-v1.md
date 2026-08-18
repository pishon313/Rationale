# Registered stock picker v1

The Phase 1 stock picker selects an existing `Stock` by `Stock.id`. The visible ticker, name, market, and currency help the user identify the record, but they are never parsed back into an identity. Query text and keyboard highlight state are temporary UI state and are not persisted.

## Search contract

Queries are normalized with Unicode NFKC, surrounding whitespace is removed, repeated whitespace is collapsed, and comparison is case-insensitive. Punctuation is preserved. Only `Stock.ticker` and `Stock.name` are searched.

Results use this deterministic order:

1. exact ticker
2. ticker prefix
3. exact name
4. name prefix
5. ticker contains
6. name contains

Ties are resolved by normalized ticker, normalized name, and then `Stock.id`. An empty query shows at most 50 active Stocks in that order while retaining the current active selection when it falls outside the first 50.

## Deleted Stocks

Deleted Stocks are omitted from new selections. When an existing Trade, Observation, Review, or Buy Plan is linked to a deleted Stock, only that exact Stock is made available while editing and is marked `삭제됨`. Matching ticker or name text never relinks the record to a different Stock.

The Observation page filter may also show deleted Stocks that are still referenced by current Observation records. Selecting a filter changes only the view; it does not update any record.

## Feature behavior

| Feature | Empty selection | Saved identity |
| --- | --- | --- |
| Trade | Allowed only where the existing Trade behavior already allows it, such as non-Stock cash records | `Trade.stockId` |
| Stock Observation | Not allowed | `Observation.stockId`; `stockName` is copied from the selected Stock |
| Observation Stock filter | `전체 종목` is allowed | View state only; exact `Stock.id` matching |
| Review | Allowed | `Review.stockId`, or `null` in direct-input mode |
| Buy Plan | Not allowed | `BuyPlan.stockId`; `stockName` and `ticker` are copied from the selected Stock |

Review keeps its two existing modes. A linked Review takes its name from the selected registered Stock and hides the free-text target. Choosing `종목에 연결하지 않고 직접 입력` sets `stockId` to `null` and shows the `회고 대상` field without creating or guessing a Stock.

## Phase boundary

Version 1 searches registered local Stocks only. It performs no provider or network search and never creates a Stock automatically. Buy Plan Phase 2 adds explicit online discovery outside this picker while preserving its ID-based dependency boundary; identity resolution, confirmation, draft creation, and atomic Stock+Plan persistence are documented in [`buy-plan-stock-search-v1.md`](buy-plan-stock-search-v1.md).
