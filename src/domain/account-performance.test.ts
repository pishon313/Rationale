import { describe, expect, it } from "vitest";
import { buildTradingLedger } from "./trading-ledger";
import { buildLongTermPerformance, calculateXirr } from "./account-performance";
import type { Trade } from "@/features/trades/types";
import type { Stock } from "@/features/stocks/types";
import type { InvestmentAccount } from "@/features/accounts/types";
import { buildAccountTransfer } from "@/features/accounts/account-transfer";

const trade = (value: Partial<Trade> & Pick<Trade, "id" | "tradeType" | "tradedAt">): Trade => ({ stockId: null, stockName: "", planId: null, quantity: 0, price: 0, currency: "KRW", exchangeRate: 1, fee: 0, tax: 0, accountName: "A", memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, createdAt: value.tradedAt, ...value });
const stock = (value: Partial<Stock> & Pick<Stock, "id" | "name" | "currentPrice">) => ({ currency: "KRW", deletedAt: null, ...value } as Stock);
const rates = { KRW: 1, USD: 1400, JPY: 9, EUR: 1600 };
const account = (id: string, name: string): InvestmentAccount => ({ id, name, institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: id === "a", archivedAt: null, memo: "", createdAt: "2025-01-01", updatedAt: "2025-01-01" });
const cash = (id: string, tradeType: "입금" | "출금", amount: number, cashFlowKind: Trade["cashFlowKind"] = "external") => trade({ id, tradeType, tradedAt: `2025-0${id.length}-01`, amount, cashFlowKind });
const dividend = (amount: number) => trade({ id: "gain", tradeType: "배당", tradedAt: "2025-09-01", stockId: "s1", stockName: "A주식", amount });

function performance(trades: Trade[], accounts: InvestmentAccount[] = []) {
  const ledger = buildTradingLedger(trades, accounts);
  return buildLongTermPerformance(trades, [], ledger, rates, new Date("2026-01-01"), accounts);
}

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

  it.each([
    { name: "외부 입금만 있는 경우", trades: [cash("deposit", "입금", 100_000)], expected: { assets: 100_000, net: 100_000, adjustment: 0, basis: 100_000, profit: 0, returnPercent: 0 } },
    { name: "실제 투자 이익이 있는 경우", trades: [cash("deposit", "입금", 100_000), dividend(20_000)], expected: { assets: 120_000, net: 100_000, adjustment: 0, basis: 100_000, profit: 20_000, returnPercent: 20 } },
    { name: "잔액 보정과 실제 이익이 함께 있는 경우", trades: [cash("deposit", "입금", 100_000), cash("reconcile", "입금", 100_000, "reconciliation"), dividend(20_000)], expected: { assets: 220_000, net: 100_000, adjustment: 100_000, basis: 200_000, profit: 20_000, returnPercent: 10 } },
    { name: "잔액 차감 보정만 있는 경우", trades: [cash("deposit", "입금", 100_000), cash("reconcile", "출금", 20_000, "reconciliation")], expected: { assets: 80_000, net: 100_000, adjustment: -20_000, basis: 80_000, profit: 0, returnPercent: 0 } },
    { name: "양수 잔액 보정만 있는 경우", trades: [cash("reconcile", "입금", 100_000, "reconciliation")], expected: { assets: 100_000, net: 0, adjustment: 100_000, basis: 100_000, profit: 0, returnPercent: 0 } },
  ])("성과 기준 원금으로 총수익률을 계산한다: $name", ({ trades, expected }) => {
    const result = performance(trades);
    expect(result).toMatchObject({ totalAssetsKrw: expected.assets, netContributionsKrw: expected.net, reconciliationAdjustmentKrw: expected.adjustment, performanceBasisKrw: expected.basis, totalProfitKrw: expected.profit, totalReturnPercent: expected.returnPercent });
    expect(result.accounts[0]).toMatchObject({ performanceBasisKrw: expected.basis, totalProfitKrw: expected.profit, totalReturnPercent: expected.returnPercent });
  });

  it("성과 기준 원금이 0 이하이면 총수익률을 계산하지 않는다", () => {
    expect(performance([cash("reconcile", "출금", 20_000, "reconciliation")]).totalReturnPercent).toBeNull();
  });

  it("계좌 간 이체가 전체 성과 기준 원금과 총수익률을 바꾸지 않는다", () => {
    const accounts = [account("a", "A"), account("b", "B")];
    const deposit = { ...cash("deposit", "입금", 100_000), accountId: "a", accountName: "A" };
    const before = performance([deposit], accounts);
    const transfer = buildAccountTransfer(accounts, { sourceAccountId: "a", targetAccountId: "b", amount: 40_000, currency: "KRW", tradedAt: "2025-06-01", memo: "" }, "2025-06-01", "transfer");
    const after = performance([deposit, ...transfer], accounts);
    expect(after.performanceBasisKrw).toBe(before.performanceBasisKrw);
    expect(after.totalReturnPercent).toBe(before.totalReturnPercent);
    expect(after.netContributionsKrw).toBe(before.netContributionsKrw);
    expect(after.accounts.find((item) => item.accountId === "a")?.netContributionsKrw).toBe(60_000);
    expect(after.accounts.find((item) => item.accountId === "b")?.netContributionsKrw).toBe(40_000);
  });

  it("보관된 계좌의 과거 성과를 계속 포함한다", () => {
    const archived: InvestmentAccount = { id: "archived", name: "과거 계좌", institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: false, archivedAt: "2026-01-01", memo: "", createdAt: "2025-01-01", updatedAt: "2026-01-01" };
    const trades = [trade({ id: "in", tradeType: "입금", tradedAt: "2025-01-01", amount: 100, accountId: archived.id, accountName: archived.name }), trade({ id: "out", tradeType: "출금", tradedAt: "2025-06-01", amount: 100, accountId: archived.id, accountName: archived.name })];
    const result = buildLongTermPerformance(trades, [], buildTradingLedger(trades, [archived]), { KRW: 1, USD: 1400, JPY: 9, EUR: 1600 }, new Date("2026-01-01"), [archived]);
    expect(result.accounts.find((account) => account.accountId === archived.id)).toMatchObject({ accountName: "과거 계좌", totalAssetsKrw: 0 });
  });
});
