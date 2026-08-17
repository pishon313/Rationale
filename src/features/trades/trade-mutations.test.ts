import { describe, expect, it, vi } from "vitest";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Trade } from "./types";
import { buildSoftDeletedTrades, commitTradeMutation } from "./trade-mutations";

const now = "2026-01-01T00:00:00.000Z";
const account = { id: "account", name: "Account", institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: true, archivedAt: null, memo: "", createdAt: now, updatedAt: now } as InvestmentAccount;

describe("trade mutations", () => {
  it("persists a valid buy once", async () => {
    const replaceTrades = vi.fn().mockResolvedValue(undefined);
    const result = await commitTradeMutation({ currentTrades: [], nextTrades: [trade("buy", "매수", 3)], accounts: [account], changedId: "buy", replaceTrades });
    expect(result.ok).toBe(true);
    expect(replaceTrades).toHaveBeenCalledTimes(1);
  });

  it("does not persist an invalid sell", async () => {
    const replaceTrades = vi.fn().mockResolvedValue(undefined);
    const result = await commitTradeMutation({ currentTrades: [], nextTrades: [trade("sell", "매도", 1)], accounts: [account], changedId: "sell", replaceTrades });
    expect(result.ok).toBe(false);
    expect(replaceTrades).not.toHaveBeenCalled();
  });

  it("rejects an edit or delete that invalidates a later sell", async () => {
    const buy = trade("buy", "매수", 5);
    const sell = { ...trade("sell", "매도", 4), tradedAt: "2026-01-02T00:00:00.000Z", createdAt: "2026-01-02T00:00:00.000Z" };
    const replaceTrades = vi.fn().mockResolvedValue(undefined);
    const edit = await commitTradeMutation({ currentTrades: [buy, sell], nextTrades: [{ ...buy, quantity: 3 }, sell], accounts: [account], changedId: "buy", replaceTrades });
    const deletion = buildSoftDeletedTrades([buy, sell], buy, "2026-01-03T00:00:00.000Z");
    const remove = await commitTradeMutation({ currentTrades: [buy, sell], nextTrades: deletion, accounts: [account], changedId: "buy", replaceTrades });
    expect(edit.ok).toBe(false);
    expect(remove.ok).toBe(false);
    expect(replaceTrades).not.toHaveBeenCalled();
  });

  it("soft deletes a valid trade and persists once", async () => {
    const buy = trade("buy", "매수", 5);
    const next = buildSoftDeletedTrades([buy], buy, "2026-01-02T00:00:00.000Z");
    const replaceTrades = vi.fn().mockResolvedValue(undefined);
    const result = await commitTradeMutation({ currentTrades: [buy], nextTrades: next, accounts: [account], changedId: "buy", replaceTrades });
    expect(result.ok).toBe(true);
    expect(next[0]).toMatchObject({ deletedAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" });
    expect(replaceTrades).toHaveBeenCalledTimes(1);
  });

  it("does not persist a broken transfer pair", async () => {
    const orphan = { ...trade("transfer", "매도", 1), stockId: null, stockName: "", tradeType: "출금" as const, quantity: 0, price: 0, amount: 100, cashFlowKind: "transfer" as const, transferId: "pair" };
    const replaceTrades = vi.fn().mockResolvedValue(undefined);
    const result = await commitTradeMutation({ currentTrades: [], nextTrades: [orphan], accounts: [account], replaceTrades });
    expect(result.ok).toBe(false);
    expect(replaceTrades).not.toHaveBeenCalled();
  });

  it("does not persist invalid fee provenance metadata", async () => {
    const replaceTrades = vi.fn().mockResolvedValue(undefined);
    const invalid = { ...trade("invalid-fee", "매수", 1), feeMode: "accountPolicy" as const, feeCalculation: null };
    const result = await commitTradeMutation({ currentTrades: [], nextTrades: [invalid], accounts: [account], changedId: invalid.id, replaceTrades });
    expect(result.ok).toBe(false);
    expect(replaceTrades).not.toHaveBeenCalled();
  });

  it("rejects duplicate IDs across active and deleted records before persistence", async () => {
    const active = trade("duplicate", "매수", 1);
    const deleted = { ...active, deletedAt: "2026-01-02T00:00:00.000Z" };
    const replaceTrades = vi.fn().mockResolvedValue(undefined);
    const result = await commitTradeMutation({ currentTrades: [], nextTrades: [active, deleted], accounts: [account], replaceTrades });
    expect(result).toEqual({ ok: false, error: "중복된 거래 ID가 있어 저장할 수 없습니다." });
    expect(replaceTrades).not.toHaveBeenCalled();
  });
});

function trade(id: string, tradeType: "매수" | "매도", quantity: number): Trade {
  return { id, stockId: "stock", stockName: "Stock", planId: null, tradeType, tradedAt: now, quantity, price: 100, currency: "KRW", exchangeRate: 1, fee: 0, tax: 0, accountId: account.id, accountName: account.name, memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, createdAt: now, updatedAt: now, deletedAt: null };
}
