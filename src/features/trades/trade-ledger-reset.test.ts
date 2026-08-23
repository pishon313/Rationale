import { describe, expect, it, vi } from "vitest";
import type { InvestmentAccount } from "@/features/accounts/types";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { Stock } from "@/features/stocks/types";
import type { AccountFeeCalculationSnapshotV1, Trade } from "./types";
import {
  buildTradeLedgerReset,
  buildTradeLedgerResetUndo,
  persistTradeLedgerReset,
  tradeLedgerResetSnapshotCollection,
  TradeLedgerResetError,
  type TradeLedgerResetSnapshotV1,
} from "./trade-ledger-reset";

const before = "2026-08-20T00:00:00.000Z";
const resetAt = "2026-08-21T00:00:00.000Z";
const undoAt = "2026-08-22T00:00:00.000Z";
const accounts: InvestmentAccount[] = [
  { id: "a1", name: "Primary", institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: true, archivedAt: null, memo: "", createdAt: before, updatedAt: before },
  { id: "a2", name: "Secondary", institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: false, archivedAt: null, memo: "", createdAt: before, updatedAt: before },
];
const initializedStock: Stock = { ...sampleStocks[0], id: "s1", ticker: "ONE", name: "One", currency: "KRW", quantity: 0, averagePrice: 0, ledgerInitializedAt: before, deletedAt: null };
const feeSnapshot: AccountFeeCalculationSnapshotV1 = { version: 1, policyAccountId: "a1", ruleId: "historical", ruleName: "Historical", market: "all", currency: "KRW", side: "buy", ratePercent: "0", fixedFee: "3", minimumFee: null, maximumFee: null, grossAmountFrom: null, grossAmountTo: null, effectiveFrom: "2026-01-01", effectiveTo: null, roundingMode: "round", roundingUnit: "1", tradedAtDate: "2026-08-20", quantity: "2", price: "100", grossAmount: "200", calculatedFee: "3", calculatedAt: before };

function trade(id: string, overrides: Partial<Trade> = {}): Trade {
  return {
    id,
    stockId: "s1",
    stockName: "One",
    planId: null,
    tradeType: "매수",
    tradedAt: before,
    quantity: 2,
    price: 100,
    currency: "KRW",
    exchangeRate: 1,
    fee: 3,
    feeMode: "manual",
    feeCalculation: null,
    tax: 1,
    accountId: "a1",
    accountName: "Primary",
    memo: "memo",
    emotion: "평온",
    emotionIntensity: 1,
    confidenceScore: 3,
    ruleComplianceScore: 4,
    ruleViolations: [],
    journalStatus: "recorded",
    origin: { kind: "manual" },
    createdAt: before,
    updatedAt: before,
    deletedAt: null,
    ...overrides,
  };
}

function cash(id: string, tradeType: "입금" | "출금" | "배당", overrides: Partial<Trade> = {}) {
  return trade(id, { stockId: tradeType === "배당" ? "s1" : null, stockName: tradeType === "배당" ? "One" : "", tradeType, quantity: 0, price: 0, amount: 500, fee: 0, tax: 0, feeMode: undefined, feeCalculation: undefined, ...overrides });
}

function snapshot(ids: string[]): TradeLedgerResetSnapshotV1 {
  return { id: "latest", version: 1, resetAt, tradeIds: ids, createdAt: resetAt, updatedAt: resetAt };
}

