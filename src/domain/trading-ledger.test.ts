import { describe, expect, it } from "vitest";
import { buildAccountTransfer } from "@/features/accounts/account-transfer";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { AccountFeeCalculationSnapshotV1, Trade } from "@/features/trades/types";
import { buildTradingLedger, cashBalanceKrw, normalizeTrade } from "./trading-ledger";

const trade = (value: Partial<Trade> & Pick<Trade, "id" | "tradeType" | "tradedAt">): Trade => ({
  stockId: "s1", stockName: "테스트", planId: null, quantity: 0, price: 0,
  currency: "KRW", exchangeRate: 1, fee: 0, tax: 0, accountName: "계좌 A",
  memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3,
  ruleComplianceScore: 3, createdAt: value.tradedAt, ...value,
});

const account = (id: string, name: string): InvestmentAccount => ({
  id, name, institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW",
  isDefault: false, archivedAt: null, memo: "", createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

function trackedAccount(id: string, name: string, baselines: Array<{ currency: "KRW" | "USD"; balance: string; asOf?: string }>): InvestmentAccount {
  return {
    ...account(id, name),
    cashTracking: {
      version: 1,
      baselines: baselines.map((baseline) => ({
        ...baseline,
        asOf: baseline.asOf ?? "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })),
    },
  };
}

describe("trading ledger", () => {
  it("applies conservative defaults to a legacy Trade", () => {
    expect(normalizeTrade(trade({ id: "legacy", tradeType: "매수", tradedAt: "2026-01-01", quantity: 1, price: 100 }))).toMatchObject({ journalStatus: "recorded", origin: { kind: "legacy" } });
  });

  it("does not let journal, origin, or fee provenance change economic results", () => {
    const base = trade({ id: "metadata", tradeType: "매수", tradedAt: "2026-08-17", quantity: 1, price: 1000, fee: 1 });
    const feeCalculation: AccountFeeCalculationSnapshotV1 = {
      version: 1, policyAccountId: "historical-account", ruleId: "rule", ruleName: "Historical",
      market: "all", currency: "KRW", side: "buy", ratePercent: "0", fixedFee: "1",
      minimumFee: null, maximumFee: null, grossAmountFrom: null, grossAmountTo: null,
      effectiveFrom: "2026-01-01", effectiveTo: null, roundingMode: "floor", roundingUnit: "1",
      tradedAtDate: "2026-08-17", quantity: "1", price: "1000", grossAmount: "1000",
      calculatedFee: "1", calculatedAt: "2026-08-17T00:00:00Z",
    };
    const annotated = {
      ...base,
      journalStatus: "unreviewed" as const,
      origin: { kind: "fileImport" as const, sourceKey: "file:v1:abc", importBatchId: "batch", importedAt: "2026-08-17", sourceRow: 2, timePrecision: "date" as const },
      feeMode: "accountPolicy" as const,
      feeCalculation,
    };
    expect(buildTradingLedger([annotated]).positions).toEqual(buildTradingLedger([base]).positions);
    expect(buildTradingLedger([annotated]).tradeCapitalBalances).toEqual(buildTradingLedger([base]).tradeCapitalBalances);
  });

  it("treats missing or null cashTracking as untracked without mutating the Account", () => {
    const missing = account("a", "A");
    const nullable = { ...account("b", "B"), cashTracking: null };
    const trades = [
      trade({ id: "deposit-a", tradeType: "입금", tradedAt: "2026-01-02", stockId: null, amount: 100, accountId: "a", accountName: "A" }),
      trade({ id: "withdrawal-a", tradeType: "출금", tradedAt: "2026-01-03", stockId: null, amount: 25, accountId: "a", accountName: "A" }),
      trade({ id: "buy-b", tradeType: "매수", tradedAt: "2026-01-02", quantity: 1, price: 20, accountId: "b", accountName: "B" }),
      trade({ id: "sell-b", tradeType: "매도", tradedAt: "2026-01-03", quantity: 1, price: 25, accountId: "b", accountName: "B" }),
    ];
    const ledger = buildTradingLedger(trades, [missing, nullable]);
    expect(ledger.cashBalances).toEqual([]);
    expect(ledger.calculations["deposit-a"].cashEffect).toBeNull();
    expect(ledger.calculations["buy-b"].cashEffect).toBeNull();
    expect(ledger.calculations["sell-b"].cashEffect).toBeNull();
    expect(ledger.calculations["buy-b"].capitalEffect).toBe(20);
    expect(missing).not.toHaveProperty("cashTracking");
    expect(nullable.cashTracking).toBeNull();
  });

  it("keeps account identity by accountId while using the current Account name", () => {
    const entity = trackedAccount("account-1", "현재 이름", [{ currency: "KRW", balance: "0", asOf: "2025-12-31T00:00:00.000Z" }]);
    const ledger = buildTradingLedger([
      trade({ id: "a", tradeType: "입금", tradedAt: "2026-01-01", stockId: null, amount: 100, accountId: entity.id, accountName: "옛 이름" }),
      trade({ id: "b", tradeType: "입금", tradedAt: "2026-01-02", stockId: null, amount: 200, accountId: entity.id, accountName: "다른 스냅샷" }),
    ], [entity]);
    expect(ledger.cashBalances).toEqual([expect.objectContaining({ accountId: entity.id, accountName: "현재 이름", balance: 300 })]);
  });

  it("keeps positions separate for different account IDs with the same name", () => {
    const ledger = buildTradingLedger([
      trade({ id: "a", tradeType: "매수", tradedAt: "2026-01-01", quantity: 1, price: 100, accountId: "account-1", accountName: "같은 이름" }),
      trade({ id: "b", tradeType: "매수", tradedAt: "2026-01-01", quantity: 2, price: 100, accountId: "account-2", accountName: "같은 이름" }),
    ]);
    expect(ledger.positions).toHaveLength(2);
    expect(ledger.tradeCapitalBalances).toHaveLength(2);
    expect(ledger.cashBalances).toHaveLength(0);
  });

  it("recalculates split buys and a partial sell while keeping capital separate from cost", () => {
    const ledger = buildTradingLedger([
      trade({ id: "b2", tradeType: "매수", tradedAt: "2026-01-02", quantity: 10, price: 120 }),
      trade({ id: "b1", tradeType: "매수", tradedAt: "2026-01-01", quantity: 10, price: 100 }),
      trade({ id: "s1", tradeType: "매도", tradedAt: "2026-01-03", quantity: 5, price: 150, fee: 5 }),
    ]);
    expect(ledger.positions[0]).toMatchObject({ quantity: 15, averagePrice: 110, investedAmountKrw: 1650 });
    expect(ledger.calculations.s1).toMatchObject({ realizedProfit: 195, capitalEffect: -745, capitalEffectKrw: -745, cashEffect: null });
    expect(ledger.totalNetTradeCapitalKrw).toBe(1455);
    expect(ledger.cashBalances).toEqual([]);
  });

  it("calculates buy/sell capital with fees, tax, FX, account, and Currency aggregation", () => {
    const ledger = buildTradingLedger([
      trade({ id: "usd-buy", tradeType: "매수", tradedAt: "2026-01-01", quantity: 2, price: 10, fee: 1, currency: "USD", exchangeRate: 1300, accountId: "a", accountName: "A" }),
      trade({ id: "usd-sell", tradeType: "매도", tradedAt: "2026-01-02", quantity: 1, price: 15, fee: 1, tax: 1, currency: "USD", exchangeRate: 1400, accountId: "a", accountName: "A" }),
      trade({ id: "krw-buy", tradeType: "매수", tradedAt: "2026-01-01", stockId: "s2", stockName: "둘", quantity: 1, price: 100, fee: 2, tax: 3, accountId: "b", accountName: "B" }),
    ]);
    expect(ledger.calculations["usd-buy"]).toMatchObject({ capitalEffect: 21, capitalEffectKrw: 27_300 });
    expect(ledger.calculations["usd-sell"]).toMatchObject({ capitalEffect: -13, capitalEffectKrw: -18_200 });
    expect(ledger.calculations["krw-buy"]).toMatchObject({ capitalEffect: 105, capitalEffectKrw: 105 });
    expect(ledger.tradeCapitalBalances).toEqual([
      expect.objectContaining({ accountId: "a", currency: "USD", netAmount: 8, netAmountKrw: 9_100 }),
      expect.objectContaining({ accountId: "b", currency: "KRW", netAmount: 105, netAmountKrw: 105 }),
    ]);
    expect(ledger.totalNetTradeCapitalKrw).toBe(9_205);
  });

  it("excludes opening positions and all non-security records from Net Trade Capital", () => {
    const entries = [
      trade({ id: "opening", tradeType: "매수", tradedAt: "2026-01-01", quantity: 2, price: 100, isOpeningPosition: true }),
      trade({ id: "dividend", tradeType: "배당", tradedAt: "2026-01-02", amount: 10 }),
      trade({ id: "deposit", tradeType: "입금", tradedAt: "2026-01-03", stockId: null, amount: 10 }),
      trade({ id: "withdrawal", tradeType: "출금", tradedAt: "2026-01-04", stockId: null, amount: 10 }),
    ];
    const ledger = buildTradingLedger(entries);
    expect(entries.map((entry) => ledger.calculations[entry.id].capitalEffect)).toEqual([null, null, null, null]);
    expect(ledger.tradeCapitalBalances).toEqual([]);
    expect(ledger.totalNetTradeCapitalKrw).toBe(0);
  });

  it("uses Decimal aggregation without binary floating-point drift", () => {
    const ledger = buildTradingLedger([1, 2, 3].map((number) => trade({ id: `buy-${number}`, tradeType: "매수", tradedAt: `2026-01-0${number}`, quantity: 1, price: 0.1 })));
    expect(ledger.tradeCapitalBalances[0].netAmount).toBe(0.3);
    expect(ledger.totalNetTradeCapitalKrw).toBe(0.3);
  });

  it("starts from the baseline and applies only records strictly after asOf", () => {
    const entity = trackedAccount("a", "A", [{ currency: "KRW", balance: "0", asOf: "2026-01-02T00:00:00.000Z" }]);
    const ledger = buildTradingLedger([
      trade({ id: "before", tradeType: "입금", tradedAt: "2026-01-01T23:59:59.999Z", stockId: null, amount: 10, accountId: "a" }),
      trade({ id: "equal", tradeType: "입금", tradedAt: "2026-01-02T00:00:00.000Z", stockId: null, amount: 20, accountId: "a" }),
      trade({ id: "after", tradeType: "입금", tradedAt: "2026-01-02T00:00:00.001Z", stockId: null, amount: 30, accountId: "a" }),
    ], [entity]);
    expect(ledger.cashBalances).toEqual([expect.objectContaining({ baselineBalance: 0, baselineAsOf: "2026-01-02T00:00:00.000Z", balance: 30, isNegative: false })]);
    expect(ledger.calculations.before.cashEffect).toBeNull();
    expect(ledger.calculations.equal.cashEffect).toBeNull();
    expect(ledger.calculations.after.cashEffect).toBe(30);
  });

  it("applies all post-baseline cash effects and exposes a negative tracked balance", () => {
    const entity = trackedAccount("a", "A", [{ currency: "KRW", balance: "100", asOf: "2026-01-01T00:00:00.000Z" }]);
    const ledger = buildTradingLedger([
      trade({ id: "buy", tradeType: "매수", tradedAt: "2026-01-02", quantity: 2, price: 100, fee: 2, tax: 1, accountId: "a" }),
      trade({ id: "sell", tradeType: "매도", tradedAt: "2026-01-03", quantity: 1, price: 150, fee: 3, tax: 2, accountId: "a" }),
      trade({ id: "dividend", tradeType: "배당", tradedAt: "2026-01-04", amount: 20, fee: 1, tax: 2, accountId: "a" }),
      trade({ id: "deposit", tradeType: "입금", tradedAt: "2026-01-05", stockId: null, amount: 10, fee: 1, tax: 2, accountId: "a" }),
      trade({ id: "withdrawal", tradeType: "출금", tradedAt: "2026-01-06", stockId: null, amount: 50, fee: 1, tax: 2, accountId: "a" }),
      trade({ id: "opening", tradeType: "매수", tradedAt: "2026-01-07", stockId: "s2", stockName: "기초", quantity: 1, price: 999, isOpeningPosition: true, accountId: "a" }),
    ], [entity]);
    expect(ledger.cashBalances[0]).toMatchObject({ baselineBalance: 100, balance: 16, isNegative: false });
    expect(ledger.calculations.buy.cashEffect).toBe(-203);
    expect(ledger.calculations.sell.cashEffect).toBe(145);
    expect(ledger.calculations.dividend.cashEffect).toBe(17);
    expect(ledger.calculations.deposit.cashEffect).toBe(10);
    expect(ledger.calculations.withdrawal.cashEffect).toBe(-53);
    expect(ledger.calculations.opening.cashEffect).toBeNull();

    const negative = buildTradingLedger([trade({ id: "buy-negative", tradeType: "매수", tradedAt: "2026-01-02", quantity: 2, price: 100, accountId: "a" })], [entity]);
    expect(negative.errors).toEqual([]);
    expect(negative.cashBalances[0]).toMatchObject({ balance: -100, isNegative: true });
  });

  it("applies paired transfer semantics only to tracked Account-Currency pairs", () => {
    const accounts = [
      trackedAccount("a", "A", [{ currency: "KRW", balance: "100", asOf: "2026-01-01T00:00:00.000Z" }]),
      trackedAccount("b", "B", [{ currency: "KRW", balance: "0", asOf: "2026-01-01T00:00:00.000Z" }]),
    ];
    const transfer = buildAccountTransfer(accounts, { sourceAccountId: "a", targetAccountId: "b", amount: 40, currency: "KRW", tradedAt: "2026-01-02", memo: "" }, "2026-01-02", "pair");
    const ledger = buildTradingLedger(transfer, accounts);
    expect(ledger.cashBalances.map((balance) => [balance.accountId, balance.balance])).toEqual([["a", 60], ["b", 40]]);
    expect(ledger.totalNetTradeCapitalKrw).toBe(0);
  });

  it("tracks only configured currencies and preserves actual zero as a CashBalance", () => {
    const accounts = [
      trackedAccount("a", "A", [{ currency: "KRW", balance: "10" }, { currency: "USD", balance: "2" }]),
      account("b", "B"),
    ];
    const ledger = buildTradingLedger([
      trade({ id: "zero", tradeType: "출금", tradedAt: "2026-01-02", stockId: null, amount: 10, accountId: "a" }),
      trade({ id: "usd", tradeType: "입금", tradedAt: "2026-01-02", stockId: null, amount: 3, currency: "USD", exchangeRate: 1400, accountId: "a" }),
      trade({ id: "untracked", tradeType: "입금", tradedAt: "2026-01-02", stockId: null, amount: 99, accountId: "b" }),
    ], accounts);
    expect(ledger.cashBalances.map((balance) => [balance.accountId, balance.currency, balance.balance])).toEqual([["a", "KRW", 0], ["a", "USD", 5]]);
    expect(ledger.calculations.untracked.cashEffect).toBeNull();
    expect(cashBalanceKrw(ledger, 1400)).toBe(7000);
  });

  it("preserves position protection, cycles, realized P&L, and trade ordering", () => {
    const oversell = buildTradingLedger([trade({ id: "sell", tradeType: "매도", tradedAt: "2026-01-01", quantity: 1, price: 100 })]);
    expect(oversell.errors[0].tradeId).toBe("sell");
    expect(oversell.tradeCapitalBalances).toEqual([]);

    const cycles = buildTradingLedger([
      trade({ id: "buy-1", tradeType: "매수", tradedAt: "2026-01-01T10:00:00+09:00", quantity: 1, price: 100, currency: "USD", exchangeRate: 1300 }),
      trade({ id: "sell-1", tradeType: "매도", tradedAt: "2026-01-01T02:00:00Z", quantity: 1, price: 100, currency: "USD", exchangeRate: 1400 }),
      trade({ id: "buy-2", tradeType: "매수", tradedAt: "2026-01-03T00:00:00Z", quantity: 1, price: 90, currency: "USD", exchangeRate: 1400 }),
    ]);
    expect(cycles.cycles).toHaveLength(2);
    expect(cycles.cycles[0].closedAt).toBe("2026-01-01T02:00:00Z");
    expect(cycles.calculations["sell-1"].realizedProfitKrw).toBe(10_000);
    expect(cycles.totalRealizedKrw).toBe(10_000);
  });

  it("keeps position economics invariant when cash tracking is enabled", () => {
    const trades = [
      trade({ id: "buy-1", tradeType: "매수", tradedAt: "2026-01-02", quantity: 2, price: 100, fee: 2, accountId: "a" }),
      trade({ id: "buy-2", tradeType: "매수", tradedAt: "2026-01-03", quantity: 3, price: 120, fee: 3, accountId: "a" }),
      trade({ id: "sell", tradeType: "매도", tradedAt: "2026-01-04", quantity: 2, price: 150, fee: 4, tax: 1, accountId: "a" }),
    ];
    const untracked = buildTradingLedger(trades, [account("a", "A")]);
    const tracked = buildTradingLedger(trades, [trackedAccount("a", "A", [{ currency: "KRW", balance: "1000", asOf: "2026-01-01T00:00:00.000Z" }])]);
    expect(tracked.positions).toEqual(untracked.positions);
    expect(tracked.cycles).toEqual(untracked.cycles);
    expect(tracked.totalRealizedKrw).toBe(untracked.totalRealizedKrw);
  });

  it("rejects invalid FX, timestamps, opening cash records, and duplicate IDs without side effects", () => {
    const ledger = buildTradingLedger([
      trade({ id: "invalid-fx", tradeType: "매수", tradedAt: "2026-01-01", quantity: 1, price: 100, exchangeRate: 1380 }),
      trade({ id: "invalid-time", tradeType: "입금", tradedAt: "not-a-date", stockId: null, amount: 100 }),
      trade({ id: "invalid-opening", tradeType: "입금", tradedAt: "2026-01-02", stockId: null, amount: 100, isOpeningPosition: true }),
      trade({ id: "duplicate", tradeType: "입금", tradedAt: "2026-01-03", stockId: null, amount: 100 }),
      trade({ id: "duplicate", tradeType: "입금", tradedAt: "2026-01-04", stockId: null, amount: 200 }),
    ]);
    expect(ledger.errors.map((error) => error.tradeId).sort()).toEqual(["duplicate", "invalid-fx", "invalid-opening", "invalid-time"]);
    expect(ledger.positions).toEqual([]);
    expect(ledger.tradeCapitalBalances).toEqual([]);
    expect(ledger.cashBalances).toEqual([]);
  });

  it("does not let cash-only amount override security gross", () => {
    const entity = trackedAccount("a", "A", [{ currency: "KRW", balance: "1000", asOf: "2026-01-01T00:00:00.000Z" }]);
    const ledger = buildTradingLedger([trade({ id: "buy", tradeType: "매수", tradedAt: "2026-01-02", quantity: 2, price: 100, amount: 1, accountId: "a" })], [entity]);
    expect(ledger.calculations.buy).toMatchObject({ capitalEffect: 200, cashEffect: -200 });
  });
});
