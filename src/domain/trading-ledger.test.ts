import { describe, expect, it } from "vitest";
import { buildTradingLedger, cashBalanceKrw } from "./trading-ledger";
import type { Trade } from "@/features/trades/types";
import type { InvestmentAccount } from "@/features/accounts/types";

const trade = (value: Partial<Trade> & Pick<Trade, "id" | "tradeType" | "tradedAt">): Trade => ({ stockId: "s1", stockName: "테스트", planId: null, quantity: 0, price: 0, currency: "KRW", exchangeRate: 1, fee: 0, tax: 0, accountName: "계좌 A", memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, createdAt: value.tradedAt, ...value });
const account = (id: string, name: string): InvestmentAccount => ({ id, name, institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: false, archivedAt: null, memo: "", createdAt: "2026-01-01", updatedAt: "2026-01-01" });

describe("trading ledger", () => {
  it("accountId가 같으면 legacy 이름이 달라도 같은 계좌로 계산한다", () => {
    const ledger = buildTradingLedger([
      trade({ id: "a", tradeType: "입금", tradedAt: "2026-01-01", stockId: null, amount: 100, accountId: "account-1", accountName: "옛 이름" }),
      trade({ id: "b", tradeType: "입금", tradedAt: "2026-01-02", stockId: null, amount: 200, accountId: "account-1", accountName: "다른 스냅샷" }),
    ], [account("account-1", "현재 이름")]);
    expect(ledger.cashBalances).toEqual([expect.objectContaining({ accountId: "account-1", accountName: "현재 이름", balance: 300 })]);
  });

  it("동일한 accountName이어도 accountId가 다르면 별도 계좌다", () => {
    const ledger = buildTradingLedger([
      trade({ id: "a", tradeType: "입금", tradedAt: "2026-01-01", stockId: null, amount: 100, accountId: "account-1", accountName: "같은 이름" }),
      trade({ id: "b", tradeType: "입금", tradedAt: "2026-01-02", stockId: null, amount: 200, accountId: "account-2", accountName: "같은 이름" }),
    ]);
    expect(ledger.cashBalances).toHaveLength(2);
  });

  it("Account 이름 변경은 cash와 position identity를 바꾸지 않는다", () => {
    const trades = [trade({ id: "a", tradeType: "매수", tradedAt: "2026-01-01", quantity: 1, price: 100, accountId: "account-1", accountName: "옛 이름", isOpeningPosition: true })];
    const before = buildTradingLedger(trades, [account("account-1", "옛 이름")]);
    const after = buildTradingLedger(trades, [account("account-1", "새 이름")]);
    expect(after.positions[0].key).toBe(before.positions[0].key);
    expect(after.positions[0].accountName).toBe("새 이름");
  });

  it("accountId 없는 거래는 기존 이름 기반 결과를 유지한다", () => {
    const ledger = buildTradingLedger([trade({ id: "a", tradeType: "입금", tradedAt: "2026-01-01", stockId: null, amount: 100, accountName: "Legacy" })]);
    expect(ledger.cashBalances[0]).toEqual(expect.objectContaining({ accountId: "legacy:Legacy", accountName: "Legacy", balance: 100 }));
  });
  it("분할매수와 일부 매도를 시간순으로 재계산한다", () => {
    const ledger = buildTradingLedger([
      trade({ id: "b2", tradeType: "매수", tradedAt: "2026-01-02", quantity: 10, price: 120 }),
      trade({ id: "b1", tradeType: "매수", tradedAt: "2026-01-01", quantity: 10, price: 100 }),
      trade({ id: "s1", tradeType: "매도", tradedAt: "2026-01-03", quantity: 5, price: 150, fee: 5 }),
    ]);
    expect(ledger.positions[0].quantity).toBe(15);
    expect(ledger.positions[0].averagePrice).toBe(110);
    expect(ledger.calculations.s1.realizedProfit).toBe(195);
    expect(ledger.cashBalances[0].balance).toBe(-1455);
  });

  it("전량 매도 후 새 포지션 사이클을 만든다", () => {
    const ledger = buildTradingLedger([
      trade({ id: "b1", tradeType: "매수", tradedAt: "2026-01-01", quantity: 1, price: 100 }),
      trade({ id: "s1", tradeType: "매도", tradedAt: "2026-01-02", quantity: 1, price: 120 }),
      trade({ id: "b2", tradeType: "매수", tradedAt: "2026-01-03", quantity: 2, price: 90 }),
    ]);
    expect(ledger.cycles).toHaveLength(2);
    expect(ledger.cycles[0].closedAt).toBe("2026-01-02");
    expect(ledger.cycles[1].closedAt).toBeNull();
  });

  it("입금, 출금과 배당을 계좌·통화별 현금에 반영한다", () => {
    const ledger = buildTradingLedger([
      trade({ id: "d", tradeType: "입금", tradedAt: "2026-01-01", stockId: null, stockName: "", amount: 1000 }),
      trade({ id: "w", tradeType: "출금", tradedAt: "2026-01-02", stockId: null, stockName: "", amount: 200 }),
      trade({ id: "v", tradeType: "배당", tradedAt: "2026-01-03", amount: 50, tax: 5 }),
    ]);
    expect(ledger.cashBalances[0].balance).toBe(845);
  });

  it("보유량을 초과한 매도는 현금과 포지션에 반영하지 않는다", () => {
    const ledger = buildTradingLedger([trade({ id: "s", tradeType: "매도", tradedAt: "2026-01-01", quantity: 1, price: 100 })]);
    expect(ledger.errors[0].tradeId).toBe("s");
    expect(ledger.cashBalances).toHaveLength(0);
  });

  it("USD 현금과 실현손익을 원화로 환산한다", () => {
    const ledger = buildTradingLedger([trade({ id: "d", tradeType: "입금", tradedAt: "2026-01-01", stockId: null, stockName: "", amount: 10, currency: "USD", exchangeRate: 1400 })]);
    expect(cashBalanceKrw(ledger, 1400)).toBe(14000);
  });

  it("매수·매도 시점의 서로 다른 환율을 원화 실현손익에 반영한다", () => {
    const ledger = buildTradingLedger([
      trade({ id: "b", tradeType: "매수", tradedAt: "2026-01-01", quantity: 1, price: 100, currency: "USD", exchangeRate: 1300 }),
      trade({ id: "s", tradeType: "매도", tradedAt: "2026-01-02", quantity: 1, price: 100, currency: "USD", exchangeRate: 1400 }),
    ]);
    expect(ledger.calculations.s.realizedProfit).toBe(0);
    expect(ledger.calculations.s.realizedProfitKrw).toBe(10000);
    expect(ledger.totalRealizedKrw).toBe(10000);
  });

  it("기초 포지션과 삭제된 기록은 현금에 영향을 주지 않는다", () => {
    const ledger = buildTradingLedger([
      trade({ id: "opening", tradeType: "매수", tradedAt: "2026-01-01", quantity: 2, price: 100, isOpeningPosition: true }),
      trade({ id: "deleted", tradeType: "입금", tradedAt: "2026-01-02", stockId: null, amount: 500, deletedAt: "2026-01-03" }),
    ]);
    expect(ledger.positions[0].quantity).toBe(2);
    expect(ledger.cashBalances).toHaveLength(0);
  });

  it("KRW 거래에 1이 아닌 환율이 있으면 원장에 반영하지 않는다", () => {
    const ledger = buildTradingLedger([
      trade({ id: "invalid-fx", tradeType: "매수", tradedAt: "2026-01-01", quantity: 1, price: 100, exchangeRate: 1380 }),
    ]);
    expect(ledger.errors).toEqual([{ tradeId: "invalid-fx", message: "KRW 거래의 환율은 1이어야 합니다." }]);
    expect(ledger.positions).toHaveLength(0);
    expect(ledger.cashBalances).toHaveLength(0);
  });

  it("잘못된 거래 일시는 오류로 남기고 잔액에서 제외한다", () => {
    const ledger = buildTradingLedger([
      trade({ id: "valid", tradeType: "입금", tradedAt: "2026-01-01", stockId: null, amount: 1000 }),
      trade({ id: "invalid-traded-at", tradeType: "입금", tradedAt: "not-a-date", stockId: null, amount: 500 }),
      trade({ id: "invalid-created-at", tradeType: "입금", tradedAt: "2026-01-02", createdAt: "not-a-date", stockId: null, amount: 300 }),
    ]);
    expect(ledger.cashBalances[0].balance).toBe(1000);
    expect(ledger.errors.map((error) => error.tradeId).sort()).toEqual(["invalid-created-at", "invalid-traded-at"]);
  });

  it("중복 거래 ID의 모든 행을 오류로 남기고 잔액에서 제외한다", () => {
    const ledger = buildTradingLedger([
      trade({ id: "duplicate", tradeType: "입금", tradedAt: "2026-01-01", stockId: null, amount: 100 }),
      trade({ id: "duplicate", tradeType: "입금", tradedAt: "2026-01-02", stockId: null, amount: 200 }),
      trade({ id: "valid", tradeType: "입금", tradedAt: "2026-01-03", stockId: null, amount: 300 }),
    ]);
    expect(ledger.cashBalances[0].balance).toBe(300);
    expect(ledger.errors).toEqual([{ tradeId: "duplicate", message: "중복된 거래 ID가 있습니다." }]);
    expect(ledger.calculations.duplicate.error).toBe("중복된 거래 ID가 있습니다.");
  });

  it("매수·매도에서는 현금 전용 amount 값이 거래대금을 덮지 않는다", () => {
    const ledger = buildTradingLedger([trade({ id: "b", tradeType: "매수", tradedAt: "2026-01-01", quantity: 2, price: 100, amount: 1 })]);
    expect(ledger.calculations.b.cashEffect).toBe(-200);
  });

  it("계좌와 통화별로 포지션과 현금을 분리한다", () => {
    const ledger = buildTradingLedger([
      trade({ id: "a", tradeType: "매수", tradedAt: "2026-01-01", quantity: 1, price: 100, accountName: "A" }),
      trade({ id: "b", tradeType: "매수", tradedAt: "2026-01-01", quantity: 2, price: 100, accountName: "B" }),
    ]);
    expect(ledger.positions).toHaveLength(2);
    expect(ledger.cashBalances).toHaveLength(2);
  });

  it("서로 다른 시간대 표기도 실제 시각 순서로 재생한다", () => {
    const ledger = buildTradingLedger([
      trade({ id: "buy", tradeType: "매수", tradedAt: "2026-01-01T10:00:00+09:00", quantity: 1, price: 100 }),
      trade({ id: "sell", tradeType: "매도", tradedAt: "2026-01-01T02:00:00Z", quantity: 1, price: 120 }),
    ]);

    expect(ledger.errors).toHaveLength(0);
    expect(ledger.calculations.sell.realizedProfit).toBe(20);
  });

  it("기초 포지션 플래그가 붙은 현금 거래를 거부한다", () => {
    const ledger = buildTradingLedger([trade({ id: "invalid-opening", tradeType: "입금", tradedAt: "2026-01-01", stockId: null, amount: 100, isOpeningPosition: true })]);

    expect(ledger.errors[0].message).toBe("기초 포지션은 매수 유형이어야 합니다.");
    expect(ledger.cashBalances).toHaveLength(0);
  });
});