describe("Trade-ledger reset builder", () => {
  it("returns a no-op when no canonical active Trade exists", () => {
    const deleted = trade("old", { deletedAt: before });
    const result = buildTradeLedgerReset({ trades: [deleted], stocks: [initializedStock], accounts, now: resetAt });
    expect(result).toMatchObject({ impact: { totalRecords: 0 }, snapshot: null, writes: [], stocksChanged: false });
    expect(result.nextTrades[0]).toBe(deleted);
  });

  it("soft-deletes every active type with one timestamp while preserving identity, economics, provenance, fees, and old tombstones", () => {
    const imported = trade("imported", { origin: { kind: "fileImport", sourceKey: "file:v2:key", importBatchId: "batch", importedAt: before, provider: "broker", externalExecutionId: "exec", sourceRow: 2 }, journalStatus: "unreviewed" });
    const opening = trade("opening", { isOpeningPosition: true, cashFlowKind: "opening", fee: 0, tax: 0, feeMode: undefined, feeCalculation: undefined });
    const transfer = [
      cash("pair-out", "출금", { accountId: "a1", accountName: "Primary", cashFlowKind: "transfer", transferId: "pair" }),
      cash("pair-in", "입금", { accountId: "a2", accountName: "Secondary", cashFlowKind: "transfer", transferId: "pair" }),
    ];
    const old = trade("old", { deletedAt: before, updatedAt: before });
    const active = [trade("buy", { feeMode: "accountPolicy", feeCalculation: feeSnapshot }), trade("sell", { tradeType: "매도", quantity: 1, tradedAt: "2026-08-20T01:00:00.000Z" }), cash("dividend", "배당"), cash("deposit", "입금"), cash("withdrawal", "출금"), imported, opening, ...transfer];
    const input = [...active, old];
    const frozen = structuredClone(input);

    const result = buildTradeLedgerReset({ trades: input, stocks: [initializedStock], accounts, now: resetAt });

    expect(input).toEqual(frozen);
    expect(result.impact).toEqual({ totalRecords: 9, securityRecords: 4, dividendRecords: 1, cashFlowRecords: 4, transferPairs: 1, openingPositions: 1, importedRecords: 1 });
    expect(result.snapshot?.tradeIds).toEqual(active.map((item) => item.id));
    expect(result.nextTrades.filter((item) => item.id !== "old").every((item) => item.deletedAt === resetAt && item.updatedAt === resetAt)).toBe(true);
    expect(result.nextTrades.find((item) => item.id === "old")).toBe(old);
    expect(result.nextTrades.find((item) => item.id === "imported")).toMatchObject({ id: imported.id, createdAt: imported.createdAt, origin: imported.origin, journalStatus: imported.journalStatus, fee: imported.fee, feeMode: imported.feeMode, feeCalculation: imported.feeCalculation });
    expect(result.nextTrades.find((item) => item.id === "buy")).toMatchObject({ fee: 3, feeMode: "accountPolicy", feeCalculation: feeSnapshot });
    expect(result.writes.map((write) => write.collection)).toEqual(["trades", tradeLedgerResetSnapshotCollection]);
  });

  it("includes a generated legacy opening position and atomically initializes only that Stock", () => {
    const legacy = { ...initializedStock, ledgerInitializedAt: null, quantity: 4, averagePrice: 25, thesisSummary: "Keep", currentPrice: 40 };
    const result = buildTradeLedgerReset({ trades: [], stocks: [legacy], accounts, now: resetAt });
    expect(result.impact).toMatchObject({ totalRecords: 1, openingPositions: 1 });
    expect(result.nextTrades[0]).toMatchObject({ id: "opening-position:s1", quantity: 4, price: 25, deletedAt: resetAt, updatedAt: resetAt, origin: { kind: "system" } });
    expect(result.nextStocks[0]).toMatchObject({ ledgerInitializedAt: resetAt, quantity: 0, averagePrice: 0, thesisSummary: "Keep", currentPrice: 40, updatedAt: resetAt });
    expect(result.writes.map((write) => write.collection)).toEqual(["trades", "stocks", tradeLedgerResetSnapshotCollection]);
  });

  it("fails closed for unresolved legacy holdings with no persistence plan", () => {
    const legacy = { ...initializedStock, ledgerInitializedAt: null, quantity: 2, averagePrice: 100 };
    expect(() => buildTradeLedgerReset({ trades: [trade("only-one", { quantity: 1 })], stocks: [legacy], accounts, now: resetAt }))
      .toThrow(expect.objectContaining({ code: "UNRESOLVED_LEGACY_STATE" }));
  });

  it("rejects duplicate IDs and a broken transfer pair", () => {
    expect(() => buildTradeLedgerReset({ trades: [trade("same"), trade("same")], stocks: [initializedStock], accounts, now: resetAt })).toThrow(TradeLedgerResetError);
    expect(() => buildTradeLedgerReset({ trades: [cash("out", "출금", { cashFlowKind: "transfer", transferId: "broken" })], stocks: [initializedStock], accounts, now: resetAt })).toThrow(TradeLedgerResetError);
  });

  it("persists all candidate writes through one supplied atomic boundary", async () => {
    const plan = buildTradeLedgerReset({ trades: [trade("buy")], stocks: [initializedStock], accounts, now: resetAt });
    const save = vi.fn(async () => undefined);
    await persistTradeLedgerReset(plan, save);
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith(plan.writes);
  });

  it("includes sample Trades in the local reset snapshot", () => {
    const sample = trade("sample:v1:trade:buy");
    const result = buildTradeLedgerReset({ trades: [sample], stocks: [initializedStock], accounts, now: resetAt });
    expect(result.snapshot?.tradeIds).toEqual([sample.id]);
    expect(result.nextTrades[0]).toMatchObject({ id: sample.id, deletedAt: resetAt });
  });
});

