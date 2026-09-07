import { describe, expect, it, vi } from "vitest";
import { buildLongTermPerformance } from "@/domain/account-performance";
import { buildTradingLedger } from "@/domain/trading-ledger";
import type { Trade } from "@/features/trades/types";
import { buildAccountTransfer, deleteAccountTransfer, getTransferPair, saveAccountTransfer, updateAccountTransfer, validateTransferPairs } from "./account-transfer";
import type { InvestmentAccount } from "./types";

const now = "2026-01-01T00:00:00.000Z";
const accounts: InvestmentAccount[] = ["a", "b"].map((id, index) => ({
  id, name: id.toUpperCase(), institution: "", kind: "brokerage", subtype: "",
  baseCurrency: "KRW", isDefault: index === 0, archivedAt: null, memo: "",
  cashTracking: { version: 1, baselines: [{ currency: "KRW", balance: "0", asOf: "2025-12-31T00:00:00.000Z", createdAt: "2025-12-31T00:00:00.000Z", updatedAt: "2025-12-31T00:00:00.000Z" }] },
  createdAt: now, updatedAt: now,
}));
const cash = (id: string, accountId: string, type: "입금" | "출금", amount: number, kind?: Trade["cashFlowKind"]): Trade => ({
  id, stockId: null, stockName: "", planId: null, tradeType: type, tradedAt: now,
  quantity: 0, price: 0, amount, currency: "KRW", exchangeRate: 1, fee: 0, tax: 0,
  accountId, accountName: accountId.toUpperCase(), cashFlowKind: kind, memo: "",
  emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 5,
  createdAt: now, updatedAt: now, deletedAt: null,
});
const rates = { KRW: 1, USD: 1400, JPY: 9, EUR: 1600, CAD: 1000, HKD: 177 };

