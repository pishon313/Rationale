import { describe, expect, it } from "vitest";
import { fallbackRatesToKrw } from "./currency";
import { buildPortfolioBalanceSnapshot, detectPortfolioCashRequirements, suggestContributionBalance } from "./portfolio-balance";
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
      ], [{ accountId: "a", accountName: "A", currency: "KRW", baselineBalance: 300, baselineAsOf: "2026-01-01T00:00:00.000Z", balance: 300, isNegative: false, isReconciled: true }]),
      stocks: [stock, bond],
      ratesToKrw: fallbackRatesToKrw,
      bondStockIds: new Set(["bond"]),
      cashRequirements: [{ targetId: "cash", accountId: "a", currency: "KRW" }],
    });
    expect(snapshot).toMatchObject({ available: true, totalValueKrw: 1000, outsideCurrentPlanCashValueKrw: 0, outsideCurrentPlanCashWeightBps: 0 });
    expect(snapshot.categories).toEqual([
      expect.objectContaining({ category: "savings", currentValueKrw: 300, currentWeightBps: 3000 }),
      expect.objectContaining({ category: "stocks", currentValueKrw: 600, currentWeightBps: 6000 }),
      expect.objectContaining({ category: "bonds", currentValueKrw: 100, currentWeightBps: 1000 }),
    ]);
  });

  it("uses the stable asset class before free-form asset type inference", () => {
    const explicitBond = { ...stock, id: "explicit-bond", assetType: "ETF", assetClass: "bond" as const };
    const explicitEquity = { ...stock, id: "explicit-equity", assetType: "Bond ETF", assetClass: "equity" as const };
    const result = buildPortfolioBalanceSnapshot({ ledger: ledger([position(explicitBond.id, 1), position(explicitEquity.id, 1)]), stocks: [explicitBond, explicitEquity], ratesToKrw: fallbackRatesToKrw });
    expect(result.categories.find((row) => row.category === "bonds")?.currentValueKrw).toBe(100);
    expect(result.categories.find((row) => row.category === "stocks")?.currentValueKrw).toBe(100);
  });

  it("fails closed when prices or cash reconciliation are unavailable", () => {
    expect(buildPortfolioBalanceSnapshot({ ledger: ledger([position("stock", 1)]), stocks: [{ ...stock, currentPrice: 0 }], ratesToKrw: fallbackRatesToKrw }).unavailableReason).toBe("missingPrice");
    expect(buildPortfolioBalanceSnapshot({ ledger: ledger([], [{ accountId: "a", accountName: "A", currency: "KRW", baselineBalance: 1, baselineAsOf: "2026-01-01T00:00:00.000Z", balance: 1, isNegative: false, isReconciled: false }]), stocks: [], ratesToKrw: fallbackRatesToKrw, cashRequirements: [{ targetId: "cash", accountId: "a", currency: "KRW" }] }).unavailableReason).toBe("unreconciledCash");
  });

  it("uses a positions-only denominator when no selected Cash target requires cash", () => {
    const snapshot = buildPortfolioBalanceSnapshot({
      ledger: ledger([position("stock", 2)], [{ accountId: "tracked", accountName: "Tracked", currency: "KRW", baselineBalance: 500, baselineAsOf: "2026-01-01T00:00:00.000Z", balance: 500, isNegative: false, isReconciled: true }]),
      stocks: [stock],
      ratesToKrw: fallbackRatesToKrw,
    });
    expect(snapshot).toMatchObject({ available: true, cashScope: "positionsOnly", totalValueKrw: 200, outsideCurrentPlanCashValueKrw: 500, outsideCurrentPlanCashCount: 1, outsideCurrentPlanCashWeightBps: null, outsideCurrentPlanCashUnavailable: false });
    expect(snapshot.categories).toEqual([
      expect.objectContaining({ category: "savings", currentValueKrw: null, currentWeightBps: null }),
      expect.objectContaining({ category: "stocks", currentValueKrw: 200, currentWeightBps: 10000 }),
      expect.objectContaining({ category: "bonds", currentValueKrw: 0, currentWeightBps: 0 }),
    ]);
  });

  it("includes valid Outside Current Plan cash in the denominator without folding it into planned Cash", () => {
    const snapshot = buildPortfolioBalanceSnapshot({
      ledger: ledger([position("stock", 8)], [cashBalance("required", 200), cashBalance("outside", 500)]),
      stocks: [stock], ratesToKrw: fallbackRatesToKrw,
      cashRequirements: [{ targetId: "cash", accountId: "required", currency: "KRW" }],
    });
    expect(snapshot).toMatchObject({ available: true, totalValueKrw: 1500, outsideCurrentPlanCashValueKrw: 500 });
    expect(snapshot.categories.find((row) => row.category === "savings")).toMatchObject({ currentValueKrw: 200 });
    expect(snapshot.categories.find((row) => row.category === "savings")?.currentWeightBps).toBeCloseTo(200 / 1500 * 10000, 8);
    expect(snapshot.categories.find((row) => row.category === "stocks")?.currentWeightBps).toBeCloseTo(800 / 1500 * 10000, 8);
    expect(snapshot.outsideCurrentPlanCashWeightBps).toBeCloseTo(500 / 1500 * 10000, 8);
    expect(snapshot.categories.reduce((sum, row) => sum + (row.currentWeightBps ?? 0), snapshot.outsideCurrentPlanCashWeightBps ?? 0)).toBeCloseTo(10000, 8);
  });

  it("aggregates multiple outside tracked Cash Accounts and Currencies in the complete denominator", () => {
    const outsideValue = 300 + fallbackRatesToKrw.USD;
    const snapshot = buildPortfolioBalanceSnapshot({
      ledger: ledger([position("stock", 8)], [cashBalance("required", 200), cashBalance("outside-krw", 300), cashBalance("outside-usd", 1, "USD")]),
      stocks: [stock], ratesToKrw: fallbackRatesToKrw,
      cashRequirements: [{ targetId: "cash", accountId: "required", currency: "KRW" }],
    });
    expect(snapshot).toMatchObject({ available: true, totalValueKrw: 1000 + outsideValue, outsideCurrentPlanCashValueKrw: outsideValue });
    expect(snapshot.outsideCurrentPlanCashWeightBps).toBeCloseTo(outsideValue / (1000 + outsideValue) * 10000, 8);
  });

  it("keeps an actual tracked zero outside Cash balance visible as a zero share", () => {
    const snapshot = buildPortfolioBalanceSnapshot({
      ledger: ledger([position("stock", 8)], [cashBalance("required", 200), cashBalance("outside", 0)]),
      stocks: [stock], ratesToKrw: fallbackRatesToKrw,
      cashRequirements: [{ targetId: "cash", accountId: "required", currency: "KRW" }],
    });
    expect(snapshot).toMatchObject({ available: true, totalValueKrw: 1000, outsideCurrentPlanCashValueKrw: 0, outsideCurrentPlanCashCount: 1, outsideCurrentPlanCashWeightBps: 0, outsideCurrentPlanCashUnavailable: false });
  });

  it("fails closed for invalid outside Cash when Cash is in scope", () => {
    const negativeOutside = { ...cashBalance("outside", -1), isNegative: true };
    const snapshot = buildPortfolioBalanceSnapshot({
      ledger: ledger([position("stock", 8)], [cashBalance("required", 200), negativeOutside]),
      stocks: [stock], ratesToKrw: fallbackRatesToKrw,
      cashRequirements: [{ targetId: "cash", accountId: "required", currency: "KRW" }],
    });
    expect(snapshot).toMatchObject({ available: false, unavailableReason: "invalidOutsideCash", totalValueKrw: null, outsideCurrentPlanCashValueKrw: null, outsideCurrentPlanCashWeightBps: null, outsideCurrentPlanCashUnavailable: true });
    expect(snapshot.categories.every((row) => row.currentValueKrw === null && row.currentWeightBps === null)).toBe(true);
  });

  it("preserves known outside Cash details while missing required Cash fails closed", () => {
    const snapshot = buildPortfolioBalanceSnapshot({
      ledger: ledger([position("stock", 8)], [cashBalance("outside", 500)]),
      stocks: [stock], ratesToKrw: fallbackRatesToKrw,
      cashRequirements: [{ targetId: "cash", accountId: "required", currency: "KRW" }],
    });
    expect(snapshot).toMatchObject({ available: false, unavailableReason: "missingCashBaseline", totalValueKrw: null, outsideCurrentPlanCashValueKrw: 500, outsideCurrentPlanCashWeightBps: null, outsideCurrentPlanCashUnavailable: false });
  });

  it("fails all current values closed when required cash is untracked and recovers for zero", () => {
    const requirement = [{ targetId: "cash", accountId: "a", currency: "KRW" as const }];
    const unavailable = buildPortfolioBalanceSnapshot({ ledger: ledger([position("stock", 2)]), stocks: [stock], ratesToKrw: fallbackRatesToKrw, cashRequirements: requirement });
    expect(unavailable).toMatchObject({ available: false, unavailableReason: "missingCashBaseline", totalValueKrw: null, missingCashRequirements: requirement });
    expect(unavailable.categories.every((row) => row.currentValueKrw === null && row.currentWeightBps === null)).toBe(true);

    const trackedZero = buildPortfolioBalanceSnapshot({ ledger: ledger([position("stock", 2)], [{ accountId: "a", accountName: "A", currency: "KRW", baselineBalance: 0, baselineAsOf: "2026-01-01T00:00:00.000Z", balance: 0, isNegative: false, isReconciled: true }]), stocks: [stock], ratesToKrw: fallbackRatesToKrw, cashRequirements: requirement });
    expect(trackedZero).toMatchObject({ available: true, totalValueKrw: 200, missingCashRequirements: [] });
    expect(trackedZero.categories.find((row) => row.category === "savings")).toMatchObject({ currentValueKrw: 0, currentWeightBps: 0 });
  });

  it("fails required negative cash safely without letting unrelated untracked cash block positions-only valuation", () => {
    const negative = { accountId: "a", accountName: "A", currency: "KRW" as const, baselineBalance: 10, baselineAsOf: "2026-01-01T00:00:00.000Z", balance: -1, isNegative: true, isReconciled: true };
    expect(buildPortfolioBalanceSnapshot({ ledger: ledger([position("stock", 1)], [negative]), stocks: [stock], ratesToKrw: fallbackRatesToKrw })).toMatchObject({ available: true, outsideCurrentPlanCashValueKrw: null, outsideCurrentPlanCashUnavailable: true });
    expect(buildPortfolioBalanceSnapshot({ ledger: ledger([position("stock", 1)], [negative]), stocks: [stock], ratesToKrw: fallbackRatesToKrw, cashRequirements: [{ targetId: "cash", accountId: "a", currency: "KRW" }] }).unavailableReason).toBe("negativeCash");
  });

  it("detects only positive active Cash targets with selected Accounts", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const state = { id: "default" as const, activeRevisionId: "r1", contributionAmountMinor: 100, contributionCurrency: "USD" as const, updatedAt: now };
    const revision = { id: "r1", revisionNumber: 1, basedOnRevisionId: null, thesis: "", changeNote: "", createdAt: now, activatedAt: now, updatedAt: now };
    const groups = [
      { id: "active", revisionId: "r1", name: "Cash", targetWeightBps: 3000, sortOrder: 0, updatedAt: now },
      { id: "zero", revisionId: "r1", name: "Zero", targetWeightBps: 0, sortOrder: 1, updatedAt: now },
    ];
    const targets = [
      { id: "required", revisionId: "r1", groupId: "active", accountId: "a", targetType: "cash" as const, stockId: null, weightWithinGroupBps: 10000, sortOrder: 0, updatedAt: now },
      { id: "optional", revisionId: "r1", groupId: "active", accountId: null, targetType: "cash" as const, stockId: null, weightWithinGroupBps: 10000, sortOrder: 1, updatedAt: now },
      { id: "zero", revisionId: "r1", groupId: "zero", accountId: "b", targetType: "cash" as const, stockId: null, weightWithinGroupBps: 10000, sortOrder: 0, updatedAt: now },
    ];
    expect(detectPortfolioCashRequirements({ state, revision, groups, targets })).toEqual([{ targetId: "required", accountId: "a", currency: "USD" }]);
  });
});

