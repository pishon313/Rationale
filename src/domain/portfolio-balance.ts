import { minorUnitsToMajor, type Currency, type RatesToKrw } from "./currency";
import type { TradingLedger } from "./trading-ledger";
import type { PortfolioBalancePolicy } from "@/features/portfolio-plan/types";
import type { Stock } from "@/features/stocks/types";

export const portfolioBalanceCategories = ["savings", "stocks", "bonds"] as const;
export type PortfolioBalanceCategory = (typeof portfolioBalanceCategories)[number];
export type PortfolioBalanceUnavailableReason = "ledgerError" | "missingStock" | "missingPrice" | "invalidFx" | "unreconciledCash" | "invalidValue" | null;

export type PortfolioBalanceCategorySnapshot = {
  category: PortfolioBalanceCategory;
  currentValueKrw: number | null;
  currentWeightBps: number | null;
};

export type PortfolioBalanceSnapshot = {
  available: boolean;
  unavailableReason: PortfolioBalanceUnavailableReason;
  totalValueKrw: number | null;
  categories: PortfolioBalanceCategorySnapshot[];
};

export type PortfolioContributionBalanceSuggestion = {
  source: "fixed" | "withinTolerance" | "balanced" | "unavailable";
  weightsBps: Record<PortfolioBalanceCategory, number>;
  rows: Array<{
    category: PortfolioBalanceCategory;
    baseWeightBps: number;
    targetWeightBps: number;
    currentWeightBps: number | null;
    suggestedWeightBps: number;
  }>;
};

export function buildPortfolioBalanceSnapshot(input: {
  ledger: TradingLedger;
  stocks: readonly Stock[];
  ratesToKrw: RatesToKrw;
  bondStockIds?: ReadonlySet<string>;
}): PortfolioBalanceSnapshot {
  const values = balanceRecord(0);
  const stockById = new Map(input.stocks.map((stock) => [stock.id, stock]));
  let reason: PortfolioBalanceUnavailableReason = input.ledger.errors.length ? "ledgerError" : null;

  if (!reason) for (const position of input.ledger.positions.filter((item) => item.quantity > 1e-8)) {
    const stock = stockById.get(position.stockId);
    if (!stock) { reason = "missingStock"; break; }
    if (!Number.isFinite(stock.currentPrice) || stock.currentPrice <= 0) { reason = "missingPrice"; break; }
    const rate = input.ratesToKrw[stock.currency];
    if (!Number.isFinite(rate) || rate <= 0) { reason = "invalidFx"; break; }
    const value = position.quantity * stock.currentPrice * rate;
    if (!Number.isFinite(value) || value < 0) { reason = "invalidValue"; break; }
    values[input.bondStockIds?.has(stock.id) || isBondAssetType(stock.assetType) ? "bonds" : "stocks"] += value;
  }

  if (!reason && input.ledger.cashBalances.some((cash) => !cash.isReconciled)) reason = "unreconciledCash";
  if (!reason) for (const cash of input.ledger.cashBalances) {
    const rate = input.ratesToKrw[cash.currency];
    if (!Number.isFinite(rate) || rate <= 0) { reason = "invalidFx"; break; }
    const value = cash.balance * rate;
    if (!Number.isFinite(value) || value < 0) { reason = "invalidValue"; break; }
    values.savings += value;
  }

  const total = reason ? null : portfolioBalanceCategories.reduce((sum, category) => sum + values[category], 0);
  if (total !== null && (!Number.isFinite(total) || total < 0)) reason = "invalidValue";
  if (reason) return unavailableSnapshot(reason);
  const safeTotal = total ?? 0;
  return {
    available: true,
    unavailableReason: null,
    totalValueKrw: safeTotal,
    categories: portfolioBalanceCategories.map((category) => ({
      category,
      currentValueKrw: values[category],
      currentWeightBps: safeTotal > 0 ? values[category] / safeTotal * 10000 : null,
    })),
  };
}

