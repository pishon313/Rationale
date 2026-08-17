import { describe, expect, it, vi } from "vitest";
import type { InvestmentAccount } from "@/features/accounts/types";
import { buildTradingLedger } from "@/domain/trading-ledger";
import type { Stock } from "@/features/stocks/types";
import type { AccountFeeCalculationSnapshotV1, Trade } from "@/features/trades/types";
import { MockSyncTransport } from "./mock-sync-transport";
import { mergeSyncCollections } from "./sync-merge";
import { fromStockSyncPayload, isSyncableRecord, recordNameFor, toAccountSyncPayload, toStockSyncPayload, toSyncEnvelope, toTradeSyncPayload } from "./sync-projection";
import { runForegroundSync } from "./sync-service";
import type { SyncCollections } from "./sync-types";
import { validateSyncCandidate } from "./sync-validation";
import type { AccountFeePolicyV1 } from "@/features/accounts/account-fee-policy";

const at = "2026-08-10T00:00:00.000Z";
const account: InvestmentAccount = { id: "a", name: "A", institution: "Demo", kind: "brokerage", subtype: "", baseCurrency: "USD", isDefault: true, archivedAt: null, memo: "", createdAt: at, updatedAt: at };
const feePolicy: AccountFeePolicyV1 = { version: 1, enabled: true, rules: [{ id: "r1", name: "Fee", market: "all", currency: "USD", side: "both", ratePercent: "0.1", fixedFee: "0", minimumFee: null, maximumFee: null, grossAmountFrom: null, grossAmountTo: null, effectiveFrom: "2026-01-01", effectiveTo: null, roundingMode: "round", roundingUnit: "0.01" }] };
const stock: Stock = { id: "nvda", ticker: "NVDA", name: "NVIDIA", market: "미국", currency: "USD", assetType: "주식", sector: "", status: "보유", investmentType: "장기 코어", currentPrice: 140, priceUpdatedAt: at, priceQuotedAt: at, priceSource: "manual", priceStatus: "manual", targetPrice: 160, averagePrice: 100, quantity: 9, thesisSummary: "AI", currentView: "강세", currentViewMemo: "", nextReviewDate: null, nextEarningsDate: null, ledgerInitializedAt: at, tags: [], createdAt: at, updatedAt: at, deletedAt: null };
const trade = (id: string, quantity: number, updatedAt = at): Trade => ({ id, stockId: stock.id, stockName: stock.name, planId: null, tradeType: "매수", tradedAt: updatedAt, quantity, price: 100, currency: "USD", exchangeRate: 1380, fee: 0, tax: 0, accountId: account.id, accountName: account.name, memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, ruleViolations: [], createdAt: updatedAt, updatedAt, deletedAt: null });
const collections = (trades: Trade[] = [trade("t1", 0.35)]): SyncCollections => ({ accounts: [account], stocks: [stock], trades });
const feeSnapshot = (value: Trade): AccountFeeCalculationSnapshotV1 => ({ version: 1, policyAccountId: "retired-policy-account", ruleId: "historical-rule", ruleName: "Historical", market: "all", currency: value.currency, side: value.tradeType === "매도" ? "sell" : "buy", ratePercent: "0", fixedFee: String(value.fee), minimumFee: null, maximumFee: null, grossAmountFrom: null, grossAmountTo: null, effectiveFrom: "2020-01-01", effectiveTo: null, roundingMode: "round", roundingUnit: "0.01", tradedAtDate: value.tradedAt.slice(0, 10), quantity: String(value.quantity), price: String(value.price), grossAmount: String(value.quantity * value.price), calculatedFee: String(value.fee), calculatedAt: at });

