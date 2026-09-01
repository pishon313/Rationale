import { describe, expect, it } from "vitest";
import { fallbackRatesToKrw } from "./currency";
import type { TradingLedger } from "./trading-ledger";
import { buildPortfolioStockAllocationSnapshot, suggestStockContributionBalance } from "./portfolio-stock-allocation";
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

describe("stock-bucket contribution balance assistance", () => {
  const targets = [{ stockId: "a", targetWeightBps: 7000 }, { stockId: "b", targetWeightBps: 3000 }];

  it("keeps the saved mix while holdings remain inside tolerance", () => {
    const suggestion = suggestStockContributionBalance({ snapshot: stockSnapshot(700, 300), targets, toleranceBps: 100, contributionValueKrw: 100 });
    expect(suggestion).toMatchObject({ source: "withinTolerance", targets: [{ stockId: "a", suggestedWeightBps: 7000 }, { stockId: "b", suggestedWeightBps: 3000 }] });
  });

  it("directs new stock money toward the underweight target without selling", () => {
    const suggestion = suggestStockContributionBalance({ snapshot: stockSnapshot(900, 100), targets, toleranceBps: 100, contributionValueKrw: 100 });
    expect(suggestion.source).toBe("balanced");
    expect(suggestion.targets.find((target) => target.stockId === "a")?.suggestedWeightBps).toBe(0);
    expect(suggestion.targets.find((target) => target.stockId === "b")?.suggestedWeightBps).toBe(10000);
  });

  it("accounts for an untracked holding while allocating only to configured targets", () => {
    const suggestion = suggestStockContributionBalance({ snapshot: stockSnapshot(600, 200, 200), targets, toleranceBps: 100, contributionValueKrw: 100 });
    expect(suggestion.source).toBe("balanced");
    expect(suggestion.targets.reduce((sum, target) => sum + target.suggestedWeightBps, 0)).toBe(10000);
    expect(suggestion.targets.find((target) => target.stockId === "a")?.suggestedWeightBps).toBeGreaterThan(suggestion.targets.find((target) => target.stockId === "b")?.suggestedWeightBps ?? 0);
  });

  it("falls back to target weights when valuation is unavailable", () => {
    const suggestion = suggestStockContributionBalance({ snapshot: { available: false, unavailableReason: "missingPrice", totalValueKrw: null, rows: [] }, targets, toleranceBps: 100, contributionValueKrw: 100 });
    expect(suggestion).toMatchObject({ source: "unavailable", targets: [{ suggestedWeightBps: 7000 }, { suggestedWeightBps: 3000 }] });
  });
});

function position(accountId: string, stockId: string, quantity: number): TradingLedger["positions"][number] {
  return { key: `${accountId}:${stockId}`, stockId, stockName: stockId, accountId, accountName: accountId, currency: "KRW", quantity, averagePrice: 0, investedAmount: 0, investedAmountKrw: 0, realizedProfit: 0, realizedProfitKrw: 0 };
}

function stockSnapshot(a: number, b: number, other = 0) {
  const total = a + b + other;
  return {
    available: true,
    unavailableReason: null,
    totalValueKrw: total,
    rows: [
      { stockId: "a", currentValueKrw: a, currentWeightBps: a / total * 10000 },
      { stockId: "b", currentValueKrw: b, currentWeightBps: b / total * 10000 },
      ...(other ? [{ stockId: "other", currentValueKrw: other, currentWeightBps: other / total * 10000 }] : []),
    ],
  };
}
