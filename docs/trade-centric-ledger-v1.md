# Trade-Centric Ledger v1 — Phase 1 + Phase 2 + Phase 3

Trade-Centric Ledger makes security Trades the independent source for positions, invested cost, realized profit and Net Trade Capital. Cash is optional Account metadata. A Buy does not require a Deposit or a positive cash balance.

## Release and compatibility contract

Rationale has no distributed production data. Phase 1 deliberately performs no cash migration and no startup Account rewrite. An Account whose `cashTracking` field is missing or `null` is read as `{ version: 1, baselines: [] }` and remains untracked without persisting that default. Historical cash records stay intact, but do not opt an Account into cash tracking and are not converted into baselines. No fake Deposit or other Trade is created to seed cash.

New or explicitly edited Accounts persist the canonical version-1 shape. The existing Account-identity migration continues to do only its original job; it never scans Trades to infer cash intent.

## Account cash metadata

`InvestmentAccount.cashTracking` is optional and contains at most one baseline per supported Currency. Each baseline stores a normalized non-negative Decimal string plus `asOf`, `createdAt`, and `updatedAt` timestamps. Version must be exactly 1, fields are strict, Currency values are supported, timestamps are valid, and `createdAt` cannot be later than `updatedAt`.

The shared validator is used by Account saves, stored-collection validation, Backup, and Sync. Unknown versions and malformed metadata fail closed through each boundary's existing error or quarantine policy.

## Net Trade Capital

Every valid non-opening security Trade has a signed capital effect:

- Buy: `+(quantity × price + fee + tax)`
- Sell: `-(quantity × price − fee − tax)`

The effect is retained in Trade Currency and converted to KRW using that Trade's exchange rate. Ledger output includes per-Account-and-Currency `tradeCapitalBalances` and `totalNetTradeCapitalKrw`. Opening positions, dividends, deposits, withdrawals, transfers, and other cash-only rows return `null` capital effects.

Net Trade Capital is not remaining invested cost. Existing position quantity, average cost, cycles, oversell protection, realized P&L, fee/tax, and FX rules remain unchanged.

## Baseline-driven cash

A `CashBalance` exists only for an active Account and Currency with a baseline. Its starting balance is the baseline value. The ledger applies only records with `tradedAt > baseline.asOf`; the equality boundary is intentionally excluded.

- Buy subtracts gross, fee, and tax.
- Sell adds gross after fee and tax.
- Dividend adds amount after fee and tax.
- Deposit adds amount.
- Withdrawal subtracts amount, fee, and tax.
- Transfer keeps the existing paired withdrawal/deposit semantics.
- Opening positions have no cash effect.

Without a matching baseline, the Trade calculation's `cashEffect` is `null` and no CashBalance is invented. A tracked balance may become negative and reports `isNegative: true`; this does not invalidate a Buy. A tracked zero remains observable as a CashBalance and is distinct from untracked cash.

Archived Accounts retain their metadata but do not emit active CashBalance entries. Ordinary archive still blocks an Account with an open position or a known non-zero tracked balance; unknown cash alone does not block it.

## Account performance compile contract

Market value, invested cost, realized P&L, unrealized P&L, Net Trade Capital, and open-position count are calculated without cash. Tracked cash and holdings-plus-cash are available only when cash is tracked. Aggregated cash is unavailable when any included Account is untracked.

Net external contributions, full-account profit/return, XIRR, and an equity curve cannot be inferred from a current-cash snapshot and remain explicitly unavailable. Trade and Account screens therefore lead with cash-independent position, invested-cost, Net Trade Capital, and realized/unrealized P&L metrics.

## Phase 2 user experience

