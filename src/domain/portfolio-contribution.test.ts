import { describe, expect, it } from "vitest";
import { allocateMinorUnits, calculateContributionPlan } from "./portfolio-contribution";
import type { PortfolioAllocationGroup, PortfolioAllocationTarget } from "@/features/portfolio-plan/types";

const now = "2026-08-30T00:00:00.000Z";
const groups: PortfolioAllocationGroup[] = [
  { id: "stocks", revisionId: "r1", name: "Stocks", targetWeightBps: 6000, sortOrder: 0, updatedAt: now },
  { id: "savings", revisionId: "r1", name: "Savings", targetWeightBps: 4000, sortOrder: 1, updatedAt: now },
];
const targets: PortfolioAllocationTarget[] = [
  { id: "voo", revisionId: "r1", groupId: "stocks", accountId: "a", targetType: "stock", stockId: "voo", weightWithinGroupBps: 5000, sortOrder: 0, updatedAt: now },
  { id: "qqq", revisionId: "r1", groupId: "stocks", accountId: "a", targetType: "stock", stockId: "qqq", weightWithinGroupBps: 5000, sortOrder: 1, updatedAt: now },
  { id: "cash", revisionId: "r1", groupId: "savings", accountId: "b", targetType: "cash", stockId: null, weightWithinGroupBps: 10000, sortOrder: 0, updatedAt: now },
];

describe("Portfolio contribution allocation", () => {
  it("calculates nested Group and Target amounts with exact invariants", () => {
    const result = calculateContributionPlan({ contributionAmountMinor: 1_000_000, contributionCurrency: "KRW", groups, targets, revisionId: "r1" });
    expect(result.groups.map((group) => group.amountMinor)).toEqual([600_000, 400_000]);
    expect(result.targets.map((target) => target.amountMinor)).toEqual([300_000, 300_000, 400_000]);
    expect(result.targets[0]?.effectiveTargetWeightBps).toBe(3000);
    expect(result.groups.reduce((sum, group) => sum + group.amountMinor, 0)).toBe(1_000_000);
    expect(result.targets.reduce((sum, target) => sum + target.amountMinor, 0)).toBe(1_000_000);
  });

  it.each([["KRW", 1_001], ["USD", 10_001]] as const)("preserves zero and two-decimal %s minor units", (currency, amount) => {
    const result = calculateContributionPlan({ contributionAmountMinor: amount, contributionCurrency: currency, groups, targets, revisionId: "r1" });
    expect(result.targets.reduce((sum, target) => sum + target.amountMinor, 0)).toBe(amount);
  });

  it("keeps a fixed 0% category without requiring targets", () => {
    const fixedGroups: PortfolioAllocationGroup[] = [
      { id: "unused", revisionId: "r1", name: "Savings", targetWeightBps: 0, sortOrder: 0, updatedAt: now },
      ...groups.map((group) => ({ ...group, sortOrder: group.sortOrder + 1 })),
    ];
    const result = calculateContributionPlan({ contributionAmountMinor: 1_000_000, contributionCurrency: "KRW", groups: fixedGroups, targets, revisionId: "r1" });
    expect(result.groups[0]).toMatchObject({ groupId: "unused", amountMinor: 0, targets: [] });
    expect(result.targets.reduce((sum, target) => sum + target.amountMinor, 0)).toBe(1_000_000);
  });

  it("handles zero, one minor unit, and a very large safe integer", () => {
    expect(allocateMinorUnits(0, [{ id: "a", weightBps: 5000, sortOrder: 0 }, { id: "b", weightBps: 5000, sortOrder: 1 }])).toEqual([{ id: "a", amountMinor: 0 }, { id: "b", amountMinor: 0 }]);
    expect(allocateMinorUnits(1, [{ id: "a", weightBps: 5000, sortOrder: 0 }, { id: "b", weightBps: 5000, sortOrder: 1 }])).toEqual([{ id: "a", amountMinor: 1 }, { id: "b", amountMinor: 0 }]);
    const amount = Number.MAX_SAFE_INTEGER;
    expect(allocateMinorUnits(amount, [{ id: "a", weightBps: 3333, sortOrder: 0 }, { id: "b", weightBps: 3333, sortOrder: 1 }, { id: "c", weightBps: 3334, sortOrder: 2 }]).reduce((sum, row) => sum + row.amountMinor, 0)).toBe(amount);
  });

  it("breaks equal remainder ties by sortOrder and then id", () => {
    expect(allocateMinorUnits(2, [{ id: "z", weightBps: 3333, sortOrder: 1 }, { id: "b", weightBps: 3333, sortOrder: 0 }, { id: "a", weightBps: 3334, sortOrder: 0 }])).toEqual([
      { id: "z", amountMinor: 0 }, { id: "b", amountMinor: 1 }, { id: "a", amountMinor: 1 },
    ]);
  });
});
