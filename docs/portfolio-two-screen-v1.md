# Portfolio Two-Screen V1 Contract

Status: accepted product contract; Phase 1 foundation implemented on 2026-08-30.

This contract supersedes the navigation, persistence, and calculation contracts in `portfolio-plan-v1.md` and `portfolio-shell-v1.md`. Those documents remain as history for the earlier prototype.

## Product boundary

Portfolio V1 answers two questions:

1. **Overview** (`/portfolio`): How does the current Portfolio differ from the user's Target Allocation?
2. **Plan** (`/portfolio/plan`): How is the user's Contribution Amount distributed across Allocation Groups and Targets?

The final visible local navigation contains only Overview and Plan. Holdings remain expandable Overview detail, Activity remains in Trades, and Investment Thesis remains an optional Plan field. Separate Holdings, Activity, Rationale, and Reports screens, the single-option Portfolio switcher, and placeholder route cleanup are deferred to the shell-reduction phase.

V1 does not execute orders, connect to brokers, track monthly completion, recommend trades or rebalancing, correct Contributions for Drift, define tolerance bands, support multiple Portfolios or reference models, create Holding persistence, show Revision history, or sync Portfolio state.

`Trade` and `TradingLedger` remain the source of truth for actual positions and Cash. Portfolio persists intent and mutable Contribution settings only.

## Terminology

Use Portfolio, Overview, Target Allocation, Contribution Plan, Contribution Amount, Target Weight, Current Weight, Drift, Outside Current Plan, and Revision. Store weights as basis points; display weights as percent and Drift as percentage points (`%p`). Do not add qualitative health or alignment labels.

## Domain and persistence

Target Allocation and Contribution settings have different lifecycles:

- Changing Allocation Groups, Targets, weights, selected Accounts, thesis, or change note creates and activates a new immutable `PortfolioPlanRevision`.
- Changing only Contribution Amount or Currency updates singleton `PortfolioPlanState`; it creates no Revision.
- Derived effective Target weights and Contribution row amounts are not persisted.

Collections:

- `portfolio-plan-state`
- `portfolio-plan-revisions`
- `portfolio-allocation-groups`
- `portfolio-allocation-targets`

Revision activation writes all four collections atomically. A Contribution-only update writes state only.

The relationship is:

```text
PortfolioPlanState
  -> active PortfolioPlanRevision
      -> PortfolioAllocationGroup[]
          -> PortfolioAllocationTarget[]
```

State stores `activeRevisionId`, non-negative safe-integer `contributionAmountMinor`, a supported `contributionCurrency`, and `updatedAt`. A Group stores its Portfolio-level `targetWeightBps`. A Target stores its `groupId`, execution `accountId`, and `weightWithinGroupBps`, plus either a Stock reference or Cash.

## Activation validation

An activated Revision must satisfy all of these rules:

- at least one Group;
- Group Target Weights total exactly 10,000 bps;
- every Group has at least one Target;
- Target weights within every Group total exactly 10,000 bps;
- trimmed Group names are non-empty and normalized names are unique within the Revision;
- a Stock appears no more than once across the Revision;
- a Cash Account appears no more than once as a Cash Target across the Revision;
- every Revision, Group, Account, and Stock reference exists;
- archived Accounts and soft-deleted Stocks cannot be selected for a new Revision;
- historical archived/deleted references remain valid and are preserved;
- Contribution Amount and Currency satisfy the state contract.

Invalid editable drafts must stay outside persisted active Revision records.

## Contribution calculation

The effective Portfolio weight of a Target is:

```text
group.targetWeightBps / 10,000
× target.weightWithinGroupBps / 10,000
```

Contribution calculations operate in Currency minor units. KRW and JPY use zero decimal places; USD, EUR, CAD, and HKD use two. Allocation uses deterministic largest remainder at both levels:

1. floor each exact Group amount;
2. distribute remaining units by descending remainder, then `sortOrder`, then `id`;
3. repeat within each Group for its Targets.

The Group total, each Group's Target total, and the final Target total must exactly equal their inputs down to one minor unit.

## Overview comparison

Overview compares Target and current values at Group level with nested Target details:

- Stock current value aggregates that Stock's open positions across every Account.
- Cash Target current value includes reconciled Cash for that Target's Account.
- The denominator includes every open position and every reconciled Cash balance.
- unplanned Stocks and Cash Accounts form the synthetic `Outside Current Plan` Group with zero Target Weight;
- known assets are never renormalized to hide unknown or outside values;
- Target Value is current total Portfolio value multiplied by Target Weight, never Contribution Amount.

Valuation fails closed for a ledger error, missing held Stock reference, invalid/missing price, invalid FX, unreconciled Cash, or invalid numeric result. In that state, all Current Weights and Drift values are unavailable together, while Target Allocation remains visible.

## Backup V7 and V6 migration

Backup V7 contains all four Portfolio collections, including `portfolioAllocationGroups` and the new state and Target fields. V1–V6 remain accepted according to the existing restore policy.

V6 Portfolio data migrates deterministically:

- create one 100% `Legacy Allocation` Group per historical Revision;
- move each legacy `targetWeightBps` to `weightWithinGroupBps`;
- use the active Revision's `targetAmountKrw` as the candidate KRW Contribution Amount;
- assign an Account only when relevant history or a single existing Account makes the choice unambiguous.

If any Account cannot be safely resolved, migration stores the untouched legacy state, Revisions, Targets, and weights in an inactive `needsAccountSelection` repair draft. It does not activate a schema-weakened Revision or choose an arbitrary Account.

## Delivery phases

- **Phase 1 — foundation:** this contract, types, validation, pure Contribution and Overview calculations, atomic mutations, Backup V7, V6 migration, tests, and only compile adapters.
- **Phase 2 — Plan:** Contribution inputs, Group/Target editor, Account selection, live allocation, execution table, and save states.
- **Phase 3 — Overview:** metrics, chart, Group table, expanded Target rows, outside-plan and unavailable states.
- **Phase 4 — shell reduction:** two-item navigation, route cleanup, switcher removal, responsive/localization/E2E hardening.

Phase 1 must not be mistaken for the final Overview or Plan interface.
