import { describe, expect, it } from "vitest";
import { buildTradingLedger } from "./trading-ledger";
import { buildLongTermPerformance, calculateXirr } from "./account-performance";
import type { Trade } from "@/features/trades/types";
import type { Stock } from "@/features/stocks/types";
import type { InvestmentAccount } from "@/features/accounts/types";

const trade = (value: Partial<Trade> & Pick<Trade, "id" | "tradeType" | "tradedAt">): Trade => ({ stockId: null, stockName: "", planId: null, quantity: 0, price: 0, currency: "KRW", exchangeRate: 1, fee: 0, tax: 0, accountName: "A", memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, createdAt: value.tradedAt, ...value });
const stock = (value: Partial<Stock> & Pick<Stock, "id" | "name" | "currentPrice">) => ({ currency: "KRW", deletedAt: null, ...value } as Stock);

describe("long-term account performance", () => {
  it("현재 총자산, 순입금, 총손익과 계좌별 성과를 계산한다", () => {
    const trades = [
      trade({ id: "deposit-a", tradeType: "입금", tradedAt: "2025-01-01", amount: 1000 }),
      trade({ id: "buy-a", tradeType: "매수", tradedAt: "2025-01-02", stockId: "s1", stockName: "A주식", quantity: 5, price: 100 }),
      trade({ id: "deposit-b", tradeType: "입금", tradedAt: "2025-01-01", amount: 500, accountName: "B" }),
    ];
    const ledger = buildTradingLedger(trades);
    const result = buildLongTermPerformance(trades, [stock({ id: "s1", name: "A주식", currentPrice: 120 })], ledger, { KRW: 1, USD: 1400, JPY: 9, EUR: 1600 }, new Date("2026-01-01"));
    expect(result.totalAssetsKrw).toBe(1600);
    expect(result.netContributionsKrw).toBe(1500);
    expect(result.totalProfitKrw).toBe(100);
    expect(result.totalReturnPercent).toBeCloseTo(6.6667, 3);
    expect(result.accounts.find((account) => account.accountName === "A")?.totalAssetsKrw).toBe(1100);
  });

  it("현재가가 없는 포지션은 원가로 평가하고 표시한다", () => {
    const trades = [trade({ id: "opening", tradeType: "매수", tradedAt: "2025-01-01", stockId: "s1", stockName: "미평가", quantity: 2, price: 100, isOpeningPosition: true })];
    const ledger = buildTradingLedger(trades);
    const result = buildLongTermPerformance(trades, [stock({ id: "s1", name: "미평가", currentPrice: 0 })], ledger, { KRW: 1, USD: 1400, JPY: 9, EUR: 1600 }, new Date("2026-01-01"));
    expect(result.totalAssetsKrw).toBe(200);
    expect(result.totalProfitKrw).toBe(0);
    expect(result.unpricedPositionCount).toBe(1);
  });

  it("현금흐름의 연환산 수익률을 계산한다", () => {
    expect(calculateXirr([{ date: new Date("2025-01-01"), amount: -1000 }, { date: new Date("2026-01-01"), amount: 1100 }])).toBeCloseTo(10, 4);
  });

  it("보관된 계좌의 과거 성과를 계속 포함한다", () => {
    const archived: InvestmentAccount = { id: "archived", name: "과거 계좌", institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: false, archivedAt: "2026-01-01", memo: "", createdAt: "2025-01-01", updatedAt: "2026-01-01" };
    const trades = [trade({ id: "in", tradeType: "입금", tradedAt: "2025-01-01", amount: 100, accountId: archived.id, accountName: archived.name }), trade({ id: "out", tradeType: "출금", tradedAt: "2025-06-01", amount: 100, accountId: archived.id, accountName: archived.name })];
    const result = buildLongTermPerformance(trades, [], buildTradingLedger(trades, [archived]), { KRW: 1, USD: 1400, JPY: 9, EUR: 1600 }, new Date("2026-01-01"), [archived]);
    expect(result.accounts.find((account) => account.accountId === archived.id)).toMatchObject({ accountName: "과거 계좌", totalAssetsKrw: 0 });
  });
});
