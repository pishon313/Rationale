import type { RatesToKrw } from "./currency";
import { isBondAssetType, type PortfolioBalanceUnavailableReason } from "./portfolio-balance";
import type { TradingLedger } from "./trading-ledger";
import type { Stock } from "@/features/stocks/types";

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
    if (input.bondStockIds?.has(stock.id) || isBondAssetType(stock.assetType)) continue;
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

function unavailable(reason: Exclude<PortfolioBalanceUnavailableReason, null>): PortfolioStockAllocationSnapshot {
  return { available: false, unavailableReason: reason, totalValueKrw: null, rows: [] };
}
