import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleTrades } from "@/features/trades/sample-data";
import { buildTradingLedger } from "@/domain/trading-ledger";
import type { InvestmentAccount } from "./types";
import { archiveAccount, buildAccountMerge, ledgerEconomicSnapshot, mergeAccounts, withSingleDefault } from "./account-operations";
import type { AccountFeePolicyV1 } from "./account-fee-policy";
import type { AccountFeeCalculationSnapshotV1 } from "@/features/trades/types";

const repository = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/lib/local-repository", () => ({ saveCollectionsAtomically: repository.save }));

const now = "2026-08-08T00:00:00.000Z";
const account = (id: string, name: string, isDefault = false): InvestmentAccount => ({ id, name, institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault, archivedAt: null, memo: "", createdAt: now, updatedAt: now });
const feePolicy: AccountFeePolicyV1 = { version: 1, enabled: true, rules: [{ id: "r1", name: "기본", market: "all", currency: "KRW", side: "both", ratePercent: "0.1", fixedFee: "0", minimumFee: null, maximumFee: null, grossAmountFrom: null, grossAmountTo: null, effectiveFrom: "2026-01-01", effectiveTo: null, roundingMode: "floor", roundingUnit: "1" }] };

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
  it("preserves fee policies through edit/default, archive, and merge while leaving historical fees unchanged", () => {
    const source = { ...account("a", "A", true), feePolicy };
    const targetPolicy = { ...feePolicy, rules: [{ ...feePolicy.rules[0], id: "target-rule", ratePercent: "0.2" }] };
    const target = { ...account("b", "B"), feePolicy: targetPolicy };
    expect(withSingleDefault([source, target], { ...source, name: "Renamed" }).find((item) => item.id === "a")?.feePolicy).toEqual(feePolicy);
    expect(archiveAccount([source, target], "a", buildTradingLedger([], [source, target]), now).find((item) => item.id === "a")?.feePolicy).toEqual(feePolicy);
    const feeCalculation: AccountFeeCalculationSnapshotV1 = { version: 1, policyAccountId: "a", ruleId: "r1", ruleName: "기본", market: "all", currency: "KRW", side: "buy", ratePercent: "0", fixedFee: "7", minimumFee: null, maximumFee: null, grossAmountFrom: null, grossAmountTo: null, effectiveFrom: "2026-01-01", effectiveTo: null, roundingMode: "floor", roundingUnit: "1", tradedAtDate: "2026-01-01", quantity: "1", price: "100", grossAmount: "100", calculatedFee: "7", calculatedAt: "2026-01-01T00:00:00Z" };
    const historical = { ...security("history", "a", "AAPL", "매수", 1, 100, "2026-01-01"), fee: 7, feeMode: "accountPolicy" as const, feeCalculation };
    const writes = buildAccountMerge([source, target], [historical], "a", "b", now);
    const accounts = writes.find((write) => write.collection === "accounts")!.values as InvestmentAccount[];
    const trades = writes.find((write) => write.collection === "trades")!.values as typeof historical[];
    expect(accounts.find((item) => item.id === "a")?.feePolicy).toEqual(feePolicy);
    expect(accounts.find((item) => item.id === "b")?.feePolicy).toEqual(targetPolicy);
    expect(trades[0].fee).toBe(7);
    expect(trades[0].feeCalculation).toEqual(feeCalculation);
    expect(trades[0].feeCalculation?.policyAccountId).toBe("a");
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
