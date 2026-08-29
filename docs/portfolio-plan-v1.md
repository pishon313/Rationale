# Portfolio Plan v1

## Product intent

Portfolio Plan records the allocation the user intends to hold and compares that intent with the portfolio calculated from current records. It is descriptive: the feature shows target, current allocation, and drift in percentage points, but does not recommend trades or rebalancing. The active plan also stores an optional KRW target operating amount so each target row can show a formula-derived target value.

The page is available at `/portfolio`. Creating a plan is optional and the rest of Rationale remains usable without one.

## Separate from Buy Plans

Portfolio Plan is not the existing `BuyPlan` domain. The `plans` collection and `Trade.planId` continue to represent per-stock purchase intentions and their trade linkage. Portfolio Plan uses its own types and collections and does not change those semantics.

## One active plan and immutable revisions

v1 has one implicit portfolio and at most one active plan revision. `PortfolioPlanState.activeRevisionId` selects that revision.

The page is an always-editable worksheet rather than a separate create/edit flow. Saving the first valid worksheet creates revision 1. Later edits copy the active plan into UI draft state; activation creates a new revision with an incremented number and `basedOnRevisionId`, creates new target rows, and switches the active ID. Historical activated revisions and their targets are retained unchanged. The three collection writes are committed atomically so a partial plan cannot become active.

There is deliberately no revision-history UI in v1.

## Persisted collections

- `portfolio-plan-state`: singleton state record with ID `default` and the active revision ID.
- `portfolio-plan-revisions`: immutable activated revision metadata, thesis, and optional change note.
- `portfolio-allocation-targets`: registered Stock or Cash targets belonging to a revision.

Targets reference existing `Stock.id` values; they do not duplicate ticker, name, exchange, currency, or provider identity. Cash is a target type, not a synthetic Stock. Target weights are integer basis points and an activated revision must total exactly 10,000 bps. A revision permits each Stock once and at most one Cash target. `PortfolioPlanRevision.targetAmountKrw` stores the user-entered operating amount; each row target amount is derived as `targetAmountKrw × targetWeightBps ÷ 10,000` and is never persisted separately. Legacy revisions without the field fall back to the currently valued portfolio total.

Because revisions are immutable, sample Stocks referenced by any historical allocation target are treated as user dependencies. Sample-data removal is blocked before those Stock records can be removed and orphan the plan history.

## Source-of-truth boundaries

Portfolio Plan stores intent only. Existing data remains authoritative for actual economics:

- `Stock[]` provides security identity, current price, and currency.
- `Trade[]` and `InvestmentAccount[]` feed `TradingLedger`.
- `TradingLedger.positions` provides current open quantities.
- `TradingLedger.cashBalances` provides current cash and reconciliation reliability.
- the existing FX snapshot converts values to KRW.

No Holding or Portfolio entity is introduced.

## Target-versus-current comparison

The pure comparison domain function values every open security position as current quantity multiplied by the Stock current price and current FX rate. It aggregates cash across accounts and currencies from the ledger. The denominator is the KRW value of all open positions plus all cash, including assets absent from the plan.

An actual holding absent from the plan appears as `Outside current plan` with a zero target. A planned target with no holding has zero current value. Drift is `current percentage - target percentage` and is displayed in percentage points. With a zero total value, target weights and zero target amounts remain visible while current percentages and drift are unavailable.

## Cash and incomplete values

Cash participates in the denominator whether or not the plan has an explicit Cash target. Because current allocation depends on the complete denominator, the entire comparison fails closed when any ledger cash balance is unreconciled, a held Stock has no valid current price, a required FX rate is invalid, or a held Stock identity is missing. Known assets are not renormalized into a misleading partial percentage.

## Backup V6

Backup V6 includes all three Portfolio Plan collections. Validation checks record shape, singleton identity, references among state/revisions/targets/Stocks, unique revision numbers and IDs, target uniqueness, the single-Cash rule, and exact 10,000-bps totals for every activated revision. Restore remains compatible with V1–V5; restoring an older full backup resets the newer Portfolio Plan collections to empty values.

## Sync boundary

Portfolio Plan is device-local and backup-backed in v1. Sync V1 remains intentionally limited to accounts, stocks, and trades. Adding plan synchronization requires a separately versioned contract and conflict policy.

## Non-goals and future extensions

v1 does not include multiple portfolios, reference models, recurring buys, revision-history UI, a generalized Decision entity, plan-to-journal integration, tolerance bands, trade recommendations, a market-data redesign, or Portfolio Plan sync.
