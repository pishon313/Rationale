import { describe, expect, it } from "vitest";
import { fallbackRatesToKrw } from "./currency";
import type { TradingLedger } from "./trading-ledger";
import { buildPortfolioStockAllocationSnapshot } from "./portfolio-stock-allocation";
import { sampleStocks } from "@/features/stocks/sample-data";

const emptyLedger: TradingLedger = { positions: [], cashBalances: [], cycles: [], calculations: {}, errors: [], totalRealizedKrw: 0 };

describe("portfolio stock allocation snapshot", () => {
  it("aggregates positions across accounts into within-stock weights", () => {
    const stock = sampleStocks[0]!;
    const other = sampleStocks[1]!;
    const snapshot = buildPortfolioStockAllocationSnapshot({
      ledger: { ...emptyLedger, positions: [position("a", stock.id, 2), position("b", stock.id, 1), position("a", other.id, 1)] },
      stocks: sampleStocks,
      ratesToKrw: fallbackRatesToKrw,
    });
    const stockValue = stock.currentPrice * 3;
    const otherValue = other.currentPrice;
    expect(snapshot.available).toBe(true);
    expect(snapshot.totalValueKrw).toBe(stockValue + otherValue);
    expect(snapshot.rows.find((row) => row.stockId === stock.id)?.currentWeightBps).toBeCloseTo(stockValue / (stockValue + otherValue) * 10000);
  });

  it("excludes bond positions and reports unavailable equity prices", () => {
    const bond = { ...sampleStocks[1]!, assetType: "채권" };
    expect(buildPortfolioStockAllocationSnapshot({ ledger: { ...emptyLedger, positions: [position("a", bond.id, 1)] }, stocks: [bond], ratesToKrw: fallbackRatesToKrw })).toMatchObject({ available: true, totalValueKrw: 0, rows: [] });
    const missingPrice = { ...sampleStocks[0]!, currentPrice: 0 };
    expect(buildPortfolioStockAllocationSnapshot({ ledger: { ...emptyLedger, positions: [position("a", missingPrice.id, 1)] }, stocks: [missingPrice], ratesToKrw: fallbackRatesToKrw })).toMatchObject({ available: false, unavailableReason: "missingPrice" });
  });
});

function position(accountId: string, stockId: string, quantity: number): TradingLedger["positions"][number] {
  return { key: `${accountId}:${stockId}`, stockId, stockName: stockId, accountId, accountName: accountId, currency: "KRW", quantity, averagePrice: 0, investedAmount: 0, investedAmountKrw: 0, realizedProfit: 0, realizedProfitKrw: 0 };
}
