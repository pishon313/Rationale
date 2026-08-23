import type { RatesToKrw } from "./currency";
import type { TradingLedger } from "./trading-ledger";
import type { PortfolioAllocationTarget, PortfolioPlanRevision } from "@/features/portfolio-plan/types";
import type { Stock } from "@/features/stocks/types";

export type PortfolioAllocationComparison = {
  targetType: "stock" | "cash";
  stockId: string | null;
  targetWeightBps: number;
  currentWeight: number | null;
  driftPercentagePoints: number | null;
  currentValueKrw: number | null;
  targetValueKrw: number | null;
  status: "onPlan" | "outsidePlan" | "unavailable";
};

export type PortfolioPlanComparison = {
  active: boolean;
  valuationAvailable: boolean;
  unavailableReason: "noActivePlan" | "ledgerError" | "missingStock" | "missingPrice" | "invalidFx" | "unreconciledCash" | "invalidValue" | null;
  totalCurrentValueKrw: number | null;
  targetTotalValueKrw: number | null;
  allocations: PortfolioAllocationComparison[];
};

export function comparePortfolioPlan(input: {
  revision: PortfolioPlanRevision | null;
  targets: readonly PortfolioAllocationTarget[];
  ledger: TradingLedger;
  stocks: readonly Stock[];
  ratesToKrw: RatesToKrw;
}): PortfolioPlanComparison {
  if (!input.revision) return { active: false, valuationAvailable: false, unavailableReason: "noActivePlan", totalCurrentValueKrw: null, targetTotalValueKrw: null, allocations: [] };
  const targets = input.targets.filter((target) => target.revisionId === input.revision?.id).sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  const targetByStock = new Map(targets.filter((target): target is Extract<PortfolioAllocationTarget, { targetType: "stock" }> => target.targetType === "stock").map((target) => [target.stockId, target]));
  const cashTarget = targets.find((target) => target.targetType === "cash");
  const stocks = new Map(input.stocks.map((stock) => [stock.id, stock]));
  const positionValues = new Map<string, number>();
  let reason: PortfolioPlanComparison["unavailableReason"] = input.ledger.errors.length ? "ledgerError" : null;
  for (const position of input.ledger.positions.filter((value) => value.quantity > 1e-8)) {
    if (reason) break;
    const stock = stocks.get(position.stockId);
    if (!stock) { reason = "missingStock"; break; }
    if (!Number.isFinite(stock.currentPrice) || stock.currentPrice <= 0) { reason = "missingPrice"; break; }
    const rate = input.ratesToKrw[stock.currency];
    if (!Number.isFinite(rate) || rate <= 0) { reason = "invalidFx"; break; }
    const value = position.quantity * stock.currentPrice * rate;
    if (!Number.isFinite(value) || value < 0) { reason = "invalidValue"; break; }
    positionValues.set(stock.id, (positionValues.get(stock.id) ?? 0) + value);
  }
  if (!reason && input.ledger.cashBalances.some((cash) => !cash.isReconciled)) reason = "unreconciledCash";
  let cashValue = 0;
  if (!reason) for (const cash of input.ledger.cashBalances) {
    const rate = input.ratesToKrw[cash.currency];
    if (!Number.isFinite(rate) || rate <= 0) { reason = "invalidFx"; break; }
    const value = cash.balance * rate;
    if (!Number.isFinite(value)) { reason = "invalidValue"; break; }
    cashValue += value;
  }
  const total = reason ? null : [...positionValues.values()].reduce((sum, value) => sum + value, cashValue);
  if (total !== null && (!Number.isFinite(total) || total < 0)) reason = "invalidValue";
  const available = !reason;
  const denominator = available && total !== null && total > 0 ? total : null;
  const storedTargetTotal = input.revision.targetAmountKrw;
  const targetTotal = typeof storedTargetTotal === "number" && Number.isFinite(storedTargetTotal) && storedTargetTotal >= 0 ? storedTargetTotal : available ? total : null;
  const allocations: PortfolioAllocationComparison[] = targets.map((target) => row(target.targetType, target.stockId, target.targetWeightBps, target.targetType === "cash" ? cashValue : positionValues.get(target.stockId) ?? 0, available, denominator, targetTotal));
  for (const [stockId, value] of positionValues) if (!targetByStock.has(stockId)) allocations.push(row("stock", stockId, 0, value, available, denominator, targetTotal, true));
  if (!cashTarget && cashValue !== 0) allocations.push(row("cash", null, 0, cashValue, available, denominator, targetTotal, true));
  return { active: true, valuationAvailable: available, unavailableReason: reason, totalCurrentValueKrw: available ? total : null, targetTotalValueKrw: targetTotal, allocations };
}

function row(targetType: "stock" | "cash", stockId: string | null, targetWeightBps: number, value: number, available: boolean, denominator: number | null, targetTotal: number | null, outside = false): PortfolioAllocationComparison {
  const currentWeight = available && denominator !== null ? value / denominator * 100 : null;
  const targetPercentage = targetWeightBps / 100;
  return {
    targetType, stockId, targetWeightBps,
    currentWeight,
    driftPercentagePoints: currentWeight === null ? null : currentWeight - targetPercentage,
    currentValueKrw: available ? value : null,
    targetValueKrw: targetTotal !== null ? targetTotal * targetWeightBps / 10000 : null,
    status: available ? outside ? "outsidePlan" : "onPlan" : "unavailable",
  };
}
