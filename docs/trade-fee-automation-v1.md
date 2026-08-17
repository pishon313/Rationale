# Trade Fee Automation and Provenance v1

Trade Fee Automation v1 connects the optional Account fee policy to buy/sell entry while keeping every saved `Trade.fee` an immutable historical fact until the user explicitly edits that Trade. Changing, disabling, deleting, or merging Account policies never recalculates existing Trades in the background.

## Precedence and provenance

`Trade.fee` and `Trade.tax` remain the only economic values consumed by Ledger and performance calculations. Optional metadata explains how the fee was established:

- `accountPolicy`: calculated from the selected Account policy and saved with a version-1 calculation snapshot;
- `manual`: explicitly entered or confirmed by the user;
- `sourceProvided`: supplied by an import file or future broker API response;
- `unknown`: a legacy record or source without reliable fee provenance.

An imported fee always wins over Account policy, including an explicitly supplied zero. The importer never invokes Account policy. A missing source fee becomes `unknown`; a nonzero value alone is never treated as proof that a source supplied it. Tax remains manual and separate in every mode.

## New Trade behavior

For a new buy/sell Trade, an enabled Account policy with a matching rule starts in automatic mode. Decimal arithmetic uses the unconverted Trade-currency gross amount (`quantity × price`), followed by percentage, fixed fee, minimum, maximum, and configured rounding. Account, Stock, side, trade date, quantity, price, or Stock-derived Trade currency changes immediately recalculate while automatic mode remains selected.

A valid rule that explicitly calculates zero is a verified automatic zero. A disabled policy starts in manual mode. No-match, ambiguous, and invalid-policy results are unresolved: the form never silently stores zero and requires the user to fix the Account policy or switch to manual entry. Manual edits clear Account-policy calculation evidence. Switching back to automatic creates new evidence only when the Trade is saved successfully.

## Existing Trade integrity

Opening an existing Trade preserves its fee, provenance, and calculation snapshot without consulting the current Account policy. Unrelated edits preserve all three. A change to Account, Stock, side, date, quantity, price, or Trade currency marks Account-policy evidence stale; saving is blocked until the user explicitly recalculates with the current policy or confirms a manual fee. A changed source-provided Trade likewise requires explicit manual confirmation. Policy recalculation replaces the old snapshot only after the user requests it and saves.

Account merge updates the Trade's current Account reference through the existing operation but does not rewrite the snapshot's `policyAccountId`. That value identifies the historical policy source and need not refer to an active Account.

## Calculation snapshot and validation

An `accountPolicy` Trade stores version, historical Account/rule identity, exact rule terms, Trade date/side/currency, quantity, price, gross amount, calculated fee, rounding configuration, and calculation time as non-localized decimal evidence. Shared validation is used by Trade mutations, Ledger input, local collection loading, Backup, encrypted Backup, and Sync.

Validation rejects unknown modes, incompatible mode/snapshot pairs, future snapshot versions, invalid decimal strings, stale quantity/price/date evidence, out-of-range rule inputs, irreproducible calculations, currency/side mismatches, and Account-policy provenance on cash flow, dividend, transfer, or opening-position records. `Trade.fee` may differ from the decimal evidence only within one deterministic currency minor unit. The historical source Account is not required to remain active.

## Import, Backup, Sync, and analytics

Source files record whether a fee column was actually mapped, separately from its numeric value. Both nonzero and zero mapped fees are `sourceProvided`; an absent fee column is `unknown`. Duplicate/source identity continues to use the established economic comparison and no Account policy participates in import.

Backup remains V5 and Sync remains V1. Older Trades may omit both optional fields. All four modes and valid snapshots round-trip additively through plaintext/encrypted Backup and whole-record Sync LWW. Invalid metadata fails closed through the existing validation and quarantine paths. No Backup V6, Sync V2, new Sync entity, historical bulk recalculation, network call, or Ledger redesign is introduced.

Fee provenance is explanatory only. Rule names, Account IDs, and decimal strings in snapshots do not enter plan compliance, emotion, rule-score, or other behavioral analytics.
