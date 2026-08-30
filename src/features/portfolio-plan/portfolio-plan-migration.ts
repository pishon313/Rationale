import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { saveCollectionsAtomically, type CollectionWrite } from "@/lib/local-repository";
import { validateStoredCollection } from "@/lib/collection-validation";
import {
  portfolioPlanStateId,
  type LegacyPortfolioAllocationTargetV6,
  type LegacyPortfolioPlanRevisionV6,
  type LegacyPortfolioPlanStateV6,
  type PortfolioAllocationGroup,
  type PortfolioAllocationTarget,
  type PortfolioPlanRevision,
  type PortfolioPlanRepairDraft,
  type PortfolioPlanState,
} from "./types";
import { validateLegacyPortfolioPlanV6Collections, validateNewPortfolioTargetReferences, validatePortfolioPlanCollections } from "./validation";

export type PortfolioPlanV6Migration = {
  states: PortfolioPlanState[];
  revisions: PortfolioPlanRevision[];
  groups: PortfolioAllocationGroup[];
  targets: PortfolioAllocationTarget[];
  needsAccountSelection: boolean;
};

export function migratePortfolioPlanV6(input: {
  states: readonly LegacyPortfolioPlanStateV6[];
  revisions: readonly LegacyPortfolioPlanRevisionV6[];
  targets: readonly LegacyPortfolioAllocationTargetV6[];
  stocks: readonly Stock[];
  accounts: readonly InvestmentAccount[];
  trades: readonly Trade[];
}): PortfolioPlanV6Migration {
  validateLegacyPortfolioPlanV6Collections({ states: input.states, revisions: input.revisions, targets: input.targets, stocks: input.stocks });
  if (!input.states.length && !input.revisions.length && !input.targets.length) return { states: [], revisions: [], groups: [], targets: [], needsAccountSelection: false };

  const legacyState = input.states[0] ?? null;
  const activeRevision = input.revisions.find((revision) => revision.id === legacyState?.activeRevisionId) ?? null;
  const contributionAmountMinor = validLegacyContribution(activeRevision?.targetAmountKrw);
  const accountIds = new Set(input.accounts.map((account) => account.id));
  const singleAccountId = input.accounts.length === 1 ? input.accounts[0]?.id ?? null : null;
  const accountByTargetId = new Map<string, string>();
  const unresolvedTargetIds: string[] = [];

  for (const target of input.targets) {
    const inferred = target.targetType === "stock"
      ? inferStockAccount(target.stockId, input.trades, accountIds, singleAccountId)
      : singleAccountId;
    if (inferred) accountByTargetId.set(target.id, inferred);
    else unresolvedTargetIds.push(target.id);
  }

  if (unresolvedTargetIds.length) {
    const updatedAt = legacyState?.updatedAt ?? latestTimestamp(input.revisions.map((revision) => revision.updatedAt));
    const states: PortfolioPlanState[] = [{
      id: portfolioPlanStateId,
      activeRevisionId: null,
      contributionAmountMinor,
      contributionCurrency: "KRW",
      updatedAt,
      repairDraft: {
        version: 1,
        status: "needsAccountSelection",
        legacyState,
        legacyRevisions: clone(input.revisions),
        legacyTargets: clone(input.targets),
        unresolvedTargetIds,
        inferredAccountIdsByTargetId: Object.fromEntries(accountByTargetId),
      },
    }];
    validatePortfolioPlanCollections({ states, revisions: [], groups: [], targets: [], stocks: input.stocks, accounts: input.accounts });
    return { states, revisions: [], groups: [], targets: [], needsAccountSelection: true };
  }

  const revisions = input.revisions.map((revision): PortfolioPlanRevision => ({
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    basedOnRevisionId: revision.basedOnRevisionId,
    thesis: revision.thesis,
    changeNote: revision.changeNote,
    createdAt: revision.createdAt,
    activatedAt: revision.activatedAt,
    updatedAt: revision.updatedAt,
  }));
  const groups = revisions.map((revision): PortfolioAllocationGroup => ({
    id: legacyGroupId(revision.id),
    revisionId: revision.id,
    name: "Legacy Allocation",
    targetWeightBps: 10000,
    sortOrder: 0,
    updatedAt: revision.updatedAt,
  }));
  const targets = input.targets.map((target): PortfolioAllocationTarget => ({
    id: target.id,
    revisionId: target.revisionId,
    groupId: legacyGroupId(target.revisionId),
    accountId: requiredAccountId(accountByTargetId, target.id),
    targetType: target.targetType,
    stockId: target.stockId,
    weightWithinGroupBps: target.targetWeightBps,
    sortOrder: target.sortOrder,
    updatedAt: target.updatedAt,
  } as PortfolioAllocationTarget));
  const states: PortfolioPlanState[] = legacyState ? [{
    id: portfolioPlanStateId,
    activeRevisionId: legacyState.activeRevisionId,
    contributionAmountMinor,
    contributionCurrency: "KRW",
    updatedAt: legacyState.updatedAt,
    repairDraft: null,
  }] : [];
  validatePortfolioPlanCollections({ states, revisions, groups, targets, stocks: input.stocks, accounts: input.accounts });
  return { states, revisions, groups, targets, needsAccountSelection: false };
}

export function legacyGroupId(revisionId: string) {
  return `legacy-allocation:${revisionId}`;
}

export function isLegacyPortfolioPlanV6Data(input: {
  states: readonly (PortfolioPlanState | LegacyPortfolioPlanStateV6)[];
  revisions: readonly (PortfolioPlanRevision | LegacyPortfolioPlanRevisionV6)[];
  targets: readonly (PortfolioAllocationTarget | LegacyPortfolioAllocationTargetV6)[];
}) {
  return input.states.some((state) => !("contributionAmountMinor" in state))
    || input.revisions.some((revision) => "targetAmountKrw" in revision)
    || input.targets.some((target) => !("weightWithinGroupBps" in target));
}

