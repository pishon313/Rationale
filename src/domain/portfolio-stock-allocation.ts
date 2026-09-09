import type { RatesToKrw } from "./currency";
import type { PortfolioBalanceUnavailableReason } from "./portfolio-balance";
import type { TradingLedger } from "./trading-ledger";
import type { Stock } from "@/features/stocks/types";
import { isBondStock } from "@/features/stocks/asset-class";

export type PortfolioStockAllocationRow = {
  stockId: string;
  currentValueKrw: number;
  currentWeightBps: number;
};

export type PortfolioStockAllocationSnapshot = {
  available: boolean;
  unavailableReason: PortfolioBalanceUnavailableReason;
  totalValueKrw: number | null;
  rows: PortfolioStockAllocationRow[];
};

export type PortfolioStockContributionSuggestion = {
  source: "fixed" | "withinTolerance" | "balanced" | "unavailable";
  targets: Array<{
    stockId: string;
    targetWeightBps: number;
    currentWeightBps: number | null;
    suggestedWeightBps: number;
  }>;
};

export function invalidPortfolioStockTargetIds(targets: readonly { stockId: string }[] | null | undefined, stocks: readonly Stock[]) {
  if (!targets?.length) return [];
  const activeIds = new Set(stocks.filter((stock) => !stock.deletedAt).map((stock) => stock.id));
  return targets.map((target) => target.stockId).filter((stockId) => !activeIds.has(stockId));
}

/** Values each held equity inside the stock bucket. Bond-like positions are intentionally excluded. */
export function buildPortfolioStockAllocationSnapshot(input: {
  ledger: TradingLedger;
  stocks: readonly Stock[];
  ratesToKrw: RatesToKrw;
  bondStockIds?: ReadonlySet<string>;
}): PortfolioStockAllocationSnapshot {
  if (input.ledger.errors.length) return unavailable("ledgerError");
  const stockById = new Map(input.stocks.map((stock) => [stock.id, stock]));
  const values = new Map<string, number>();
  for (const position of input.ledger.positions.filter((item) => item.quantity > 1e-8)) {
    const stock = stockById.get(position.stockId);
    if (!stock) return unavailable("missingStock");
    if (input.bondStockIds?.has(stock.id) || isBondStock(stock)) continue;
    if (!Number.isFinite(stock.currentPrice) || stock.currentPrice <= 0) return unavailable("missingPrice");
    const rate = input.ratesToKrw[stock.currency];
    if (!Number.isFinite(rate) || rate <= 0) return unavailable("invalidFx");
    const value = position.quantity * stock.currentPrice * rate;
    if (!Number.isFinite(value) || value < 0) return unavailable("invalidValue");
    values.set(stock.id, (values.get(stock.id) ?? 0) + value);
  }
  const totalValueKrw = [...values.values()].reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(totalValueKrw) || totalValueKrw < 0) return unavailable("invalidValue");
  return {
    available: true,
    unavailableReason: null,
    totalValueKrw,
    rows: [...values.entries()].map(([stockId, currentValueKrw]) => ({
      stockId,
      currentValueKrw,
      currentWeightBps: totalValueKrw > 0 ? currentValueKrw / totalValueKrw * 10000 : 0,
    })).sort((left, right) => right.currentValueKrw - left.currentValueKrw || left.stockId.localeCompare(right.stockId)),
  };
}

/**
 * Splits only the new money assigned to the Stocks bucket. Existing holdings are
 * never sold: underweight targets receive the new money first and any remainder
 * falls back to the saved target mix.
 */