- A Deposit is not required before a Buy or Sell. Trade recording and P&L remain available while cash is untracked.
- Untracked cash is unavailable, not zero. An explicitly tracked balance of zero is shown as an actual zero.
- Entering or updating current cash changes only Account metadata. It never creates a Trade or a reconciliation record.
- The baseline timestamp is an exclusive boundary: only events whose `tradedAt` is later than `baseline.asOf` affect current cash.
- Deposit and Withdrawal require a matching Account + Currency baseline. Transfer requires matching baselines on both Accounts. The forms preserve entered values while the user opens current-cash setup.
- Dividend remains recordable without a baseline and receives no cash effect while that Account + Currency is untracked.
- Cash tracking can be stopped for one Account + Currency after confirmation without deleting Trades or changing position, capital, or P&L history.
- Account screens keep fee-policy status, positions, recent Trades, and Trade-derived performance available independently of cash. A cash-inclusive figure is labeled only as `Holdings + tracked cash` and discloses partial Currency coverage.

Rationale has no production users or distributed production data. No phase performs cash migration, infers cash intent from old Trades, converts old balances into baselines, reconstructs historical cash, or rewrites Accounts at startup.

## Phase 3 Portfolio scope

Portfolio detects cash requirements from positive active Cash targets that have a selected Account. The target uses the Plan contribution Currency as its cash contract.

- Without a required Cash target, Portfolio values valid Stock and Bond positions only. Unknown cash is omitted, never substituted with zero, and the UI explicitly says that cash is not included.
- When Cash is in active scope, tracked cash without a matching target stays outside the current Plan, participates in the complete denominator as a separately reported value/share, and is never folded into the planned Cash target.
- With a required Cash target, a matching Account-and-Currency baseline is mandatory. Missing, unreconciled, or negative required cash makes the current total, every current weight, and every drift unavailable together while target intent remains visible.
- A tracked zero is valid and distinct from unavailable cash. A valid baseline includes only cash events strictly after its `asOf` boundary and uses the existing FX validation.
- Portfolio offers a direct current-cash action. Saving it updates only Account metadata; it creates no Portfolio Revision and changes no target or policy.
- Balance Assist can use a position-only snapshot when cash is not required. If required cash is unavailable, it returns saved fixed contribution weights with an explanation. Stock-level assistance remains independent when stock valuation is valid.

## Account merge

Merge calculates known balances at the merge timestamp, moves Trades through the existing atomic Accounts-plus-Trades write, and creates fresh target baselines at that timestamp. Known source and target amounts are summed by Currency. If only one side is tracked, only its known amount is preserved. A Currency unknown on both sides remains untracked. Future-dated records are excluded from the anchor and apply once after it.

The source Account is archived with its metadata preserved. Archived baselines are not replayed. Portfolio Revisions, Groups, and Targets are immutable: historical references remain byte-for-byte unchanged, and an active Revision reference blocks the merge until the user creates a new Plan Revision with another Account. The hotfix never rewrites Portfolio history or creates a Revision automatically. Fee-policy provenance and the existing position/realized-P&L economic safety check remain intact. Because baseline storage is non-negative, a negative combined amount fails closed instead of storing invalid metadata.

## Backup, Sync, Import, and reset

- Backup remains V7. Optional cash metadata round-trips, missing data restores as untracked, and no old cash semantics are reconstructed. Encrypted Backup uses the same validated payload.
- Sync remains V1 and carries optional Account cash metadata through existing whole-record LWW. `isDefault` stays device-local; no new entity or schema version is introduced.
- Stored browser and SQLite Account collections use the shared validator and existing quarantine policy.
- Imported Buy/Sell records need no Deposit; Trade-derived position, capital, and P&L values calculate immediately.
- Imported records obey the same exclusive cash-baseline boundary: before/equal records do not affect current cash and later records do. Import creates neither Deposits nor baselines.
- Trade-ledger reset soft-deletes active Trades and preserves Account baselines. Cash returns to its baseline after reset; undo restores Trades and recalculates their post-baseline effects without rewriting the baseline.

## Deferred work

Reports changes, Equity Curve, broker APIs, Windows work, Sync V2, cash migration, and broad schema cleanup remain deferred. Read compatibility with historical reconciliation records remains, but the normal UI does not create them.
