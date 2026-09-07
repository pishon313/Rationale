# Trade-Centric Ledger v1 — Phase 1

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

Net external contributions, full-account profit/return, XIRR, and an equity curve cannot be inferred from a current-cash snapshot and remain explicitly unavailable. The existing UI only receives minimal nullable compile adapters in Phase 1; final Trade and Account presentation belongs to Phase 2.

## Account merge

Merge calculates known balances at the merge timestamp, moves Trades through the existing atomic Accounts-plus-Trades write, and creates fresh target baselines at that timestamp. Known source and target amounts are summed by Currency. If only one side is tracked, only its known amount is preserved. A Currency unknown on both sides remains untracked. Future-dated records are excluded from the anchor and apply once after it.

The source Account is archived with its metadata preserved. Archived baselines are not replayed. Fee-policy provenance and the existing position/realized-P&L economic safety check remain intact. Because baseline storage is non-negative, a negative combined amount fails closed instead of storing invalid metadata.

## Backup, Sync, Import, and reset

- Backup remains V7. Optional cash metadata round-trips, missing data restores as untracked, and no old cash semantics are reconstructed. Encrypted Backup uses the same validated payload.
- Sync remains V1 and carries optional Account cash metadata through existing whole-record LWW. `isDefault` stays device-local; no new entity or schema version is introduced.
- Stored browser and SQLite Account collections use the shared validator and existing quarantine policy.
- Imported Buy/Sell records need no Deposit; Trade-derived position, capital, and P&L values calculate immediately.
- Trade-ledger reset behavior and its device-local undo contract are unchanged. Baselines are Account metadata and are not migrated from reset or historical Trade data.

## Deferred work

Phase 1 does not add current-cash dialogs, cash-event UX gating, final Trade/Account page designs, Portfolio cash behavior, Reports changes, Windows work, or Sync V2. The temporary Portfolio reconciliation adapter remains until the Portfolio phase owns the new cash-availability contract.
