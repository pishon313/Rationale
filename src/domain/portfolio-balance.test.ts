import { describe, expect, it } from "vitest";
import { fallbackRatesToKrw } from "./currency";
import { buildPortfolioBalanceSnapshot, suggestContributionBalance } from "./portfolio-balance";
import type { TradingLedger } from "./trading-ledger";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { PortfolioBalancePolicy } from "@/features/portfolio-plan/types";

const stock = { ...sampleStocks[0]!, id: "stock", currentPrice: 100, currency: "KRW" as const };
const bond = { ...sampleStocks[1]!, id: "bond", currentPrice: 100, currency: "KRW" as const };
const policy: PortfolioBalancePolicy = { version: 1, mode: "balanceAssist", targetWeightsBps: { savings: 3000, stocks: 6000, bonds: 1000 }, toleranceBps: 0, updatedAt: "2026-08-31T00:00:00.000Z" };
const base = { savings: 3000, stocks: 6000, bonds: 1000 };

describe("portfolio balance snapshot", () => {
  it("classifies cash as savings and explicitly mapped securities as bonds", () => {
    const snapshot = buildPortfolioBalanceSnapshot({
      ledger: ledger([
        position("stock", 6),
        position("bond", 1),
      ], [{ accountId: "a", accountName: "A", currency: "KRW", balance: 300, isReconciled: true }]),
      stocks: [stock, bond],
      ratesToKrw: fallbackRatesToKrw,
      bondStockIds: new Set(["bond"]),
    });
    expect(snapshot).toMatchObject({ available: true, totalValueKrw: 1000 });
    expect(snapshot.categories).toEqual([
      expect.objectContaining({ category: "savings", currentValueKrw: 300, currentWeightBps: 3000 }),
      expect.objectContaining({ category: "stocks", currentValueKrw: 600, currentWeightBps: 6000 }),
      expect.objectContaining({ category: "bonds", currentValueKrw: 100, currentWeightBps: 1000 }),
    ]);
  });

  it("fails closed when prices or cash reconciliation are unavailable", () => {
    expect(buildPortfolioBalanceSnapshot({ ledger: ledger([position("stock", 1)]), stocks: [{ ...stock, currentPrice: 0 }], ratesToKrw: fallbackRatesToKrw }).unavailableReason).toBe("missingPrice");
    expect(buildPortfolioBalanceSnapshot({ ledger: ledger([], [{ accountId: "a", accountName: "A", currency: "KRW", balance: 1, isReconciled: false }]), stocks: [], ratesToKrw: fallbackRatesToKrw }).unavailableReason).toBe("unreconciledCash");
  });
});

describe("new-cash balance assistance", () => {
  it("keeps the base Plan when current allocation is within tolerance", () => {
    const suggestion = suggestContributionBalance({ snapshot: snapshot(300, 600, 100), policy: { ...policy, toleranceBps: 1 }, baseWeightsBps: base, contributionAmountMinor: 100, contributionCurrency: "KRW", ratesToKrw: fallbackRatesToKrw });
    expect(suggestion).toMatchObject({ source: "withinTolerance", weightsBps: base });
  });

  it("directs limited new cash toward underweight categories without selling", () => {
    const suggestion = suggestContributionBalance({ snapshot: snapshot(100, 800, 100), policy, baseWeightsBps: base, contributionAmountMinor: 100, contributionCurrency: "KRW", ratesToKrw: fallbackRatesToKrw });
    expect(suggestion.source).toBe("balanced");
    expect(suggestion.weightsBps.savings).toBe(9583);
    expect(suggestion.weightsBps.stocks).toBe(0);
    expect(suggestion.weightsBps.bonds).toBe(417);
  });

  it("fills target gaps first and allocates excess cash by the base Plan", () => {
    const suggestion = suggestContributionBalance({ snapshot: snapshot(290, 600, 100), policy, baseWeightsBps: base, contributionAmountMinor: 1000, contributionCurrency: "KRW", ratesToKrw: fallbackRatesToKrw });
    expect(suggestion.source).toBe("balanced");
    expect(Object.values(suggestion.weightsBps).reduce((sum, value) => sum + value, 0)).toBe(10000);
    expect(suggestion.weightsBps.savings).toBeGreaterThan(base.savings);
  });

  it("falls back to the saved Plan when valuation is unavailable", () => {
    const unavailable = buildPortfolioBalanceSnapshot({ ledger: { ...ledger(), errors: [{ tradeId: "t", message: "broken" }] }, stocks: [], ratesToKrw: fallbackRatesToKrw });
    expect(suggestContributionBalance({ snapshot: unavailable, policy, baseWeightsBps: base, contributionAmountMinor: 100, contributionCurrency: "KRW", ratesToKrw: fallbackRatesToKrw })).toMatchObject({ source: "unavailable", weightsBps: base });
  });
});

function snapshot(savings: number, stocks: number, bonds: number) {
  const total = savings + stocks + bonds;
  return { available: true, unavailableReason: null, totalValueKrw: total, categories: [
    { category: "savings" as const, currentValueKrw: savings, currentWeightBps: savings / total * 10000 },
    { category: "stocks" as const, currentValueKrw: stocks, currentWeightBps: stocks / total * 10000 },
    { category: "bonds" as const, currentValueKrw: bonds, currentWeightBps: bonds / total * 10000 },
  ] };
}

function ledger(positions: TradingLedger["positions"] = [], cashBalances: TradingLedger["cashBalances"] = []): TradingLedger {
  return { positions, cashBalances, cycles: [], calculations: {}, errors: [], totalRealizedKrw: 0 };
}

function position(stockId: string, quantity: number): TradingLedger["positions"][number] {
  return { key: stockId, stockId, stockName: stockId, accountId: "a", accountName: "A", currency: "KRW", quantity, averagePrice: 0, investedAmount: 0, investedAmountKrw: 0, realizedProfit: 0, realizedProfitKrw: 0 };
}
