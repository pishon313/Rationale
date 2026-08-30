import type { Currency } from "@/domain/currency";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import { validateStoredCollection } from "@/lib/collection-validation";
import { saveCollectionsAtomically, type CollectionWrite } from "@/lib/local-repository";
import {
  portfolioPlanStateId,
  type PortfolioAllocationGroup,
  type PortfolioAllocationGroupDraft,
  type PortfolioAllocationTarget,
  type PortfolioAllocationTargetDraft,
  type PortfolioPlanRevision,
  type PortfolioPlanState,
} from "./types";
import {
  validateContributionAmount,
  validateNewPortfolioTargetReferences,
  validatePortfolioPlanCollections,
  validatePortfolioPlanStateRecord,
} from "./validation";

export type PortfolioPlanActivation = {
  states: PortfolioPlanState[];
  revisions: PortfolioPlanRevision[];
  groups: PortfolioAllocationGroup[];
  targets: PortfolioAllocationTarget[];
  revision: PortfolioPlanRevision;
  writes: CollectionWrite[];
};

export function buildPortfolioPlanActivation(input: {
  states: readonly PortfolioPlanState[];
  revisions: readonly PortfolioPlanRevision[];
  groups: readonly PortfolioAllocationGroup[];
  targets: readonly PortfolioAllocationTarget[];
  stocks: readonly Stock[];
  accounts: readonly InvestmentAccount[];
  draftGroups: readonly PortfolioAllocationGroupDraft[];
  draftTargets: readonly PortfolioAllocationTargetDraft[];
  contributionAmountMinor: number;
  contributionCurrency: Currency;
  thesis: string;
  changeNote: string;
  now?: string;
  revisionId?: string;
  groupIds?: readonly string[];
  targetIds?: readonly string[];
}): PortfolioPlanActivation {
  const now = input.now ?? new Date().toISOString();
  const activeRevisionId = input.states[0]?.activeRevisionId ?? null;
  if (activeRevisionId !== null && !input.revisions.some((revision) => revision.id === activeRevisionId)) throw new Error("ACTIVE_PORTFOLIO_REVISION_MISSING");
  validateContributionAmount(input.contributionAmountMinor);
  const revisionId = input.revisionId ?? crypto.randomUUID();
  const groupIds = input.groupIds ?? input.draftGroups.map(() => crypto.randomUUID());
  const targetIds = input.targetIds ?? input.draftTargets.map(() => crypto.randomUUID());
  if (groupIds.length !== input.draftGroups.length) throw new Error("PORTFOLIO_GROUP_IDS_INVALID");
  if (targetIds.length !== input.draftTargets.length) throw new Error("PORTFOLIO_TARGET_IDS_INVALID");
  if (new Set(input.draftGroups.map((group) => group.id)).size !== input.draftGroups.length) throw new Error("PORTFOLIO_DRAFT_GROUP_IDS_DUPLICATE");

  const revision: PortfolioPlanRevision = {
    id: revisionId,
    revisionNumber: Math.max(0, ...input.revisions.map((value) => value.revisionNumber)) + 1,
    basedOnRevisionId: activeRevisionId,
    thesis: input.thesis.trim(),
    changeNote: input.changeNote.trim(),
    createdAt: now,
    activatedAt: now,
    updatedAt: now,
  };
  const groupIdByDraftId = new Map(input.draftGroups.map((group, index) => [group.id, requiredId(groupIds, index, "PORTFOLIO_GROUP_IDS_INVALID")]));
  const createdGroups = input.draftGroups.map((group, index): PortfolioAllocationGroup => ({
    id: requiredId(groupIds, index, "PORTFOLIO_GROUP_IDS_INVALID"),
    revisionId,
    name: group.name.trim(),
    targetWeightBps: group.targetWeightBps,
    sortOrder: group.sortOrder,
    updatedAt: now,
  }));
  const createdTargets = input.draftTargets.map((target, index): PortfolioAllocationTarget => ({
    ...target,
    id: requiredId(targetIds, index, "PORTFOLIO_TARGET_IDS_INVALID"),
    revisionId,
    groupId: requiredMappedId(groupIdByDraftId, target.groupId),
    updatedAt: now,
  }));
  validateNewPortfolioTargetReferences(createdTargets, input.stocks, input.accounts);

  const states: PortfolioPlanState[] = [{
    id: portfolioPlanStateId,
    activeRevisionId: revisionId,
    contributionAmountMinor: input.contributionAmountMinor,
    contributionCurrency: input.contributionCurrency,
    updatedAt: now,
    repairDraft: null,
  }];
  const revisions = [...input.revisions, revision];
  const groups = [...input.groups, ...createdGroups];
  const targets = [...input.targets, ...createdTargets];
  validatePortfolioPlanCollections({ states, revisions, groups, targets, stocks: input.stocks, accounts: input.accounts });
  const writes: CollectionWrite[] = [
    { collection: "portfolio-plan-state", values: states },
    { collection: "portfolio-plan-revisions", values: revisions },
    { collection: "portfolio-allocation-groups", values: groups },
    { collection: "portfolio-allocation-targets", values: targets },
  ];
  for (const { collection, values } of writes) if (!validateStoredCollection(collection, values).valid) throw new Error("PORTFOLIO_PLAN_CANDIDATE_INVALID");
  return { states, revisions, groups, targets, revision, writes };
}

export type PortfolioContributionUpdate = { state: PortfolioPlanState; states: PortfolioPlanState[]; writes: CollectionWrite[] };

export function buildPortfolioContributionUpdate(input: {
  state: PortfolioPlanState | null;
  contributionAmountMinor: number;
  contributionCurrency: Currency;
  now?: string;
}): PortfolioContributionUpdate {
  const state: PortfolioPlanState = {
    id: portfolioPlanStateId,
    activeRevisionId: input.state?.activeRevisionId ?? null,
    contributionAmountMinor: input.contributionAmountMinor,
    contributionCurrency: input.contributionCurrency,
    updatedAt: input.now ?? new Date().toISOString(),
    repairDraft: input.state?.repairDraft ?? null,
  };
  validatePortfolioPlanStateRecord(state as unknown as Record<string, unknown>);
  const states = [state];
  if (!validateStoredCollection("portfolio-plan-state", states).valid) throw new Error("PORTFOLIO_CONTRIBUTION_CANDIDATE_INVALID");
  return { state, states, writes: [{ collection: "portfolio-plan-state", values: states }] };
}

export async function persistPortfolioPlanActivation(activation: PortfolioPlanActivation, save = saveCollectionsAtomically) {
  await save(activation.writes, { failurePolicy: "caller-managed" });
}

export async function persistPortfolioContributionUpdate(update: PortfolioContributionUpdate, save = saveCollectionsAtomically) {
  await save(update.writes, { failurePolicy: "caller-managed" });
}

function requiredId(ids: readonly string[], index: number, error: string) {
  const id = ids[index];
  if (!id?.trim()) throw new Error(error);
  return id;
}

function requiredMappedId(values: ReadonlyMap<string, string>, draftId: string) {
  const id = values.get(draftId);
  if (!id) throw new Error("PORTFOLIO_DRAFT_GROUP_MISSING");
  return id;
}
