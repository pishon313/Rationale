import { currencies, type Currency } from "./currency";
import type { PortfolioAllocationGroup, PortfolioAllocationTarget } from "@/features/portfolio-plan/types";

export type MinorUnitWeight = { id: string; weightBps: number; sortOrder: number };
export type MinorUnitAllocation = { id: string; amountMinor: number };

export type ContributionTargetAmount = {
  targetId: string;
  groupId: string;
  targetType: "stock" | "cash";
  stockId: string | null;
  accountId: string;
  effectiveTargetWeightBps: number;
  amountMinor: number;
};

export type ContributionGroupAmount = {
  groupId: string;
  name: string;
  targetWeightBps: number;
  amountMinor: number;
  targets: ContributionTargetAmount[];
};

export type ContributionPlanCalculation = {
  contributionAmountMinor: number;
  contributionCurrency: Currency;
  groups: ContributionGroupAmount[];
  targets: ContributionTargetAmount[];
};

export function allocateMinorUnits(amountMinor: number, weights: readonly MinorUnitWeight[]): MinorUnitAllocation[] {
  assertAmount(amountMinor);
  if (!weights.length) throw new Error("MINOR_UNIT_WEIGHTS_EMPTY");
  if (weights.some((item) => !item.id.trim() || !Number.isInteger(item.weightBps) || item.weightBps < 0 || item.weightBps > 10000 || !Number.isInteger(item.sortOrder) || item.sortOrder < 0)) throw new Error("MINOR_UNIT_WEIGHT_INVALID");
  if (new Set(weights.map((item) => item.id)).size !== weights.length) throw new Error("MINOR_UNIT_WEIGHT_ID_DUPLICATE");
  if (weights.reduce((sum, item) => sum + item.weightBps, 0) !== 10000) throw new Error("MINOR_UNIT_WEIGHT_TOTAL_INVALID");

  const amount = BigInt(amountMinor);
  const denominator = 10000n;
  const rows = weights.map((item) => {
    const numerator = amount * BigInt(item.weightBps);
    return { ...item, amount: numerator / denominator, remainder: numerator % denominator };
  });
  let remaining = amount - rows.reduce((sum, item) => sum + item.amount, 0n);
  const remainderOrder = rows.slice().sort((left, right) => {
    if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1;
    return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id);
  });
  for (let index = 0; remaining > 0n; index += 1, remaining -= 1n) {
    const row = remainderOrder[index];
    if (!row) throw new Error("MINOR_UNIT_REMAINDER_INVALID");
    row.amount += 1n;
  }
  const amounts = new Map(rows.map((item) => [item.id, Number(item.amount)]));
  return weights.map((item) => ({ id: item.id, amountMinor: amounts.get(item.id) ?? 0 }));
}

export function calculateContributionPlan(input: {
  contributionAmountMinor: number;
  contributionCurrency: Currency;
  groups: readonly PortfolioAllocationGroup[];
  targets: readonly PortfolioAllocationTarget[];
  revisionId: string;
}): ContributionPlanCalculation {
  assertAmount(input.contributionAmountMinor);
  if (!currencies.includes(input.contributionCurrency)) throw new Error("CONTRIBUTION_CURRENCY_INVALID");
  const groups = input.groups.filter((group) => group.revisionId === input.revisionId).slice().sort(byOrder);
  const targets = input.targets.filter((target) => target.revisionId === input.revisionId);
  const groupAmounts = allocateMinorUnits(input.contributionAmountMinor, groups.map((group) => ({ id: group.id, weightBps: group.targetWeightBps, sortOrder: group.sortOrder })));
  const amountByGroup = new Map(groupAmounts.map((item) => [item.id, item.amountMinor]));
  const calculatedGroups = groups.map((group): ContributionGroupAmount => {
    const groupTargets = targets.filter((target) => target.groupId === group.id).slice().sort(byOrder);
    const amountMinor = amountByGroup.get(group.id) ?? 0;
    const targetAmounts = allocateMinorUnits(amountMinor, groupTargets.map((target) => ({ id: target.id, weightBps: target.weightWithinGroupBps, sortOrder: target.sortOrder })));
    const amountByTarget = new Map(targetAmounts.map((item) => [item.id, item.amountMinor]));
    return {
      groupId: group.id,
      name: group.name,
      targetWeightBps: group.targetWeightBps,
      amountMinor,
      targets: groupTargets.map((target) => ({
        targetId: target.id,
        groupId: group.id,
        targetType: target.targetType,
        stockId: target.stockId,
        accountId: target.accountId,
        effectiveTargetWeightBps: group.targetWeightBps * target.weightWithinGroupBps / 10000,
        amountMinor: amountByTarget.get(target.id) ?? 0,
      })),
    };
  });
  return { contributionAmountMinor: input.contributionAmountMinor, contributionCurrency: input.contributionCurrency, groups: calculatedGroups, targets: calculatedGroups.flatMap((group) => group.targets) };
}

function assertAmount(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("CONTRIBUTION_AMOUNT_INVALID");
}
function byOrder(left: { sortOrder: number; id: string }, right: { sortOrder: number; id: string }) {
  return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id);
}
