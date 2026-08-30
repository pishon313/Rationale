import { describe, expect, it } from "vitest";
import { fallbackRatesToKrw } from "./currency";
import { comparePortfolioPlanByGroup } from "./portfolio-overview";
import type { TradingLedger } from "./trading-ledger";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { PortfolioAllocationGroup, PortfolioAllocationTarget, PortfolioPlanRevision } from "@/features/portfolio-plan/types";

const now = "2026-08-30T00:00:00.000Z";
const revision: PortfolioPlanRevision = { id: "r1", revisionNumber: 1, basedOnRevisionId: null, thesis: "", changeNote: "", createdAt: now, activatedAt: now, updatedAt: now };
const groups: PortfolioAllocationGroup[] = [
  { id: "g1", revisionId: "r1", name: "Stocks", targetWeightBps: 6000, sortOrder: 0, updatedAt: now },
  { id: "g2", revisionId: "r1", name: "Savings", targetWeightBps: 4000, sortOrder: 1, updatedAt: now },
];
const stockA = { ...sampleStocks[0], id: "stock-a", currentPrice: 100, currency: "KRW" as const };
const stockB = { ...sampleStocks[1], id: "stock-b", currentPrice: 100, currency: "KRW" as const };
const targets: PortfolioAllocationTarget[] = [
  { id: "t1", revisionId: "r1", groupId: "g1", accountId: "a", targetType: "stock", stockId: "stock-a", weightWithinGroupBps: 10000, sortOrder: 0, updatedAt: now },
  { id: "t2", revisionId: "r1", groupId: "g2", accountId: "b", targetType: "cash", stockId: null, weightWithinGroupBps: 10000, sortOrder: 0, updatedAt: now },
];

describe("Portfolio grouped Overview", () => {
  it("aggregates Stocks across accounts and uses account-specific Cash with exact, positive, and negative drift", () => {
    const result = comparePortfolioPlanByGroup({ revision, groups, targets, stocks: [stockA], ratesToKrw: fallbackRatesToKrw, ledger: ledger([
      position("stock-a", "a", 3), position("stock-a", "b", 3),
    ], [cash("a", 100), cash("b", 300)]) });
    expect(result.totalCurrentValueKrw).toBe(1000);
    expect(result.groups[0]).toMatchObject({ currentValueKrw: 600, currentWeight: 60, driftPercentagePoints: 0, targetValueKrw: 600 });
    expect(result.groups[1]).toMatchObject({ currentValueKrw: 300, currentWeight: 30, driftPercentagePoints: -10, targetValueKrw: 400 });
    expect(result.groups.at(-1)).toMatchObject({ name: "Outside Current Plan", currentValueKrw: 100, currentWeight: 10, driftPercentagePoints: 10 });
  });

  it("nests Target aggregation and exposes outside Stock and outside Cash", () => {
    const result = comparePortfolioPlanByGroup({ revision, groups, targets, stocks: [stockA, stockB], ratesToKrw: fallbackRatesToKrw, ledger: ledger([position("stock-a", "a", 2), position("stock-b", "a", 1)], [cash("b", 100), cash("c", 50)]) });
    expect(result.groups[0]?.targets[0]).toMatchObject({ stockId: "stock-a", currentValueKrw: 200, targetWeight: 60 });
    expect(result.groups.at(-1)?.targets).toEqual(expect.arrayContaining([expect.objectContaining({ stockId: "stock-b", currentValueKrw: 100 }), expect.objectContaining({ accountId: "c", currentValueKrw: 50 })]));
  });

  it("handles no active plan and a zero-value portfolio", () => {
    expect(comparePortfolioPlanByGroup({ revision: null, groups, targets, stocks: [stockA], ratesToKrw: fallbackRatesToKrw, ledger: ledger() })).toMatchObject({ active: false, unavailableReason: "noActivePlan", groups: [] });
    const zero = comparePortfolioPlanByGroup({ revision, groups, targets, stocks: [stockA], ratesToKrw: fallbackRatesToKrw, ledger: ledger() });
    expect(zero).toMatchObject({ active: true, valuationAvailable: true, totalCurrentValueKrw: 0 });
    expect(zero.groups[0]).toMatchObject({ currentWeight: null, driftPercentagePoints: null, targetValueKrw: 0 });
  });

  it.each([
    ["missing price", { stocks: [{ ...stockA, currentPrice: 0 }], rates: fallbackRatesToKrw, value: ledger([position("stock-a", "a", 1)]), reason: "missingPrice" }],
    ["invalid FX", { stocks: [stockA], rates: { ...fallbackRatesToKrw, KRW: 0 }, value: ledger([position("stock-a", "a", 1)]), reason: "invalidFx" }],
    ["unreconciled Cash", { stocks: [stockA], rates: fallbackRatesToKrw, value: ledger([], [{ ...cash("b", 1), isReconciled: false }]), reason: "unreconciledCash" }],
    ["ledger error", { stocks: [stockA], rates: fallbackRatesToKrw, value: { ...ledger(), errors: [{ tradeId: "t", message: "broken" }] }, reason: "ledgerError" }],
  ] as const)("fails closed for %s while preserving Targets", (_label, scenario) => {
    const result = comparePortfolioPlanByGroup({ revision, groups, targets, stocks: scenario.stocks, ratesToKrw: scenario.rates, ledger: scenario.value as TradingLedger });
    expect(result).toMatchObject({ valuationAvailable: false, unavailableReason: scenario.reason, totalCurrentValueKrw: null });
    expect(result.groups[0]).toMatchObject({ targetWeight: 60, currentWeight: null, driftPercentagePoints: null, targetValueKrw: null, status: "unavailable" });
  });

  it("fails closed when an active Target has a missing Stock reference", () => {
    const result = comparePortfolioPlanByGroup({ revision, groups, targets: [{ ...targets[0] as Extract<PortfolioAllocationTarget, { targetType: "stock" }>, stockId: "missing" }, targets[1]], stocks: [stockA], ratesToKrw: fallbackRatesToKrw, ledger: ledger() });
    expect(result).toMatchObject({ valuationAvailable: false, unavailableReason: "missingStock" });
    expect(result.groups[0]).toMatchObject({ targetWeight: 60, currentWeight: null });
  });
});

function ledger(positions: TradingLedger["positions"] = [], cashBalances: TradingLedger["cashBalances"] = []): TradingLedger {
  return { positions, cashBalances, cycles: [], calculations: {}, errors: [], totalRealizedKrw: 0 };
}
function position(stockId: string, accountId: string, quantity: number): TradingLedger["positions"][number] {
  return { key: `${stockId}:${accountId}`, stockId, stockName: stockId, accountId, accountName: accountId, currency: "KRW", quantity, averagePrice: 0, investedAmount: 0, investedAmountKrw: 0, realizedProfit: 0, realizedProfitKrw: 0 };
}
function cash(accountId: string, balance: number): TradingLedger["cashBalances"][number] {
  return { accountId, accountName: accountId, currency: "KRW", balance, isReconciled: true };
}