export function suggestContributionBalance(input: {
  snapshot: PortfolioBalanceSnapshot;
  policy: PortfolioBalancePolicy | null | undefined;
  baseWeightsBps: Record<PortfolioBalanceCategory, number>;
  contributionAmountMinor: number;
  contributionCurrency: Currency;
  ratesToKrw: RatesToKrw;
}): PortfolioContributionBalanceSuggestion {
  assertWeightRecord(input.baseWeightsBps);
  const policy = input.policy;
  const targetWeights = policy?.targetWeightsBps ?? input.baseWeightsBps;
  if (policy) assertWeightRecord(targetWeights);
  const fixed = (source: PortfolioContributionBalanceSuggestion["source"]): PortfolioContributionBalanceSuggestion => ({
    source,
    weightsBps: { ...input.baseWeightsBps },
    rows: portfolioBalanceCategories.map((category) => ({
      category,
      baseWeightBps: input.baseWeightsBps[category],
      targetWeightBps: targetWeights[category],
      currentWeightBps: input.snapshot.categories.find((row) => row.category === category)?.currentWeightBps ?? null,
      suggestedWeightBps: input.baseWeightsBps[category],
    })),
  });
  if (!policy || policy.mode === "fixed") return fixed("fixed");
  if (!input.snapshot.available || input.snapshot.totalValueKrw === null) return fixed("unavailable");
  const contributionRate = input.ratesToKrw[input.contributionCurrency];
  if (!Number.isFinite(contributionRate) || contributionRate <= 0) return fixed("unavailable");
  const contributionKrw = minorUnitsToMajor(input.contributionAmountMinor, input.contributionCurrency) * contributionRate;
  const total = input.snapshot.totalValueKrw;
  if (total <= 0 || contributionKrw <= 0) return fixed("fixed");
  const currentByCategory = new Map(input.snapshot.categories.map((row) => [row.category, row]));
  const outsideTolerance = portfolioBalanceCategories.some((category) => {
    const currentWeight = currentByCategory.get(category)?.currentWeightBps;
    return currentWeight !== null && currentWeight !== undefined && Math.abs(currentWeight - targetWeights[category]) > policy.toleranceBps;
  });
  if (!outsideTolerance) return fixed("withinTolerance");

  const postContributionTotal = total + contributionKrw;
  const gaps = balanceRecord(0);
  for (const category of portfolioBalanceCategories) {
    const currentValue = currentByCategory.get(category)?.currentValueKrw ?? 0;
    gaps[category] = Math.max(0, postContributionTotal * targetWeights[category] / 10000 - currentValue);
  }
  const gapTotal = portfolioBalanceCategories.reduce((sum, category) => sum + gaps[category], 0);
  if (gapTotal <= 0) return fixed("withinTolerance");
  const suggestedAmounts = balanceRecord(0);
  if (gapTotal >= contributionKrw) {
    for (const category of portfolioBalanceCategories) suggestedAmounts[category] = contributionKrw * gaps[category] / gapTotal;
  } else {
    const remaining = contributionKrw - gapTotal;
    for (const category of portfolioBalanceCategories) suggestedAmounts[category] = gaps[category] + remaining * input.baseWeightsBps[category] / 10000;
  }
  const weightsBps = scoresToBps(suggestedAmounts);
  return {
    source: "balanced",
    weightsBps,
    rows: portfolioBalanceCategories.map((category) => ({
      category,
      baseWeightBps: input.baseWeightsBps[category],
      targetWeightBps: targetWeights[category],
      currentWeightBps: currentByCategory.get(category)?.currentWeightBps ?? null,
      suggestedWeightBps: weightsBps[category],
    })),
  };
}

function scoresToBps(scores: Record<PortfolioBalanceCategory, number>) {
  const total = portfolioBalanceCategories.reduce((sum, category) => sum + scores[category], 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error("PORTFOLIO_BALANCE_SCORE_INVALID");
  const rows = portfolioBalanceCategories.map((category, order) => {
    const exact = scores[category] / total * 10000;
    const floor = Math.floor(exact);
    return { category, order, value: floor, remainder: exact - floor };
  });
  let remaining = 10000 - rows.reduce((sum, row) => sum + row.value, 0);
  const order = rows.slice().sort((left, right) => right.remainder - left.remainder || left.order - right.order);
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) order[index % order.length]!.value += 1;
  return Object.fromEntries(rows.map((row) => [row.category, row.value])) as Record<PortfolioBalanceCategory, number>;
}

function assertWeightRecord(weights: Record<PortfolioBalanceCategory, number>) {
  if (portfolioBalanceCategories.some((category) => !Number.isInteger(weights[category]) || weights[category] < 0 || weights[category] > 10000)) throw new Error("PORTFOLIO_BALANCE_WEIGHT_INVALID");
  if (portfolioBalanceCategories.reduce((sum, category) => sum + weights[category], 0) !== 10000) throw new Error("PORTFOLIO_BALANCE_WEIGHT_TOTAL_INVALID");
}

function balanceRecord(value: number): Record<PortfolioBalanceCategory, number> {
  return { savings: value, stocks: value, bonds: value };
}

function isBondAssetType(value: string) {
  const normalized = value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, "");
  return ["bond", "bonds", "fixedincome", "treasury", "채권", "국채"].some((label) => normalized.includes(label));
}

function unavailableSnapshot(reason: Exclude<PortfolioBalanceUnavailableReason, null>): PortfolioBalanceSnapshot {
  return { available: false, unavailableReason: reason, totalValueKrw: null, categories: portfolioBalanceCategories.map((category) => ({ category, currentValueKrw: null, currentWeightBps: null })) };
}