describe("Trade-ledger reset undo builder", () => {
  it("restores the exact affected IDs and fields, preserves new Trades and unrelated tombstones, and clears the snapshot atomically", () => {
    const affected = [trade("buy", { deletedAt: resetAt, updatedAt: resetAt }), cash("deposit", "입금", { deletedAt: resetAt, updatedAt: resetAt })];
    const newer = cash("new", "입금", { tradedAt: undoAt, createdAt: undoAt, updatedAt: undoAt });
    const old = trade("old", { deletedAt: before, updatedAt: before });
    const result = buildTradeLedgerResetUndo({ currentTrades: [...affected, newer, old], accounts, snapshot: snapshot(affected.map((item) => item.id)), now: undoAt });
    expect(result.restoredCount).toBe(2);
    expect(result.nextTrades.find((item) => item.id === "buy")).toMatchObject({ id: "buy", createdAt: before, quantity: 2, price: 100, deletedAt: null, updatedAt: undoAt });
    expect(result.nextTrades.find((item) => item.id === "new")).toBe(newer);
    expect(result.nextTrades.find((item) => item.id === "old")).toBe(old);
    expect(result.writes).toEqual([{ collection: "trades", values: result.nextTrades }, { collection: tradeLedgerResetSnapshotCollection, values: [] }]);
  });

  it("restores both transfer legs together", () => {
    const pair = [
      cash("out", "출금", { accountId: "a1", accountName: "Primary", cashFlowKind: "transfer", transferId: "pair", deletedAt: resetAt, updatedAt: resetAt }),
      cash("in", "입금", { accountId: "a2", accountName: "Secondary", cashFlowKind: "transfer", transferId: "pair", deletedAt: resetAt, updatedAt: resetAt }),
    ];
    const result = buildTradeLedgerResetUndo({ currentTrades: pair, accounts, snapshot: snapshot(["out", "in"]), now: undoAt });
    expect(result.nextTrades.every((item) => item.deletedAt === null)).toBe(true);
  });

  it.each([
    ["missing", []],
    ["already restored", [trade("buy", { deletedAt: null, updatedAt: resetAt })]],
    ["modified tombstone", [trade("buy", { deletedAt: resetAt, updatedAt: undoAt })]],
    ["re-deleted", [trade("buy", { deletedAt: undoAt, updatedAt: undoAt })]],
  ])("blocks a stale snapshot when an affected Trade is %s", (_label, currentTrades) => {
    expect(() => buildTradeLedgerResetUndo({ currentTrades, accounts, snapshot: snapshot(["buy"]), now: undoAt }))
      .toThrow(expect.objectContaining({ code: "STALE_SNAPSHOT" }));
  });

  it("fails closed when restored and post-reset transfer records interact into an invalid pair", () => {
    const restoredPair = [
      cash("old-out", "출금", { accountId: "a1", cashFlowKind: "transfer", transferId: "same-pair", deletedAt: resetAt, updatedAt: resetAt }),
      cash("old-in", "입금", { accountId: "a2", accountName: "Secondary", cashFlowKind: "transfer", transferId: "same-pair", deletedAt: resetAt, updatedAt: resetAt }),
    ];
    const newPair = [
      cash("new-out", "출금", { accountId: "a1", cashFlowKind: "transfer", transferId: "same-pair", tradedAt: undoAt, createdAt: undoAt, updatedAt: undoAt }),
      cash("new-in", "입금", { accountId: "a2", accountName: "Secondary", cashFlowKind: "transfer", transferId: "same-pair", tradedAt: undoAt, createdAt: undoAt, updatedAt: undoAt }),
    ];
    expect(() => buildTradeLedgerResetUndo({ currentTrades: [...restoredPair, ...newPair], accounts, snapshot: snapshot(["old-out", "old-in"]), now: undoAt })).toThrow(TradeLedgerResetError);
  });
});
