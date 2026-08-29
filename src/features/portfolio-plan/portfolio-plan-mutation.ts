import type { Stock } from "@/features/stocks/types";
import { saveCollectionsAtomically, type CollectionWrite } from "@/lib/local-repository";
import { validateStoredCollection } from "@/lib/collection-validation";
import { portfolioPlanStateId, type PortfolioAllocationDraft, type PortfolioAllocationTarget, type PortfolioPlanRevision, type PortfolioPlanState } from "./types";
import { validatePortfolioPlanCollections } from "./validation";

export type PortfolioPlanActivation = {
  states: PortfolioPlanState[];
  revisions: PortfolioPlanRevision[];
  targets: PortfolioAllocationTarget[];
  revision: PortfolioPlanRevision;
  writes: CollectionWrite[];
};

export function buildPortfolioPlanActivation(input: {
  states: readonly PortfolioPlanState[];
  revisions: readonly PortfolioPlanRevision[];
  targets: readonly PortfolioAllocationTarget[];
  stocks: readonly Stock[];
  draftTargets: readonly PortfolioAllocationDraft[];
  targetAmountKrw: number;
  thesis: string;
  changeNote: string;
  now?: string;
  revisionId?: string;
  targetIds?: readonly string[];
}): PortfolioPlanActivation {
  const now = input.now ?? new Date().toISOString();
  const activeRevisionId = input.states[0]?.activeRevisionId ?? null;
  if (activeRevisionId !== null && !input.revisions.some((revision) => revision.id === activeRevisionId)) throw new Error("ACTIVE_PORTFOLIO_REVISION_MISSING");
  const sum = input.draftTargets.reduce((total, target) => total + target.targetWeightBps, 0);
  if (!input.draftTargets.length || sum !== 10000) throw new Error("PORTFOLIO_TARGET_TOTAL_INVALID");
  if (!Number.isSafeInteger(input.targetAmountKrw) || input.targetAmountKrw < 0) throw new Error("PORTFOLIO_TARGET_AMOUNT_INVALID");
  const revisionId = input.revisionId ?? crypto.randomUUID();
  const ids = input.targetIds ?? input.draftTargets.map(() => crypto.randomUUID());
  if (ids.length !== input.draftTargets.length) throw new Error("PORTFOLIO_TARGET_IDS_INVALID");
  const revision: PortfolioPlanRevision = {
    id: revisionId,
    revisionNumber: Math.max(0, ...input.revisions.map((value) => value.revisionNumber)) + 1,
    basedOnRevisionId: activeRevisionId,
    targetAmountKrw: input.targetAmountKrw,
    thesis: input.thesis.trim(),
    changeNote: input.changeNote.trim(),
    createdAt: now,
    activatedAt: now,
    updatedAt: now,
  };
  const createdTargets = input.draftTargets.map((target, index): PortfolioAllocationTarget => ({ ...target, id: ids[index], revisionId, sortOrder: index, updatedAt: now }));
  const states: PortfolioPlanState[] = [{ id: portfolioPlanStateId, activeRevisionId: revisionId, updatedAt: now }];
  const revisions = [...input.revisions, revision];
  const targets = [...input.targets, ...createdTargets];
  validatePortfolioPlanCollections({ states, revisions, targets, stocks: input.stocks });
  for (const [collection, values] of [["portfolio-plan-state", states], ["portfolio-plan-revisions", revisions], ["portfolio-allocation-targets", targets]] as const) {
    if (!validateStoredCollection(collection, values).valid) throw new Error("PORTFOLIO_PLAN_CANDIDATE_INVALID");
  }
  return { states, revisions, targets, revision, writes: [
    { collection: "portfolio-plan-state", values: states },
    { collection: "portfolio-plan-revisions", values: revisions },
    { collection: "portfolio-allocation-targets", values: targets },
  ] };
}

export async function persistPortfolioPlanActivation(activation: PortfolioPlanActivation, save = saveCollectionsAtomically) {
  await save(activation.writes, { failurePolicy: "caller-managed" });
}