describe("cash flow semantics", () => {
  it("applies reconciliation to tracked cash without inferring performance", () => {
    const trades = [cash("r", "a", "입금", 30_000, "reconciliation")];
    const ledger = buildTradingLedger(trades, accounts);
    const result = buildLongTermPerformance(trades, [], ledger, rates, new Date("2027-01-01"), accounts);
    expect(ledger.cashBalances.find((item) => item.accountId === "a")?.balance).toBe(30_000);
    expect(result).toMatchObject({ cashKrw: 30_000, totalAssetsKrw: 30_000, netContributionsKrw: null, totalProfitKrw: null, xirrPercent: null });
  });

  it("keeps legacy cash events as records and applies them only after a baseline", () => {
    const trades = [
      cash("deposit", "a", "입금", 100_000, "external"),
      { ...cash("reconcile", "a", "출금", 20_000, "reconciliation"), tradedAt: "2026-06-01T00:00:00.000Z" },
    ];
    const result = buildLongTermPerformance(trades, [], buildTradingLedger(trades, accounts), rates, new Date("2027-01-01"), accounts);
    expect(result).toMatchObject({ cashKrw: 80_000, totalAssetsKrw: 80_000, netContributionsKrw: null, totalProfitKrw: null, xirrPercent: null });
  });

  it("keeps real cash gains visible without inferring full-account profit", () => {
    const dividend = { ...cash("gain", "a", "입금", 20_000), tradeType: "배당" as const, stockId: "stock", stockName: "Stock", cashFlowKind: undefined };
    const trades = [cash("deposit", "a", "입금", 100_000, "external"), cash("reconcile", "a", "입금", 30_000, "reconciliation"), dividend];
    const result = buildLongTermPerformance(trades, [], buildTradingLedger(trades, accounts), rates, new Date("2027-01-01"), accounts);
    expect(result).toMatchObject({ cashKrw: 150_000, totalAssetsKrw: 150_000, totalProfitKrw: null });
  });

  it("does not turn a legacy external deposit into inferred contributions", () => {
    const trades = [cash("deposit", "a", "입금", 100_000)];
    const result = buildLongTermPerformance(trades, [], buildTradingLedger(trades, accounts), rates, new Date("2027-01-01"), accounts);
    expect(result).toMatchObject({ cashKrw: 100_000, netContributionsKrw: null });
  });

  it("moves tracked cash between Accounts while keeping the aggregate unchanged", () => {
    const opening = cash("deposit", "a", "입금", 100_000, "external");
    const pair = buildAccountTransfer(accounts, { sourceAccountId: "a", targetAccountId: "b", amount: 40_000, currency: "KRW", tradedAt: now, memo: "" }, now, "transfer");
    const trades = [opening, ...pair];
    const ledger = buildTradingLedger(trades, accounts);
    const result = buildLongTermPerformance(trades, [], ledger, rates, new Date("2027-01-01"), accounts);
    expect(result.cashKrw).toBe(100_000);
    expect(result.netContributionsKrw).toBeNull();
    expect(result.accounts.find((item) => item.accountId === "a")?.cashKrw).toBe(60_000);
    expect(result.accounts.find((item) => item.accountId === "b")?.cashKrw).toBe(40_000);
  });

  it("rejects invalid transfers and writes the pair in one collection save", async () => {
    expect(() => buildAccountTransfer(accounts, { sourceAccountId: "a", targetAccountId: "a", amount: 1, currency: "KRW", tradedAt: now, memo: "" })).toThrow();
    const save = vi.fn().mockRejectedValue(new Error("disk"));
    const existing = [cash("deposit", "a", "입금", 1)];
    await expect(saveAccountTransfer(existing, accounts, { sourceAccountId: "a", targetAccountId: "b", amount: 1, currency: "KRW", tradedAt: now, memo: "" }, save)).rejects.toThrow("disk");
    expect(save).toHaveBeenCalledTimes(1);
    expect(existing).toHaveLength(1);
  });

  it("edits both transfer entries while preserving transfer and Trade IDs", () => {
    const pair = buildAccountTransfer(accounts, { sourceAccountId: "a", targetAccountId: "b", amount: 10, currency: "KRW", tradedAt: now, memo: "old" }, now, "pair");
    const next = updateAccountTransfer(pair, accounts, "pair", { sourceAccountId: "b", targetAccountId: "a", amount: 25, currency: "USD", tradedAt: "2026-02-01T00:00:00.000Z", memo: "new" }, "2026-02-02T00:00:00.000Z");
    expect(next.map((item) => item.id)).toEqual(pair.map((item) => item.id));
    expect(next.every((item) => item.transferId === "pair" && item.amount === 25 && item.currency === "USD" && item.tradedAt === "2026-02-01T00:00:00.000Z")).toBe(true);
    expect(getTransferPair(next, "pair").outgoing.accountId).toBe("b");
  });

  it("soft-deletes both sides with one timestamp", () => {
    const pair = buildAccountTransfer(accounts, { sourceAccountId: "a", targetAccountId: "b", amount: 10, currency: "KRW", tradedAt: now, memo: "" }, now, "pair");
    const deleted = deleteAccountTransfer(pair, "pair", "2026-03-01T00:00:00.000Z");
    expect(deleted.every((item) => item.deletedAt === "2026-03-01T00:00:00.000Z" && item.updatedAt === "2026-03-01T00:00:00.000Z")).toBe(true);
  });

  it("rejects missing and mismatched transfer pairs", () => {
    const pair = buildAccountTransfer(accounts, { sourceAccountId: "a", targetAccountId: "b", amount: 10, currency: "KRW", tradedAt: now, memo: "" }, now, "pair");
    expect(() => validateTransferPairs(pair.slice(0, 1))).toThrow("두 건");
    expect(() => validateTransferPairs([pair[0], { ...pair[1], amount: 11 }])).toThrow("일치");
    expect(() => validateTransferPairs([pair[0], { ...pair[1], currency: "USD" }])).toThrow("일치");
  });

  it("keeps a valid tracked transfer cash-net-zero", () => {
    const pair = buildAccountTransfer(accounts, { sourceAccountId: "a", targetAccountId: "b", amount: 10, currency: "KRW", tradedAt: now, memo: "" }, now, "pair");
    validateTransferPairs(pair);
    const ledger = buildTradingLedger(pair, accounts);
    expect(ledger.cashBalances.reduce((sum, item) => sum + item.balance, 0)).toBe(0);
  });
});
