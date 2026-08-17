# Account Fee Policy v1

Account Fee Policy v1 is an optional Account-owned configuration for calculating a suggested brokerage fee from a future trade's gross amount. Phase 1 provides the domain calculator, validation, Account management UI, preview, local persistence, Backup V5, and Sync V1 compatibility. It does not write fees into the Trade form and never recalculates historical Trades.

## Stored contract

`InvestmentAccount.feePolicy` is optional and may be absent, `null`, or an `AccountFeePolicyV1`:

```text
{ version: 1, enabled: boolean, rules: AccountFeeRuleV1[] }
```

Each rule has a stable ID and user-authored name, market (`all` or an existing Stock market), currency, side (`buy`, `sell`, or `both`), percentage rate, fixed/minimum/maximum fee, optional gross-amount bounds, inclusive effective dates, and a rounding mode/unit. Numeric configuration is stored as normalized, non-negative decimal strings. Exponents, grouping separators, non-finite values, and negative values are rejected. `-0` normalizes to `0`.

Rules are limited to 50 per Account. IDs must be unique, names are 1–60 characters, the percentage rate is 0–100, the rounding unit is greater than zero, minimum cannot exceed maximum, and a gross lower bound must be below its upper bound. Date-only values use strict `YYYY-MM-DD` calendar dates.

Unknown fields and unknown future policy versions fail closed. Local collection loading, Backup V5 restore, and Sync V1 candidate validation all use this same policy validator.

## Matching

A rule matches when all of the following are true:

- the policy is enabled;
- currency is an exact match;
- market is exact or `all`;
- side is exact or `both`;
- the trade date is within the inclusive start/end interval;
- gross amount is at or above the inclusive lower bound and below the exclusive upper bound.

An exact market outranks `all`, and an exact side outranks `both`. Currency must match exactly; the calculator performs no currency conversion and applies only same-currency rules. List order is not priority. If multiple matching rules retain the same highest specificity, the calculator reports the sorted ambiguous rule IDs rather than choosing one. Validation prevents equal-scope rules with overlapping date and gross-amount intervals from being saved.

The result distinguishes `matched`, `policy-disabled`, `no-match`, `ambiguous`, and `invalid-input`. A no-match result is not silently converted to a zero fee. A matching zero-rate/zero-fixed rule is an explicit matched fee of `0`.

## Calculation

All arithmetic uses `decimal.js`; JavaScript floating-point arithmetic is not used for fee values.

```text
percentage = gross amount × rate / 100
base       = percentage + fixed fee
minimum    = max(base, minimum fee) when configured
maximum    = min(minimum result, maximum fee) when configured
fee        = minimum/maximum result rounded to a multiple of rounding unit
```

The order is fixed. Rounding supports floor, half-up round, and ceil. The returned breakdown contains every intermediate decimal string and is also used by the Account rule preview. Tax remains a separate Trade field and is never calculated, changed, or combined with this fee policy.

## Account management behavior

New Accounts start without an active policy. The Account editor can enable the policy and add, edit, duplicate, or delete rules. New rules default to all markets, the Account base currency, both sides, zero percentage/fixed fee, today's date, and currency-aware rounding: KRW/JPY floor to `1`; other supported currencies half-up round to `0.01`.

Rule deletion uses an explicit in-app alert dialog. Cancel leaves the policy unchanged. A duplicate opens as a new draft and cannot be saved until any equal-priority overlap is resolved. Account save validates and normalizes the entire policy before replacing the Account, so partial rule changes are never persisted. Preview values are temporary and do not enter Account or Trade data.

Account cards and detail pages show whether automatic fee calculation is off or enabled and how many rules are configured.

## Existing data and Account operations

- Editing, choosing a default, and archiving preserve the Account policy.
- Merge leaves the target Account's policy unchanged and archives the source Account with its original policy.
- Future entries associated with the merged identity are expected to use the target policy when Phase 2 is implemented.
- Historical Trade `fee` values are never rewritten by policy changes or Account merge.

## Backup and Sync compatibility

Backup remains version 5 and Sync remains version 1. Older payloads that omit `feePolicy` remain valid. `null` and valid v1 policies round-trip through plaintext/encrypted Backup V5 and Sync V1. Invalid rules and future versions reject the complete candidate before persistence. Backup collection counts and Sync's device-local `isDefault` behavior are unchanged.

## Explicit Phase 1 boundary

Phase 1 does not integrate with Trade creation/editing, taxes, broker presets, provider APIs, network access, import fallback rules, fee provenance, fee-currency conversion, or historical fee recalculation. Those require a separate Phase 2 specification and review.
