import { describe, expect, it } from "vitest";
import { fallbackRatesToKrw } from "./currency";
import { comparePortfolioPlan } from "./portfolio-plan";
import type { TradingLedger } from "./trading-ledger";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { PortfolioAllocationTarget, PortfolioPlanRevision } from "@/features/portfolio-plan/types";

const now = "2026-08-18T00:00:00.000Z";
const revision: PortfolioPlanRevision = { id: "r1", revisionNumber: 1, basedOnRevisionId: null, thesis: "", changeNote: "", createdAt: now, activatedAt: now, updatedAt: now };
const target = (stockId: string, targetWeightBps: number, index = 0): PortfolioAllocationTarget => ({ id: `t-${stockId}`, revisionId: revision.id, targetType: "stock", stockId, targetWeightBps, sortOrder: index, updatedAt: now });
const cashTarget = (targetWeightBps: number): PortfolioAllocationTarget => ({ id: "t-cash", revisionId: revision.id, targetType: "cash", stockId: null, targetWeightBps, sortOrder: 99, updatedAt: now });
function ledger(positions: Array<{ stockId: string; quantity: number; currency?: "KRW" | "USD" }> = [], cashBalances: TradingLedger["cashBalances"] = []): TradingLedger {
  return { positions: positions.map((position, index) => ({ key: String(index), stockId: position.stockId, stockName: position.stockId, accountId: "a", accountName: "A", currency: position.currency ?? "KRW", quantity: position.quantity, averagePrice: 0, investedAmount: 0, investedAmountKrw: 0, realizedProfit: 0, realizedProfitKrw: 0 })), cashBalances, cycles: [], calculations: {}, errors: [], totalRealizedKrw: 0 };
}
const samsung = { ...sampleStocks[0], id: "samsung", currentPrice: 100, currency: "KRW" as const };
const micron = { ...sampleStocks[1], id: "micron", currentPrice: 10, currency: "USD" as const };
const invalidLedger: TradingLedger = { ...ledger([{ stockId: "samsung", quantity: 1 }]), errors: [{ tradeId: "bad", message: "invalid" }] };

describe("comparePortfolioPlan", () => {
  it("returns no rows without an active plan", () => {
    expect(comparePortfolioPlan({ revision: null, targets: [], ledger: ledger(), stocks: [samsung], ratesToKrw: fallbackRatesToKrw })).toMatchObject({ active: false, unavailableReason: "noActivePlan", allocations: [] });
  });

  it("calculates exact, positive, and negative drift in percentage points", () => {
    const result = comparePortfolioPlan({ revision, targets: [target("samsung", 5000), target("micron", 5000, 1)], ledger: ledger([{ stockId: "samsung", quantity: 6 }, { stockId: "micron", quantity: 4, currency: "USD" }]), stocks: [samsung, { ...micron, currentPrice: 0.1 }], ratesToKrw: { ...fallbackRatesToKrw, USD: 1000 } });
    expect(result.allocations.map((row) => row.driftPercentagePoints)).toEqual([10, -10]);
    const exact = comparePortfolioPlan({ revision, targets: [target("samsung", 10000)], ledger: ledger([{ stockId: "samsung", quantity: 1 }]), stocks: [samsung], ratesToKrw: fallbackRatesToKrw });
    expect(exact.allocations[0].driftPercentagePoints).toBe(0);
  });

  it("includes Cash and outside-plan holdings in the denominator", () => {
    const result = comparePortfolioPlan({ revision, targets: [target("samsung", 4000), cashTarget(6000)], ledger: ledger([{ stockId: "samsung", quantity: 4 }, { stockId: "micron", quantity: 2, currency: "USD" }], [{ accountId: "a", accountName: "A", currency: "KRW", balance: 400, isReconciled: true }]), stocks: [samsung, { ...micron, currentPrice: 0.1 }], ratesToKrw: { ...fallbackRatesToKrw, USD: 1000 } });
    expect(result.totalCurrentValueKrw).toBe(1000);
    expect(result.allocations.find((row) => row.targetType === "cash")?.currentWeight).toBe(40);
    expect(result.allocations.find((row) => row.stockId === "micron")).toMatchObject({ targetWeightBps: 0, currentWeight: 20, status: "outsidePlan" });
  });

  it("shows a target with no current holding at zero current weight", () => {
    const result = comparePortfolioPlan({ revision, targets: [target("samsung", 5000), target("micron", 5000, 1)], ledger: ledger([{ stockId: "samsung", quantity: 1 }]), stocks: [samsung, micron], ratesToKrw: fallbackRatesToKrw });
    expect(result.allocations.find((row) => row.stockId === "micron")).toMatchObject({ currentWeight: 0, driftPercentagePoints: -50, currentValueKrw: 0 });
  });

  it("values multiple currencies with current FX", () => {
    const result = comparePortfolioPlan({ revision, targets: [target("samsung", 5000), target("micron", 5000, 1)], ledger: ledger([{ stockId: "samsung", quantity: 10 }, { stockId: "micron", quantity: 1, currency: "USD" }]), stocks: [samsung, micron], ratesToKrw: { ...fallbackRatesToKrw, USD: 100 } });
    expect(result.totalCurrentValueKrw).toBe(2000);
    expect(result.allocations.map((row) => row.currentWeight)).toEqual([50, 50]);
  });

  it("keeps target values at zero while current percentages are unavailable for a zero portfolio", () => {
    const result = comparePortfolioPlan({ revision, targets: [target("samsung", 10000)], ledger: ledger(), stocks: [samsung], ratesToKrw: fallbackRatesToKrw });
    expect(result).toMatchObject({ valuationAvailable: true, totalCurrentValueKrw: 0 });
    expect(result.allocations[0]).toMatchObject({ currentWeight: null, targetValueKrw: 0 });
  });

  it.each([
    ["ledgerError", [samsung], fallbackRatesToKrw, invalidLedger],
    ["missingPrice", [{ ...samsung, currentPrice: 0 }], fallbackRatesToKrw, ledger([{ stockId: "samsung", quantity: 1 }])],
    ["invalidFx", [micron], { ...fallbackRatesToKrw, USD: 0 }, ledger([{ stockId: "micron", quantity: 1, currency: "USD" }])],
    ["unreconciledCash", [samsung], fallbackRatesToKrw, ledger([], [{ accountId: "a", accountName: "A", currency: "KRW", balance: 100, isReconciled: false }])],
  ] as const)("fails the complete comparison closed for %s", (reason, stocks, ratesToKrw, inputLedger) => {
    const result = comparePortfolioPlan({ revision, targets: [target(stocks[0].id, 10000)], ledger: inputLedger, stocks, ratesToKrw });
    expect(result).toMatchObject({ valuationAvailable: false, unavailableReason: reason, totalCurrentValueKrw: null });
    expect(result.allocations.every((row) => row.currentWeight === null && row.currentValueKrw === null)).toBe(true);
  });
});
