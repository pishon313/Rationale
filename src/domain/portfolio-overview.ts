import type { RatesToKrw } from "./currency";
import type { TradingLedger } from "./trading-ledger";
import type { PortfolioAllocationGroup, PortfolioAllocationTarget, PortfolioPlanRevision } from "@/features/portfolio-plan/types";
import type { Stock } from "@/features/stocks/types";

export type PortfolioComparisonStatus = "onPlan" | "outsidePlan" | "unavailable";
export type PortfolioOverviewUnavailableReason = "noActivePlan" | "ledgerError" | "missingStock" | "missingPrice" | "invalidFx" | "unreconciledCash" | "invalidValue" | null;

export type PortfolioTargetComparison = {
  targetId: string | null;
  groupId: string | null;
  targetType: "stock" | "cash";
  stockId: string | null;
  accountId: string | null;
  targetWeight: number;
  currentWeight: number | null;
  driftPercentagePoints: number | null;
  targetValueKrw: number | null;
  currentValueKrw: number | null;
  status: PortfolioComparisonStatus;
};

export type PortfolioGroupComparison = {
  groupId: string | null;
  name: string;
  targetWeight: number;
  currentWeight: number | null;
  driftPercentagePoints: number | null;
  targetValueKrw: number | null;
  currentValueKrw: number | null;
  status: PortfolioComparisonStatus;
  targets: PortfolioTargetComparison[];
};

export type PortfolioOverviewComparison = {
  active: boolean;
  valuationAvailable: boolean;
  unavailableReason: PortfolioOverviewUnavailableReason;
  totalCurrentValueKrw: number | null;
  groups: PortfolioGroupComparison[];
};

export function comparePortfolioPlanByGroup(input: {
  revision: PortfolioPlanRevision | null;
  groups: readonly PortfolioAllocationGroup[];
  targets: readonly PortfolioAllocationTarget[];
  ledger: TradingLedger;
  stocks: readonly Stock[];
  ratesToKrw: RatesToKrw;
}): PortfolioOverviewComparison {
  if (!input.revision) return { active: false, valuationAvailable: false, unavailableReason: "noActivePlan", totalCurrentValueKrw: null, groups: [] };
  const groups = input.groups.filter((group) => group.revisionId === input.revision?.id).slice().sort(byOrder);
  const targets = input.targets.filter((target) => target.revisionId === input.revision?.id).slice().sort(byOrder);
  const stockById = new Map(input.stocks.map((stock) => [stock.id, stock]));
  const stockValues = new Map<string, number>();
  const cashValues = new Map<string, number>();
  let reason: PortfolioOverviewUnavailableReason = input.ledger.errors.length ? "ledgerError" : null;
  if (!reason && targets.some((target) => target.targetType === "stock" && !stockById.has(target.stockId))) reason = "missingStock";

  for (const position of input.ledger.positions.filter((item) => item.quantity > 1e-8)) {
    if (reason) break;
    const stock = stockById.get(position.stockId);
    if (!stock) { reason = "missingStock"; break; }
    if (!Number.isFinite(stock.currentPrice) || stock.currentPrice <= 0) { reason = "missingPrice"; break; }
    const rate = input.ratesToKrw[stock.currency];
    if (!Number.isFinite(rate) || rate <= 0) { reason = "invalidFx"; break; }
    const value = position.quantity * stock.currentPrice * rate;
    if (!Number.isFinite(value) || value < 0) { reason = "invalidValue"; break; }
    stockValues.set(stock.id, (stockValues.get(stock.id) ?? 0) + value);
  }
  if (!reason && input.ledger.cashBalances.some((cash) => !cash.isReconciled)) reason = "unreconciledCash";
  if (!reason) for (const cash of input.ledger.cashBalances) {
    const rate = input.ratesToKrw[cash.currency];
    if (!Number.isFinite(rate) || rate <= 0) { reason = "invalidFx"; break; }
    const value = cash.balance * rate;
    if (!Number.isFinite(value)) { reason = "invalidValue"; break; }
    cashValues.set(cash.accountId, (cashValues.get(cash.accountId) ?? 0) + value);
  }
  const calculatedTotal = reason ? null : [...stockValues.values(), ...cashValues.values()].reduce((sum, value) => sum + value, 0);
  if (calculatedTotal !== null && (!Number.isFinite(calculatedTotal) || calculatedTotal < 0)) reason = "invalidValue";
  const available = reason === null;
  const total = available ? calculatedTotal : null;
  const denominator = total !== null && total > 0 ? total : null;
  const targetStockIds = new Set(targets.filter((target) => target.targetType === "stock").map((target) => target.stockId));
  const targetCashAccounts = new Set(targets.filter((target) => target.targetType === "cash" && target.accountId !== null).map((target) => target.accountId));

  const comparisons = groups.map((group): PortfolioGroupComparison => {
    const groupTargets = targets.filter((target) => target.groupId === group.id);
    const targetRows = groupTargets.map((target) => {
      const targetPercentage = group.targetWeightBps / 100 * target.weightWithinGroupBps / 10000;
      const value = target.targetType === "cash" ? target.accountId ? cashValues.get(target.accountId) ?? 0 : 0 : stockValues.get(target.stockId) ?? 0;
      return comparisonTarget(target, targetPercentage, value, available, denominator, total, "onPlan");
    });
    const currentValue = available ? targetRows.reduce((sum, row) => sum + (row.currentValueKrw ?? 0), 0) : null;
    return comparisonGroup(group.id, group.name, group.targetWeightBps / 100, currentValue, available, denominator, total, "onPlan", targetRows);
  });
  const outsideTargets: PortfolioTargetComparison[] = [];
  for (const [stockId, value] of stockValues) if (!targetStockIds.has(stockId)) outsideTargets.push(comparisonTarget({ id: `outside-stock:${stockId}`, groupId: "", targetType: "stock", stockId, accountId: "", weightWithinGroupBps: 0, revisionId: input.revision.id, sortOrder: outsideTargets.length, updatedAt: input.revision.updatedAt }, 0, value, available, denominator, total, "outsidePlan"));
  for (const [accountId, value] of cashValues) if (!targetCashAccounts.has(accountId)) outsideTargets.push(comparisonTarget({ id: `outside-cash:${accountId}`, groupId: "", targetType: "cash", stockId: null, accountId, weightWithinGroupBps: 0, revisionId: input.revision.id, sortOrder: outsideTargets.length, updatedAt: input.revision.updatedAt }, 0, value, available, denominator, total, "outsidePlan"));
  const outside = buildOutsidePlanGroup(outsideTargets, available, denominator, total);
  if (outside) comparisons.push(outside);
  return { active: true, valuationAvailable: available, unavailableReason: reason, totalCurrentValueKrw: total, groups: comparisons };
}