export function portfolioPlanV6MigrationWrites(migration: PortfolioPlanV6Migration): CollectionWrite[] {
  return [
    { collection: "portfolio-plan-state", values: migration.states },
    { collection: "portfolio-plan-revisions", values: migration.revisions },
    { collection: "portfolio-allocation-groups", values: migration.groups },
    { collection: "portfolio-allocation-targets", values: migration.targets },
  ];
}

export async function persistPortfolioPlanV6Migration(migration: PortfolioPlanV6Migration, save = saveCollectionsAtomically) {
  await save(portfolioPlanV6MigrationWrites(migration), { failurePolicy: "caller-managed" });
}

export type PortfolioPlanRepairActivation = {
  states: PortfolioPlanState[];
  revisions: PortfolioPlanRevision[];
  groups: PortfolioAllocationGroup[];
  targets: PortfolioAllocationTarget[];
  writes: CollectionWrite[];
};

/** Converts the complete preserved V6 history after the user resolves every missing account. */
export function buildPortfolioPlanRepairActivation(input: {
  state: PortfolioPlanState;
  accountIdsByTargetId: Readonly<Record<string, string>>;
  stocks: readonly Stock[];
  accounts: readonly InvestmentAccount[];
  contributionAmountMinor: number;
  contributionCurrency: PortfolioPlanState["contributionCurrency"];
  now?: string;
}): PortfolioPlanRepairActivation {
  const repair = requiredRepairDraft(input.state.repairDraft);
  const accountIds = new Map(Object.entries({ ...(repair.inferredAccountIdsByTargetId ?? {}), ...input.accountIdsByTargetId }));
  const revisions = repair.legacyRevisions.map((revision): PortfolioPlanRevision => ({
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    basedOnRevisionId: revision.basedOnRevisionId,
    thesis: revision.thesis,
    changeNote: revision.changeNote,
    createdAt: revision.createdAt,
    activatedAt: revision.activatedAt,
    updatedAt: revision.updatedAt,
  }));
  const groups = revisions.map((revision): PortfolioAllocationGroup => ({
    id: legacyGroupId(revision.id),
    revisionId: revision.id,
    name: "Legacy Allocation",
    targetWeightBps: 10000,
    sortOrder: 0,
    updatedAt: revision.updatedAt,
  }));
  const targets = repair.legacyTargets.map((target): PortfolioAllocationTarget => ({
    id: target.id,
    revisionId: target.revisionId,
    groupId: legacyGroupId(target.revisionId),
    accountId: requiredAccountId(accountIds, target.id),
    targetType: target.targetType,
    stockId: target.stockId,
    weightWithinGroupBps: target.targetWeightBps,
    sortOrder: target.sortOrder,
    updatedAt: target.updatedAt,
  } as PortfolioAllocationTarget));
  const activeRevisionId = repair.legacyState?.activeRevisionId ?? null;
  if (!activeRevisionId) throw new Error("V6_PORTFOLIO_ACTIVE_REVISION_MISSING");
  validateNewPortfolioTargetReferences(targets.filter((target) => target.revisionId === activeRevisionId), input.stocks, input.accounts);
  const states: PortfolioPlanState[] = [{
    id: portfolioPlanStateId,
    activeRevisionId,
    contributionAmountMinor: input.contributionAmountMinor,
    contributionCurrency: input.contributionCurrency,
    updatedAt: input.now ?? new Date().toISOString(),
    repairDraft: null,
  }];
  validatePortfolioPlanCollections({ states, revisions, groups, targets, stocks: input.stocks, accounts: input.accounts });
  const writes = portfolioPlanV6MigrationWrites({ states, revisions, groups, targets, needsAccountSelection: false });
  for (const { collection, values } of writes) if (!validateStoredCollection(collection, values).valid) throw new Error("PORTFOLIO_REPAIR_CANDIDATE_INVALID");
  return { states, revisions, groups, targets, writes };
}

export async function persistPortfolioPlanRepairActivation(activation: PortfolioPlanRepairActivation, save = saveCollectionsAtomically) {
  await save(activation.writes, { failurePolicy: "caller-managed" });
}

function inferStockAccount(stockId: string, trades: readonly Trade[], accountIds: ReadonlySet<string>, fallback: string | null) {
  const candidates = referencedAccounts(trades.filter((trade) => trade.stockId === stockId), accountIds);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return fallback;
  return null;
}

function referencedAccounts(trades: readonly Trade[], accountIds: ReadonlySet<string>) {
  return [...new Set(trades.filter((trade) => !trade.deletedAt && trade.accountId && accountIds.has(trade.accountId)).map((trade) => trade.accountId as string))].sort();
}

function validLegacyContribution(value: number | null | undefined) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function requiredAccountId(values: ReadonlyMap<string, string>, targetId: string) {
  const value = values.get(targetId);
  if (!value) throw new Error("V6_PORTFOLIO_TARGET_ACCOUNT_UNRESOLVED");
  return value;
}

function requiredRepairDraft(value: PortfolioPlanRepairDraft | null | undefined) {
  if (!value || value.status !== "needsAccountSelection") throw new Error("PORTFOLIO_REPAIR_DRAFT_MISSING");
  return value;
}

function latestTimestamp(values: readonly string[]) {
  return values.slice().sort().at(-1) ?? new Date(0).toISOString();
}

function clone<T>(value: readonly T[]): T[] {
  return JSON.parse(JSON.stringify(value)) as T[];
}