describe("new-cash balance assistance", () => {
  it("keeps the base Plan when current allocation is within tolerance", () => {
    const suggestion = suggestContributionBalance({ snapshot: snapshot(300, 600, 100), policy: { ...policy, toleranceBps: 1 }, baseWeightsBps: base, contributionAmountMinor: 100, contributionCurrency: "KRW", ratesToKrw: fallbackRatesToKrw });
    expect(suggestion).toMatchObject({ source: "withinTolerance", weightsBps: base });
  });

  it("treats the tolerance boundary as inside and one basis point beyond as outside", () => {
    const boundaryPolicy = { ...policy, toleranceBps: 100 };
    expect(suggestContributionBalance({ snapshot: snapshot(290, 610, 100), policy: boundaryPolicy, baseWeightsBps: base, contributionAmountMinor: 100, contributionCurrency: "KRW", ratesToKrw: fallbackRatesToKrw }).source).toBe("withinTolerance");
    expect(suggestContributionBalance({ snapshot: snapshot(289.9, 610.1, 100), policy: boundaryPolicy, baseWeightsBps: base, contributionAmountMinor: 100, contributionCurrency: "KRW", ratesToKrw: fallbackRatesToKrw }).source).toBe("balanced");
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

  it("runs from valid positions only but falls back when a required cash baseline is unavailable", () => {
    const positionsOnly = buildPortfolioBalanceSnapshot({ ledger: ledger([position("stock", 10)]), stocks: [stock], ratesToKrw: fallbackRatesToKrw });
    expect(suggestContributionBalance({ snapshot: positionsOnly, policy, baseWeightsBps: base, contributionAmountMinor: 100, contributionCurrency: "KRW", ratesToKrw: fallbackRatesToKrw }).source).toBe("balanced");

    const cashUnavailable = buildPortfolioBalanceSnapshot({ ledger: ledger([position("stock", 10)]), stocks: [stock], ratesToKrw: fallbackRatesToKrw, cashRequirements: [{ targetId: "cash", accountId: "a", currency: "KRW" }] });
    expect(suggestContributionBalance({ snapshot: cashUnavailable, policy, baseWeightsBps: base, contributionAmountMinor: 100, contributionCurrency: "KRW", ratesToKrw: fallbackRatesToKrw })).toMatchObject({ source: "unavailable", weightsBps: base });
  });
});

function snapshot(savings: number, stocks: number, bonds: number) {
  const total = savings + stocks + bonds;
  return { available: true, unavailableReason: null, totalValueKrw: total, categories: [
    { category: "savings" as const, currentValueKrw: savings, currentWeightBps: savings / total * 10000 },
    { category: "stocks" as const, currentValueKrw: stocks, currentWeightBps: stocks / total * 10000 },
    { category: "bonds" as const, currentValueKrw: bonds, currentWeightBps: bonds / total * 10000 },
  ], cashScope: "required" as const, cashRequirements: [], missingCashRequirements: [], outsideCurrentPlanCashValueKrw: 0, outsideCurrentPlanCashCount: 0, outsideCurrentPlanCashWeightBps: 0, outsideCurrentPlanCashUnavailable: false };
}

function ledger(positions: TradingLedger["positions"] = [], cashBalances: TradingLedger["cashBalances"] = []): TradingLedger {
  return { positions, tradeCapitalBalances: [], cashBalances, cycles: [], calculations: {}, errors: [], totalNetTradeCapitalKrw: 0, totalRealizedKrw: 0 };
}

function position(stockId: string, quantity: number): TradingLedger["positions"][number] {
  return { key: stockId, stockId, stockName: stockId, accountId: "a", accountName: "A", currency: "KRW", quantity, averagePrice: 0, investedAmount: 0, investedAmountKrw: 0, realizedProfit: 0, realizedProfitKrw: 0 };
}

function cashBalance(accountId: string, balance: number, currency: "KRW" | "USD" = "KRW"): TradingLedger["cashBalances"][number] {
  return { accountId, accountName: accountId, currency, baselineBalance: balance, baselineAsOf: "2026-01-01T00:00:00.000Z", balance, isNegative: balance < 0, isReconciled: true };
}
