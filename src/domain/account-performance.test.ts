import { describe, expect, it } from "vitest";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { buildLongTermPerformance, calculateXirr } from "./account-performance";
import { buildTradingLedger } from "./trading-ledger";

const rates = { KRW: 1, USD: 1400, JPY: 9, EUR: 1600, CAD: 1000, HKD: 177 };
const trade = (value: Partial<Trade> & Pick<Trade, "id" | "tradeType" | "tradedAt">): Trade => ({
  stockId: null, stockName: "", planId: null, quantity: 0, price: 0, currency: "KRW",
  exchangeRate: 1, fee: 0, tax: 0, accountName: "A", memo: "", emotion: "평온",
  emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3,
  createdAt: value.tradedAt, ...value,
});
const stock = (value: Partial<Stock> & Pick<Stock, "id" | "name" | "currentPrice">) => ({ currency: "KRW", deletedAt: null, ...value } as Stock);
const account = (id: string, name: string): InvestmentAccount => ({
  id, name, institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW",
  isDefault: id === "a", archivedAt: null, memo: "", createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
});
const trackedAccount = (id: string, name: string, balance: string): InvestmentAccount => ({
  ...account(id, name),
  cashTracking: { version: 1, baselines: [{ currency: "KRW", balance, asOf: "2025-01-01T00:00:00.000Z", createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z" }] },
});

function performance(trades: Trade[], stocks: Stock[], accounts: InvestmentAccount[]) {
  const ledger = buildTradingLedger(trades, accounts);
  return buildLongTermPerformance(trades, stocks, ledger, rates, new Date("2026-01-01"), accounts);
}

describe("long-term account performance compile contract", () => {
  it("keeps Trade-derived metrics available when cash is untracked", () => {
    const accounts = [account("a", "A")];
    const trades = [trade({ id: "buy", tradeType: "매수", tradedAt: "2025-01-02", stockId: "s1", stockName: "A주식", quantity: 5, price: 100, accountId: "a" })];
    const result = performance(trades, [stock({ id: "s1", name: "A주식", currentPrice: 120 })], accounts);
    expect(result.accounts[0]).toMatchObject({
      cashKrw: null,
      totalAssetsKrw: null,
      marketValueKrw: 600,
      investedCostKrw: 500,
      realizedProfitKrw: 0,
      unrealizedProfitKrw: 100,
      netTradeCapitalKrw: 500,
      openPositionCount: 1,
    });
    expect(result).toMatchObject({ cashKrw: null, totalAssetsKrw: null, marketValueKrw: 600, investedCostKrw: 500, netTradeCapitalKrw: 500 });
  });

  it("provides holdings plus cash only when cash is tracked", () => {
    const accounts = [trackedAccount("a", "A", "1000")];
    const trades = [trade({ id: "buy", tradeType: "매수", tradedAt: "2025-01-02", stockId: "s1", stockName: "A주식", quantity: 5, price: 100, accountId: "a" })];
    const result = performance(trades, [stock({ id: "s1", name: "A주식", currentPrice: 120 })], accounts);
    expect(result.accounts[0]).toMatchObject({ cashKrw: 500, marketValueKrw: 600, totalAssetsKrw: 1100 });
    expect(result).toMatchObject({ cashKrw: 500, totalAssetsKrw: 1100 });
  });

  it("distinguishes an actual tracked zero balance from unavailable cash", () => {
    const result = performance([], [], [trackedAccount("a", "A", "0"), account("b", "B")]);
    expect(result.accounts.find((item) => item.accountId === "a")).toMatchObject({ cashKrw: 0, totalAssetsKrw: 0 });
    expect(result.accounts.find((item) => item.accountId === "b")).toMatchObject({ cashKrw: null, totalAssetsKrw: null });
    expect(result.cashKrw).toBeNull();
    expect(result.totalAssetsKrw).toBeNull();
  });

  it("marks partial Currency tracking and scopes holdings plus known tracked cash", () => {
    const tracked = trackedAccount("a", "A", "0");
    const trades = [trade({ id: "usd-buy", tradeType: "매수", tradedAt: "2025-01-02", stockId: "usd", stockName: "USD Stock", quantity: 1, price: 10, currency: "USD", exchangeRate: 1400, accountId: "a" })];
    const result = performance(trades, [stock({ id: "usd", name: "USD Stock", currentPrice: 12, currency: "USD" })], [tracked]).accounts[0];
    expect(result).toMatchObject({
      cashKrw: 0,
      cashTrackingStatus: "partial",
      trackedCashCurrencyCount: 1,
      untrackedCashCurrencyCount: 1,
      marketValueKrw: 16_800,
      holdingsPlusTrackedCashKrw: 16_800,
      totalAssetsKrw: null,
      netContributionsKrw: null,
      totalReturnPercent: null,
      xirrPercent: null,
    });
  });

  it("calculates realized, unrealized, invested cost, and capital independently", () => {
    const accounts = [account("a", "A")];
    const trades = [
      trade({ id: "buy", tradeType: "매수", tradedAt: "2025-01-02", stockId: "s1", stockName: "A주식", quantity: 5, price: 100, accountId: "a" }),
      trade({ id: "sell", tradeType: "매도", tradedAt: "2025-01-03", stockId: "s1", stockName: "A주식", quantity: 2, price: 150, accountId: "a" }),
    ];
    const result = performance(trades, [stock({ id: "s1", name: "A주식", currentPrice: 120 })], accounts).accounts[0];
    expect(result).toMatchObject({
      investedCostKrw: 300,
      marketValueKrw: 360,
      realizedProfitKrw: 100,
      unrealizedProfitKrw: 60,
      netTradeCapitalKrw: 200,
      openPositionCount: 1,
    });
  });

  it("does not infer contribution, full-account return, or XIRR from a baseline snapshot", () => {
    const result = performance([], [], [trackedAccount("a", "A", "100000")]);
    expect(result).toMatchObject({
      netContributionsKrw: null,
      reconciliationAdjustmentKrw: null,
      performanceBasisKrw: null,
      totalProfitKrw: null,
      totalReturnPercent: null,
      xirrPercent: null,
    });
    expect(calculateXirr([{ date: new Date("2025-01-01"), amount: -1000 }, { date: new Date("2026-01-01"), amount: 1100 }])).toBeCloseTo(10, 4);
  });

  it("values an unpriced open position at invested cost and marks it", () => {
    const accounts = [account("a", "A")];
    const trades = [trade({ id: "opening", tradeType: "매수", tradedAt: "2025-01-01", stockId: "s1", stockName: "미평가", quantity: 2, price: 100, isOpeningPosition: true, accountId: "a" })];
    const result = performance(trades, [stock({ id: "s1", name: "미평가", currentPrice: 0 })], accounts);
    expect(result).toMatchObject({ marketValueKrw: 200, investedCostKrw: 200, unrealizedProfitKrw: 0, netTradeCapitalKrw: 0, unpricedPositionCount: 1 });
  });

  it("keeps archived Accounts in the independent metrics", () => {
    const archived: InvestmentAccount = { ...account("archived", "과거 계좌"), archivedAt: "2026-01-01T00:00:00.000Z" };
    const trades = [trade({ id: "buy", tradeType: "매수", tradedAt: "2025-01-01", stockId: "s1", stockName: "과거 주식", quantity: 1, price: 100, accountId: archived.id, accountName: archived.name })];
    const result = performance(trades, [stock({ id: "s1", name: "과거 주식", currentPrice: 150 })], [archived]);
    expect(result.accounts.find((item) => item.accountId === archived.id)).toMatchObject({ accountName: "과거 계좌", marketValueKrw: 150, netTradeCapitalKrw: 100 });
  });
});