export function buildOutsidePlanGroup(targets: readonly PortfolioTargetComparison[], available: boolean, denominator: number | null, total: number | null): PortfolioGroupComparison | null {
  if (!targets.length) return null;
  const currentValue = available ? targets.reduce((sum, target) => sum + (target.currentValueKrw ?? 0), 0) : null;
  return comparisonGroup(null, "Outside Current Plan", 0, currentValue, available, denominator, total, "outsidePlan", [...targets]);
}

function comparisonTarget(target: PortfolioAllocationTarget, targetWeight: number, value: number, available: boolean, denominator: number | null, total: number | null, status: Exclude<PortfolioComparisonStatus, "unavailable">): PortfolioTargetComparison {
  const currentWeight = available && denominator !== null ? value / denominator * 100 : null;
  return {
    targetId: status === "outsidePlan" ? null : target.id,
    groupId: status === "outsidePlan" ? null : target.groupId,
    targetType: target.targetType,
    stockId: target.stockId,
    accountId: target.accountId || null,
    targetWeight,
    currentWeight,
    driftPercentagePoints: currentWeight === null ? null : currentWeight - targetWeight,
    targetValueKrw: total === null ? null : total * targetWeight / 100,
    currentValueKrw: available ? value : null,
    status: available ? status : "unavailable",
  };
}

function comparisonGroup(groupId: string | null, name: string, targetWeight: number, currentValue: number | null, available: boolean, denominator: number | null, total: number | null, status: Exclude<PortfolioComparisonStatus, "unavailable">, targets: PortfolioTargetComparison[]): PortfolioGroupComparison {
  const currentWeight = available && denominator !== null && currentValue !== null ? currentValue / denominator * 100 : null;
  return {
    groupId,
    name,
    targetWeight,
    currentWeight,
    driftPercentagePoints: currentWeight === null ? null : currentWeight - targetWeight,
    targetValueKrw: total === null ? null : total * targetWeight / 100,
    currentValueKrw: available ? currentValue : null,
    status: available ? status : "unavailable",
    targets,
  };
}

function byOrder(left: { sortOrder: number; id: string }, right: { sortOrder: number; id: string }) {
  return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id);
}
