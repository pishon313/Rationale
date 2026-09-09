# Portfolio Classification v1

Rationale stores three independent classification dimensions for each Stock.

## Market sector

`marketSector` is an optional, single-choice industry classification. It stores one stable internal ID from Rationale's fixed sector list; localized labels are display-only and are never persisted. A broad-market or multi-sector ETF may leave this field unset because the fixed list is not a universal taxonomy.

## My category

My category is a user-authored, optional, single-choice grouping available on the dashboard. For backward compatibility it remains stored in the legacy `Stock.sector` field. Existing values are not inferred, translated, migrated, or reinterpreted: values such as `NAND`, `Nasdaq-100`, and `U.S. Infrastructure` remain user categories unless the user edits them.

Reusable category suggestions are derived from category values already assigned to Stocks. There is no separate category collection. Rename, merge, and clear operations replace the complete Stock collection atomically and include soft-deleted Stocks so category identity remains consistent. A separate entity can be considered later if categories need independent color, order, description, icon, or existence without an assigned Stock.

## Tags

`tags` remain user-authored, optional, and many-to-many. They represent overlapping themes or characteristics and are not used to produce additive asset-allocation totals, because one Stock can have several tags.

Current backup is version 6 and Sync remains version 1. `marketSector` is an additive optional Stock field, so old Stocks, backups, and Sync payloads require no migration rewrite.

The Phase 2 dashboard can switch between My category and Market sector without changing financial calculations. See [Dashboard classification views](./dashboard-classification-views.md).
