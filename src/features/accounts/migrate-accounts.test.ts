import { describe, expect, it, vi } from "vitest";
import type { Trade } from "@/features/trades/types";
import { migrateLegacyAccounts, persistLegacyAccountMigration } from "./migrate-accounts";

const trade = (id: string, accountName: string, accountId?: string | null): Trade => ({ id, stockId: null, stockName: "", planId: null, tradeType: "입금", tradedAt: "2026-01-01", quantity: 0, price: 0, amount: 100, currency: "KRW", exchangeRate: 1, fee: 0, tax: 0, accountId, accountName, memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, createdAt: "2026-01-01" });

describe("legacy account migration", () => {
  it("동일한 계좌명은 하나의 계좌와 동일 accountId로 이관한다", () => {
    const result = migrateLegacyAccounts([], [trade("a", " 미래에셋 "), trade("b", "미래에셋")], "2026-01-02");
    expect(result.accounts).toHaveLength(1);
    expect(result.trades[0].accountId).toBe(result.trades[1].accountId);
  });

  it("서로 다른 이름은 서로 다른 계좌가 된다", () => {
    const result = migrateLegacyAccounts([], [trade("a", "A"), trade("b", "B")]);
    expect(new Set(result.trades.map((item) => item.accountId)).size).toBe(2);
  });

  it("재실행해도 계좌를 중복 생성하지 않는다", () => {
    const first = migrateLegacyAccounts([], [trade("a", "A")]);
    const second = migrateLegacyAccounts(first.accounts, first.trades);
    expect(second.changed).toBe(false);
    expect(second.accounts).toHaveLength(1);
  });

  it("원자 저장 실패 시 호출자가 부분 결과를 적용하지 않는다", async () => {
    const save = vi.fn().mockRejectedValue(new Error("disk full"));
    const accounts: never[] = [];
    const trades = [trade("a", "A")];
    await expect(persistLegacyAccountMigration(accounts, trades, save)).rejects.toThrow("disk full");
    expect(accounts).toEqual([]);
    expect(trades[0].accountId).toBeUndefined();
    expect(save).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ collection: "accounts" }), expect.objectContaining({ collection: "trades" })]));
  });
});