export function suggestStockContributionBalance(input: {
  snapshot: PortfolioStockAllocationSnapshot;
  targets: readonly { stockId: string; targetWeightBps: number }[];
  toleranceBps: number;
  contributionValueKrw: number;
}): PortfolioStockContributionSuggestion {
  assertTargets(input.targets);
  if (!Number.isInteger(input.toleranceBps) || input.toleranceBps < 0 || input.toleranceBps > 10000) throw new Error("PORTFOLIO_STOCK_TOLERANCE_INVALID");
  if (!Number.isFinite(input.contributionValueKrw) || input.contributionValueKrw < 0) throw new Error("PORTFOLIO_STOCK_CONTRIBUTION_INVALID");

  const currentByStockId = new Map(input.snapshot.rows.map((row) => [row.stockId, row]));
  const fixed = (source: PortfolioStockContributionSuggestion["source"]): PortfolioStockContributionSuggestion => ({
    source,
    targets: input.targets.map((target) => ({
      ...target,
      currentWeightBps: input.snapshot.available ? currentByStockId.get(target.stockId)?.currentWeightBps ?? 0 : null,
      suggestedWeightBps: target.targetWeightBps,
    })),
  });
  if (!input.snapshot.available || input.snapshot.totalValueKrw === null) return fixed("unavailable");
  if (input.snapshot.totalValueKrw <= 0 || input.contributionValueKrw <= 0) return fixed("fixed");

  const targetIds = new Set(input.targets.map((target) => target.stockId));
  const trackedOutside = input.targets.some((target) => Math.abs((currentByStockId.get(target.stockId)?.currentWeightBps ?? 0) - target.targetWeightBps) > input.toleranceBps);
  const untrackedOutside = input.snapshot.rows.some((row) => !targetIds.has(row.stockId) && row.currentWeightBps > input.toleranceBps);
  if (!trackedOutside && !untrackedOutside) return fixed("withinTolerance");

  const postContributionTotal = input.snapshot.totalValueKrw + input.contributionValueKrw;
  const gaps = input.targets.map((target) => ({
    stockId: target.stockId,
    targetWeightBps: target.targetWeightBps,
    value: Math.max(0, postContributionTotal * target.targetWeightBps / 10000 - (currentByStockId.get(target.stockId)?.currentValueKrw ?? 0)),
  }));
  const gapTotal = gaps.reduce((sum, row) => sum + row.value, 0);
  if (gapTotal <= 0) return fixed("withinTolerance");

  const scores = gaps.map((gap) => ({
    stockId: gap.stockId,
    value: gapTotal >= input.contributionValueKrw
      ? input.contributionValueKrw * gap.value / gapTotal
      : gap.value + (input.contributionValueKrw - gapTotal) * gap.targetWeightBps / 10000,
  }));
  const suggestedByStockId = scoresToBps(scores);
  return {
    source: "balanced",
    targets: input.targets.map((target) => ({
      ...target,
      currentWeightBps: currentByStockId.get(target.stockId)?.currentWeightBps ?? 0,
      suggestedWeightBps: suggestedByStockId.get(target.stockId) ?? 0,
    })),
  };
}

function unavailable(reason: Exclude<PortfolioBalanceUnavailableReason, null>): PortfolioStockAllocationSnapshot {
  return { available: false, unavailableReason: reason, totalValueKrw: null, rows: [] };
}

function assertTargets(targets: readonly { stockId: string; targetWeightBps: number }[]) {
  if (!targets.length || new Set(targets.map((target) => target.stockId)).size !== targets.length) throw new Error("PORTFOLIO_STOCK_TARGET_INVALID");
  if (targets.some((target) => !target.stockId.trim() || !Number.isInteger(target.targetWeightBps) || target.targetWeightBps < 0 || target.targetWeightBps > 10000)) throw new Error("PORTFOLIO_STOCK_TARGET_INVALID");
  if (targets.reduce((sum, target) => sum + target.targetWeightBps, 0) !== 10000) throw new Error("PORTFOLIO_STOCK_TARGET_TOTAL_INVALID");
}

function scoresToBps(scores: readonly { stockId: string; value: number }[]) {
  const total = scores.reduce((sum, row) => sum + row.value, 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error("PORTFOLIO_STOCK_SCORE_INVALID");
  const rows = scores.map((row, order) => {
    const exact = row.value / total * 10000;
    const value = Math.floor(exact);
    return { ...row, order, value, remainder: exact - value };
  });
  let remaining = 10000 - rows.reduce((sum, row) => sum + row.value, 0);
  const order = rows.slice().sort((left, right) => right.remainder - left.remainder || left.order - right.order || left.stockId.localeCompare(right.stockId));
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) order[index % order.length]!.value += 1;
  return new Map(rows.map((row) => [row.stockId, row.value]));
}