describe("Sync Contract v1", () => {
  it("projects only contract fields and preserves economic values", () => {
    expect(toAccountSyncPayload(account)).not.toHaveProperty("isDefault");
    const projected = toStockSyncPayload({ ...stock, countryCode: "US", providerRefs: [{ provider: "eodhd", symbol: "NVDA.US", exchangeCode: "US" }], priceFreshness: "eod", priceDelayMinutes: null }); for (const key of ["quantity", "averagePrice", "currentPrice", "priceUpdatedAt", "priceQuotedAt", "priceSource", "priceFreshness", "priceDelayMinutes", "priceStatus"]) expect(projected).not.toHaveProperty(key); expect(projected).toMatchObject({ countryCode: "US", providerRefs: [{ provider: "eodhd", symbol: "NVDA.US" }] });
    expect(toTradeSyncPayload({ ...trade("fractional", 0.35), transferId: "pair", isOpeningPosition: true, deletedAt: at })).toMatchObject({ quantity: 0.35, transferId: "pair", isOpeningPosition: true, deletedAt: at });
    expect(isSyncableRecord({ id: "sample:v1:stock:nvda" })).toBe(false); expect(recordNameFor("trades", "t1")).toBe("v1|trades|t1");
  });

  it("keeps Sync V1 compatible with missing and null fee policy and round-trips a valid policy", () => {
    expect(toAccountSyncPayload(account)).not.toHaveProperty("feePolicy");
    expect(toAccountSyncPayload({ ...account, feePolicy: null })).toHaveProperty("feePolicy", null);
    const projected = toAccountSyncPayload({ ...account, feePolicy });
    expect(projected.feePolicy).toEqual(feePolicy);
    expect(toSyncEnvelope("accounts", { ...account, feePolicy }).schemaVersion).toBe(1);
    expect(() => validateSyncCandidate({ ...collections(), accounts: [{ ...account, feePolicy }] })).not.toThrow();
  });

  it("fails closed for malformed and future fee policies in Sync V1", () => {
    expect(() => validateSyncCandidate({ ...collections(), accounts: [{ ...account, feePolicy: { ...feePolicy, version: 2 } }] as unknown as InvestmentAccount[] })).toThrow("수수료 정책 버전");
    expect(() => validateSyncCandidate({ ...collections(), accounts: [{ ...account, feePolicy: { ...feePolicy, rules: [{ ...feePolicy.rules[0], ratePercent: "1e2" }] } }] as unknown as InvestmentAccount[] })).toThrow("수수료율");
  });

  it("preserves journal status and import provenance in the whole Trade payload", () => {
    const imported = { ...trade("imported", 0.35), journalStatus: "recorded" as const, memo: "restored journal", deletedAt: null, origin: { kind: "fileImport" as const, sourceKey: "file:v2:abc", importBatchId: "file:v1:batch:abc", provider: "broker-renamed", externalExecutionId: "exec-1", importedAt: at, sourceRow: 2, timePrecision: "second" as const } };
    expect(toTradeSyncPayload(imported)).toMatchObject({ journalStatus: "recorded", memo: "restored journal", deletedAt: null, origin: imported.origin });
    expect(toSyncEnvelope("trades", imported).payload).toMatchObject({ journalStatus: "recorded", origin: imported.origin });
  });

  it("accepts old Trade payloads and rejects malformed additive metadata", () => {
    expect(() => validateSyncCandidate(collections([trade("legacy", 0.35)]))).not.toThrow();
    expect(() => validateSyncCandidate(collections([{ ...trade("bad-status", 0.35), journalStatus: "pending" as Trade["journalStatus"] }]))).toThrow("저널 상태");
    expect(() => validateSyncCandidate(collections([{ ...trade("bad-origin", 0.35), origin: { kind: "fileImport", sourceKey: "file:v1:x" } as Trade["origin"] }]))).toThrow("가져오기 출처");
  });

  it("keeps optional Trade fee provenance additive in Sync V1 and preserves historical Account provenance", () => {
    const legacy = trade("legacy-fee", 0.35);
    expect(toTradeSyncPayload(legacy)).not.toHaveProperty("feeMode");
    const values: Trade[] = [
      { ...trade("manual-fee", 0.35), feeMode: "manual", feeCalculation: null },
      { ...trade("source-fee", 0.35), feeMode: "sourceProvided", feeCalculation: null },
      { ...trade("unknown-fee", 0.35), feeMode: "unknown", feeCalculation: null },
    ];
    const policyTrade = trade("policy-fee", 0.35);
    values.push({ ...policyTrade, feeMode: "accountPolicy", feeCalculation: feeSnapshot(policyTrade) });
    for (const value of values) {
      expect(toSyncEnvelope("trades", value)).toMatchObject({ schemaVersion: 1, payload: expect.objectContaining({ feeMode: value.feeMode, feeCalculation: value.feeCalculation }) });
      expect(() => validateSyncCandidate(collections([value]))).not.toThrow();
    }
    expect(values[3].feeCalculation?.policyAccountId).not.toBe(values[3].accountId);
  });

  it("rejects unknown or incompatible Trade fee provenance in Sync V1", () => {
    const base = trade("bad-fee", 0.35);
    expect(() => validateSyncCandidate(collections([{ ...base, feeMode: "future" as Trade["feeMode"] }]))).toThrow("수수료 출처");
    expect(() => validateSyncCandidate(collections([{ ...base, feeMode: "accountPolicy", feeCalculation: null }]))).toThrow("계좌 수수료 계산 기록");
    expect(() => validateSyncCandidate(collections([{ ...base, feeMode: "manual", feeCalculation: feeSnapshot(base) }]))).toThrow("계좌 정책이 아닌 수수료");
  });

  it("preserves local quote and derived stock fields on remote materialization", () => {
    const remote = { ...toStockSyncPayload(stock), thesisSummary: "Remote", updatedAt: "2026-08-11T00:00:00Z" };
    expect(fromStockSyncPayload(remote, stock)).toMatchObject({ thesisSummary: "Remote", currentPrice: 140, quantity: 9, averagePrice: 100 });
  });

  it("round-trips additive Market sector values while accepting old and null Sync V1 payloads", () => {
    const legacy = toStockSyncPayload(stock);
    expect(legacy).not.toHaveProperty("marketSector");
    expect(fromStockSyncPayload(legacy)).not.toHaveProperty("marketSector");
    for (const marketSector of ["information-technology" as const, null]) {
      const projected = toStockSyncPayload({ ...stock, marketSector, sector: "Custom Category", tags: ["AI"] });
      expect(fromStockSyncPayload(projected)).toMatchObject({ marketSector, sector: "Custom Category", tags: ["AI"] });
    }
  });

  it("rejects an unknown Market sector in Sync V1 without changing the schema version", () => {
    expect(toSyncEnvelope("stocks", { ...stock, marketSector: "energy" }).schemaVersion).toBe(1);
    expect(() => validateSyncCandidate({ ...collections(), stocks: [{ ...stock, marketSector: "technology" }] as unknown as Stock[] })).toThrow("시장 섹터");
  });

  it("merges independently and records deterministic whole-record conflicts", () => {
    const newerRemote = toSyncEnvelope("trades", trade("t1", 0.17, "2026-08-11T00:00:00Z"));
    const added = toSyncEnvelope("trades", trade("t2", 0.17, "2026-08-11T00:00:00Z"));
    const result = mergeSyncCollections(collections(), [newerRemote, added], at);
    expect(result.collections.trades).toHaveLength(2); expect(result.collections.trades[0].quantity).toBe(0.17); expect(result.conflicts[0]).toMatchObject({ chosenSide: "remote", reason: "newer-remote" });
    const localWins = mergeSyncCollections(collections([trade("t1", 0.35, "2026-08-12T00:00:00Z")]), [newerRemote], at); expect(localWins.localWinners).toHaveLength(1);
    const equal = mergeSyncCollections(collections(), [toSyncEnvelope("trades", trade("t1", 0.2))], at); expect(equal.conflicts[0].reason).toBe("equal-timestamp-server-wins");
    const localManual = { ...trade("fee-lww", 0.35, "2026-08-11T00:00:00Z"), feeMode: "manual" as const, feeCalculation: null };
    const remoteSource = { ...trade("fee-lww", 0.35, "2026-08-12T00:00:00Z"), feeMode: "sourceProvided" as const, feeCalculation: null };
    const feeMerge = mergeSyncCollections(collections([localManual]), [toSyncEnvelope("trades", remoteSource)], at);
    expect(feeMerge.collections.trades[0]).toMatchObject({ feeMode: "sourceProvided", feeCalculation: null });
  });

  it("validates remote ledger and references without weakening production rules", () => {
    expect(buildTradingLedger(collections().trades, [account]).positions[0].quantity).toBe(0.35); expect(validateSyncCandidate(collections()).errors).toEqual([]);
    expect(() => validateSyncCandidate(collections([{ ...trade("bad", 1), stockId: "missing" }]))).toThrow("SYNC_INVALID_STOCK_REFERENCE");
  });

  it("accepts EODHD Stock metadata and rejects unknown Sync provider values", () => {
    const eodhd = { ...stock, providerRefs: [{ provider: "eodhd" as const, symbol: "NVDA.US", exchangeCode: "US" }], quotePreference: "auto" as const };
    expect(() => validateSyncCandidate({ ...collections(), stocks: [eodhd] })).not.toThrow();
    const projected = toStockSyncPayload(eodhd);
    expect(projected.providerRefs).toEqual(eodhd.providerRefs);
    expect(() => validateSyncCandidate({ ...collections(), stocks: [{ ...eodhd, providerRefs: [{ provider: "future-provider", symbol: "NVDA.US" }] }] as unknown as Stock[] })).toThrow("provider 연결");
  });

  it("proves local to mock cloud to remote merge without quantity drift or echo persistence", async () => {
    const local = collections(); const cloud = new MockSyncTransport(); const save = vi.fn(async () => undefined); const acknowledge = vi.fn(async () => undefined);
    const first = await runForegroundSync(cloud, { load: async () => local, save, acknowledge }); expect(first.outgoing).toHaveLength(3);
    await cloud.sendChanges([toSyncEnvelope("trades", trade("t2", 0.17, "2026-08-11T00:00:00Z"))]);
    const second = await runForegroundSync(cloud, { load: async () => local, save, acknowledge });
    expect(second.collections.trades).toHaveLength(2); expect(buildTradingLedger(second.collections.trades, [account]).positions[0].quantity).toBeCloseTo(0.52); expect(save).toHaveBeenCalledTimes(2); expect(acknowledge).toHaveBeenCalledTimes(1);
    expect((save.mock.calls as unknown[][])[0]?.[3]).toHaveLength(3);
  });

  it("rejects an invalid remote batch before any persistence", async () => {
    const invalid = toSyncEnvelope("trades", { ...trade("bad", 1), accountId: "missing" }); const save = vi.fn();
    await expect(runForegroundSync(new MockSyncTransport([invalid]), { load: async () => collections([]), save, acknowledge: vi.fn() })).rejects.toThrow("SYNC_INVALID_ACCOUNT_REFERENCE");
    expect(save).not.toHaveBeenCalled();
  });
});
