import { describe, expect, it, vi } from "vitest";
import { buildTradingLedger } from "@/domain/trading-ledger";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Trade } from "@/features/trades/types";
import { analyzeStockCurrencyCorrection, correctStockCurrency, StockCurrencyCorrectionError } from "./stock-currency-correction";
import type { Stock } from "./types";

const now = "2026-08-10T00:00:00.000Z";
const account: InvestmentAccount = { id: "account", name: "Account", institution: "Broker", kind: "brokerage", subtype: "일반", baseCurrency: "KRW", isDefault: true, archivedAt: null, memo: "", createdAt: now, updatedAt: now };
const stock: Stock = { id: "nvda", ticker: "NVDA", name: "NVIDIA", market: "미국", currency: "KRW", assetType: "주식", sector: "반도체", status: "보유", investmentType: "장기 코어", currentPrice: 223.96, targetPrice: 300, averagePrice: 188, quantity: 2, thesisSummary: "", currentView: "중립", currentViewMemo: "", nextReviewDate: null, ledgerInitializedAt: now, tags: [], createdAt: now, updatedAt: now, deletedAt: null };

describe("stock currency correction", () => {
  it("KRW→USD 정정 시 숫자와 identity는 유지하고 날짜별 환율을 적용한다", async () => {
    const first = trade("buy-1", "매수", "2026-01-02T10:00:00Z", { quantity: 3, price: 188, fee: 1, tax: 2 });
    const second = trade("sell-1", "매도", "2026-01-05T10:00:00Z", { quantity: 1, price: 200, fee: 0.5, planId: "plan", memo: "memo" });
    const fetchRate = vi.fn(async (_currency, date: string) => ({ date, rate: date === "2026-01-02" ? 1400 : 1410 }));
    const save = vi.fn(async (writes: readonly { collection: string; values: readonly { id: string }[] }[]) => { void writes; });

    const result = await correctStockCurrency({ stock, desiredStock: { ...stock, currency: "USD" }, stocks: [stock], trades: [first, second], accounts: [account], fetchRate, saveAtomically: save, now });

    expect(result.stock).toMatchObject({ currency: "USD", currentPrice: 223.96, targetPrice: 300, quantity: 2, averagePrice: 188 + 1 });
    expect(result.trades[0]).toMatchObject({ id: first.id, accountId: first.accountId, tradedAt: first.tradedAt, quantity: 3, price: 188, fee: 1, tax: 2, currency: "USD", exchangeRate: 1400 });
    expect(result.trades[1]).toMatchObject({ id: second.id, planId: "plan", memo: "memo", price: 200, currency: "USD", exchangeRate: 1410 });
    expect(fetchRate).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0].map((write) => write.collection)).toEqual(["stocks", "trades"]);
    expect(buildTradingLedger(result.trades, [account]).errors).toEqual([]);
    expect(buildTradingLedger(result.trades, [account]).positions[0].investedAmountKrw).not.toBe(buildTradingLedger([first, second], [account]).positions[0].investedAmountKrw);
  });

  it("같은 날짜의 환율 요청을 중복하지 않고 opening BUY도 정정하며 배당·삭제 기록은 유지한다", async () => {
    const opening = trade("opening", "매수", "2026-01-02T09:00:00Z", { isOpeningPosition: true, quantity: 1, price: 100 });
    const buy = trade("buy", "매수", "2026-01-02T10:00:00Z", { quantity: 1, price: 100 });
    const dividend = trade("dividend", "배당", "2026-01-03T10:00:00Z", { quantity: 0, price: 0, amount: 10, currency: "USD", exchangeRate: 1400 });
    const deleted = { ...trade("deleted", "매수", "2026-01-04T10:00:00Z"), deletedAt: now };
    const fetchRate = vi.fn(async (_currency, date: string) => ({ date, rate: 1400 }));
    const result = await correctStockCurrency({ stock, desiredStock: { ...stock, currency: "USD" }, stocks: [stock], trades: [opening, buy, dividend, deleted], accounts: [account], fetchRate, saveAtomically: async () => undefined, now });

    expect(fetchRate).toHaveBeenCalledTimes(1);
    expect(result.trades.find((item) => item.id === "opening")).toMatchObject({ currency: "USD", exchangeRate: 1400, isOpeningPosition: true });
    expect(result.trades.find((item) => item.id === "dividend")).toEqual(dividend);
    expect(result.trades.find((item) => item.id === "deleted")).toEqual(deleted);
  });

  it("KRW 정정은 네트워크 요청 없이 환율 1을 적용한다", async () => {
    const usdStock = { ...stock, currency: "USD" as const };
    const buy = trade("buy", "매수", "2026-01-02T10:00:00Z", { currency: "USD", exchangeRate: 1400 });
    const fetchRate = vi.fn();
    const result = await correctStockCurrency({ stock: usdStock, desiredStock: { ...usdStock, currency: "KRW" }, stocks: [usdStock], trades: [buy], accounts: [account], fetchRate, saveAtomically: async () => undefined, now });
    expect(fetchRate).not.toHaveBeenCalled();
    expect(result.trades[0]).toMatchObject({ currency: "KRW", exchangeRate: 1 });
  });

  it("과거 환율 실패 시 저장하지 않고 원본을 변경하지 않는다", async () => {
    const buy = trade("buy", "매수", "2025-11-14T10:00:00Z");
    const save = vi.fn();
    await expect(correctStockCurrency({ stock, desiredStock: { ...stock, currency: "USD" }, stocks: [stock], trades: [buy], accounts: [account], fetchRate: async () => { throw new Error("offline"); }, saveAtomically: save })).rejects.toMatchObject({ code: "HISTORICAL_FX", tradeDate: "2025-11-14" });
    expect(save).not.toHaveBeenCalled();
    expect(stock.currency).toBe("KRW");
    expect(buy.currency).toBe("KRW");
  });

  it("원자 저장 실패 시 candidate를 반환하지 않고 입력을 변경하지 않는다", async () => {
    const buy = trade("buy", "매수", "2026-01-02T10:00:00Z");
    await expect(correctStockCurrency({ stock, desiredStock: { ...stock, currency: "USD" }, stocks: [stock], trades: [buy], accounts: [account], fetchRate: async (_currency, date) => ({ date, rate: 1400 }), saveAtomically: async () => { throw new Error("disk full"); } })).rejects.toThrow("disk full");
    expect(stock.currency).toBe("KRW");
    expect(buy.currency).toBe("KRW");
  });

  it("매수·매도가 없으면 Stock만 정정하고 환율을 조회하지 않는다", async () => {
    const dividend = trade("dividend", "배당", "2026-01-03T10:00:00Z", { quantity: 0, price: 0, amount: 10 });
    const fetchRate = vi.fn();
    const result = await correctStockCurrency({ stock, desiredStock: { ...stock, currency: "USD" }, stocks: [stock], trades: [dividend], accounts: [account], fetchRate, saveAtomically: async () => undefined, now });
    expect(fetchRate).not.toHaveBeenCalled();
    expect(result.stock).toMatchObject({ currency: "USD", quantity: stock.quantity, averagePrice: stock.averagePrice });
    expect(result.trades[0]).toEqual(dividend);
  });

  it("같은 통화는 correction과 저장을 수행하지 않는다", async () => {
    const save = vi.fn();
    const result = await correctStockCurrency({ stock, desiredStock: stock, stocks: [stock], trades: [], accounts: [account], saveAtomically: save });
    expect(result.changed).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it("Stock 통화와 다른 active BUY/SELL이 하나라도 있으면 mixed conflict로 차단한다", async () => {
    const trades = [trade("krw", "매수", "2026-01-02T10:00:00Z"), trade("usd", "매수", "2026-01-03T10:00:00Z", { currency: "USD", exchangeRate: 1400 })];
    expect(analyzeStockCurrencyCorrection({ stock, trades, newCurrency: "USD" }).hasMixedCurrencyConflict).toBe(true);
    await expect(correctStockCurrency({ stock, desiredStock: { ...stock, currency: "USD" }, stocks: [stock], trades, accounts: [account], saveAtomically: async () => undefined })).rejects.toBeInstanceOf(StockCurrencyCorrectionError);
  });
});

function trade(id: string, tradeType: Trade["tradeType"], tradedAt: string, values: Partial<Trade> = {}): Trade {
  return { id, stockId: stock.id, stockName: stock.name, planId: null, tradeType, tradedAt, quantity: 2, price: 188, currency: "KRW", exchangeRate: 1, fee: 0, tax: 0, accountId: account.id, accountName: account.name, memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, createdAt: tradedAt, updatedAt: tradedAt, deletedAt: null, ...values };
}
