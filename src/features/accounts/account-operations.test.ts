import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleTrades } from "@/features/trades/sample-data";
import { buildTradingLedger } from "@/domain/trading-ledger";
import type { InvestmentAccount } from "./types";
import { archiveAccount, buildAccountMerge, ledgerEconomicSnapshot, mergeAccounts, withSingleDefault } from "./account-operations";

const repository = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/lib/local-repository", () => ({ saveCollectionsAtomically: repository.save }));

const now = "2026-08-08T00:00:00.000Z";
const account = (id: string, name: string, isDefault = false): InvestmentAccount => ({ id, name, institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault, archivedAt: null, memo: "", createdAt: now, updatedAt: now });

describe("account operations", () => {
  beforeEach(() => repository.save.mockReset());
  it("allows a zero-balance account and keeps at most one default", () => {
    const result = withSingleDefault([account("a", "A", true)], account("b", "B", true));
    expect(result.filter((item) => item.isDefault).map((item) => item.id)).toEqual(["b"]);
    expect(result[0]).not.toHaveProperty("balance");
  });
  it("archives instead of deleting and promotes another active default", () => {
    const result = archiveAccount([account("a", "A", true), account("b", "B")], "a", buildTradingLedger([], [account("a", "A", true), account("b", "B")]), now);
    expect(result).toHaveLength(2); expect(result.find((item) => item.id === "a")?.archivedAt).toBe(now); expect(result.find((item) => item.id === "b")?.isDefault).toBe(true);
  });
  it("blocks archive while positions or cash remain and allows a zero-balance account", () => {
    const entities = [account("a", "A", true), account("b", "B")];
    const position = [security("buy", "a", "NVDA", "매수", 1, 100, "2026-01-01")];
    expect(() => archiveAccount(entities, "a", buildTradingLedger(position, entities), now)).toThrow("보유 자산 또는 현금");
    const cash = [{ ...sampleTrades[0], id: "cash", stockId: null, stockName: "", accountId: "a", accountName: "A", tradeType: "입금" as const, quantity: 0, price: 0, amount: 100 }];
    expect(() => archiveAccount(entities, "a", buildTradingLedger(cash, entities), now)).toThrow("보유 자산 또는 현금");
    expect(archiveAccount(entities, "a", buildTradingLedger([], entities), now).find((item) => item.id === "a")?.archivedAt).toBe(now);
  });
  it("merges by accountId without rewriting legacy accountName", () => {
    const trades = [{ ...sampleTrades[0], accountId: "a", accountName: "Old snapshot" }];
    const writes = buildAccountMerge([account("a", "Renamed"), account("b", "Target")], trades, "a", "b", now);
    const merged = writes.find((write) => write.collection === "trades")?.values[0] as typeof trades[number];
    expect(merged.accountId).toBe("b"); expect(merged.accountName).toBe("Old snapshot");
  });
  it("rejects an invalid merge before persistence", () => {
    expect(() => buildAccountMerge([account("a", "A")], [], "a", "a", now)).toThrow("서로 다른 계좌");
  });
  it("rejects an overlapping history that changes realized profit and never persists", async () => {
    const trades = [security("b-buy", "b", "NVDA", "매수", 10, 200, "2026-01-01"), security("a-buy", "a", "NVDA", "매수", 10, 100, "2026-01-02"), security("a-sell", "a", "NVDA", "매도", 10, 150, "2026-01-03")];
    await expect(mergeAccounts([account("a", "A"), account("b", "B")], trades, "a", "b")).rejects.toThrow("원장 계산 결과");
    expect(repository.save).not.toHaveBeenCalled();
  });
  it("allows disjoint securities and preserves realized profit and invested basis atomically", async () => {
    repository.save.mockResolvedValue(undefined);
    const trades = [security("a-buy", "a", "AAPL", "매수", 10, 100, "2026-01-01"), security("a-sell", "a", "AAPL", "매도", 10, 150, "2026-01-02"), security("b-buy", "b", "NVDA", "매수", 10, 200, "2026-01-03")];
    const entities = [account("a", "A"), account("b", "B")];
    const before = ledgerEconomicSnapshot(buildTradingLedger(trades, entities));
    const writes = buildAccountMerge(entities, trades, "a", "b", now);
    const nextAccounts = writes.find((write) => write.collection === "accounts")!.values as InvestmentAccount[];
    const nextTrades = writes.find((write) => write.collection === "trades")!.values as typeof trades;
    const after = ledgerEconomicSnapshot(buildTradingLedger(nextTrades, nextAccounts));
    expect(after.totalRealizedKrw).toBeCloseTo(before.totalRealizedKrw, 8);
    expect(after.positions.reduce((sum, position) => sum + position.investedAmountKrw, 0)).toBeCloseTo(before.positions.reduce((sum, position) => sum + position.investedAmountKrw, 0), 8);
    await mergeAccounts(entities, trades, "a", "b");
    expect(repository.save).toHaveBeenCalledTimes(1);
    expect(repository.save.mock.calls[0][0].map((write: { collection: string }) => write.collection)).toEqual(["accounts", "trades"]);
  });
});

function security(id: string, accountId: string, stockId: string, tradeType: "매수" | "매도", quantity: number, price: number, tradedAt: string) {
  return { ...sampleTrades[0], id, accountId, accountName: accountId.toUpperCase(), stockId, stockName: stockId, tradeType, quantity, price, tradedAt, createdAt: tradedAt, updatedAt: tradedAt };
}
