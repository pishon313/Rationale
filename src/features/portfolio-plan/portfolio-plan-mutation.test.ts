import { describe, expect, it, vi } from "vitest";
import type { InvestmentAccount } from "@/features/accounts/types";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { PortfolioAllocationGroup, PortfolioAllocationTarget, PortfolioPlanRevision, PortfolioPlanState } from "./types";
import { buildPortfolioContributionUpdate, buildPortfolioPlanActivation, persistPortfolioPlanActivation } from "./portfolio-plan-mutation";

const now = "2026-08-18T00:00:00.000Z";
const accounts: InvestmentAccount[] = [{ id: "a", name: "A", institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: true, archivedAt: null, memo: "", createdAt: now, updatedAt: now }];
const draftGroups = [{ id: "draft-g", name: "Stocks", targetWeightBps: 10000, sortOrder: 0 }];
const draftTargets = [{ groupId: "draft-g", accountId: "a", targetType: "stock" as const, stockId: sampleStocks[0].id, weightWithinGroupBps: 10000, sortOrder: 0 }];

describe("Portfolio plan mutations", () => {
  it("creates the first revision and atomically writes state, revision, Groups, and Targets", () => {
    const activation = buildPortfolioPlanActivation({ states: [], revisions: [], groups: [], targets: [], stocks: sampleStocks, accounts, draftGroups, draftTargets, contributionAmountMinor: 1_800_000, contributionCurrency: "KRW", thesis: "My thesis", changeNote: "", now, revisionId: "r1", groupIds: ["g1"], targetIds: ["t1"] });
    expect(activation.revision).toMatchObject({ revisionNumber: 1, basedOnRevisionId: null, activatedAt: now });
    expect(activation.states[0]).toMatchObject({ activeRevisionId: "r1", contributionAmountMinor: 1_800_000, contributionCurrency: "KRW" });
    expect(activation.groups[0]).toMatchObject({ id: "g1", revisionId: "r1", targetWeightBps: 10000 });
    expect(activation.targets[0]).toMatchObject({ id: "t1", revisionId: "r1", groupId: "g1", accountId: "a", weightWithinGroupBps: 10000 });
    expect(activation.writes.map((write) => write.collection)).toEqual(["portfolio-plan-state", "portfolio-plan-revisions", "portfolio-allocation-groups", "portfolio-allocation-targets"]);
  });

  it("creates a second revision while preserving all historical records", () => {
    const previous = firstPlan();
    const activation = buildPortfolioPlanActivation({ ...previous, stocks: sampleStocks, accounts, draftGroups, draftTargets: [{ ...draftTargets[0], stockId: sampleStocks[1].id }], contributionAmountMinor: 2_000_000, contributionCurrency: "KRW", thesis: "Second", changeNote: "Changed", now: "2026-08-19T00:00:00.000Z", revisionId: "r2", groupIds: ["g2"], targetIds: ["t2"] });
    expect(activation.revision).toMatchObject({ revisionNumber: 2, basedOnRevisionId: "r1" });
    expect(activation.revisions).toHaveLength(2);
    expect(activation.groups.slice(0, 1)).toEqual(previous.groups);
    expect(activation.targets.slice(0, 1)).toEqual(previous.targets);
  });

  it("updates only mutable Contribution state without creating a revision", () => {
    const previous = firstPlan();
    const update = buildPortfolioContributionUpdate({ state: previous.states[0] ?? null, contributionAmountMinor: 250_000, contributionCurrency: "USD", now: "2026-08-20T00:00:00.000Z" });
    expect(update.state).toMatchObject({ activeRevisionId: "r1", contributionAmountMinor: 250_000, contributionCurrency: "USD" });
    expect(update.writes).toEqual([{ collection: "portfolio-plan-state", values: update.states }]);
    expect(previous.revisions).toHaveLength(1);
  });

  it("does not change active input state when the atomic write fails", async () => {
    const previous = firstPlan();
    const activation = buildPortfolioPlanActivation({ ...previous, stocks: sampleStocks, accounts, draftGroups, draftTargets: [{ ...draftTargets[0], stockId: sampleStocks[1].id }], contributionAmountMinor: 2_000_000, contributionCurrency: "KRW", thesis: "", changeNote: "", now, revisionId: "r2", groupIds: ["g2"], targetIds: ["t2"] });
    const save = vi.fn().mockRejectedValue(new Error("disk full"));
    await expect(persistPortfolioPlanActivation(activation, save)).rejects.toThrow("disk full");
    expect(previous.states[0]?.activeRevisionId).toBe("r1");
    expect(previous.revisions).toHaveLength(1);
  });
});

function firstPlan(): { states: PortfolioPlanState[]; revisions: PortfolioPlanRevision[]; groups: PortfolioAllocationGroup[]; targets: PortfolioAllocationTarget[] } {
  const revisions: PortfolioPlanRevision[] = [{ id: "r1", revisionNumber: 1, basedOnRevisionId: null, thesis: "", changeNote: "", createdAt: now, activatedAt: now, updatedAt: now }];
  return {
    states: [{ id: "default", activeRevisionId: "r1", contributionAmountMinor: 1_800_000, contributionCurrency: "KRW", updatedAt: now }],
    revisions,
    groups: [{ id: "g1", revisionId: "r1", name: "Stocks", targetWeightBps: 10000, sortOrder: 0, updatedAt: now }],
    targets: [{ id: "t1", revisionId: "r1", groupId: "g1", accountId: "a", targetType: "stock", stockId: sampleStocks[0].id, weightWithinGroupBps: 10000, sortOrder: 0, updatedAt: now }],
  };
}
