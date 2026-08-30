import { describe, expect, it } from "vitest";
import { validateStoredCollection } from "./collection-validation";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { InvestmentAccount } from "@/features/accounts/types";
import { sampleTrades } from "@/features/trades/sample-data";
import type { TradeLedgerResetSnapshotV1 } from "@/features/trades/trade-ledger-reset";
import type { PortfolioAllocationGroup, PortfolioAllocationTarget, PortfolioPlanRevision, PortfolioPlanState } from "@/features/portfolio-plan/types";

describe("import mapping profile storage validation", () => {
  const profile = { id: "p1", name: "Broker", version: 1, bindings: { tradedAt: { normalizedHeader: "date", occurrence: 0 } }, headerSignature: "date#0", createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z" };

  it("accepts versioned stable references without raw row data", () => {
    expect(validateStoredCollection("import-mapping-profiles", [profile])).toEqual({ valid: true });
  });

  it("rejects unknown fields and index-based bindings", () => {
    expect(validateStoredCollection("import-mapping-profiles", [{ ...profile, bindings: { unknown: { normalizedHeader: "x", occurrence: 1 } } }])).toMatchObject({ valid: false });
    expect(validateStoredCollection("import-mapping-profiles", [{ ...profile, bindings: { tradedAt: 0 } }])).toMatchObject({ valid: false });
    expect(validateStoredCollection("import-mapping-profiles", [{ ...profile, fileName: "broker.csv", rows: [["private"]] }])).toMatchObject({ valid: false });
  });
});

describe("stock storage validation", () => {
  const eodhdStock = {
    ...sampleStocks[0],
    countryCode: "US",
    exchangeCode: "US",
    providerRefs: [{ provider: "eodhd", symbol: "SHOP.US", exchangeCode: "US" }],
    quotePreference: "auto",
    priceSource: "eodhd",
    priceFreshness: "eod",
    priceStatus: "online",
  };

  it("accepts an EODHD-linked Stock without rewriting its metadata", () => {
    expect(validateStoredCollection("stocks", [eodhdStock])).toEqual({ valid: true });
  });

  it("accepts mixed legacy and classified Stocks without a migration rewrite", () => {
    const legacy = { ...sampleStocks[0] } as Record<string, unknown>;
    delete legacy.marketSector;
    const classified = { ...sampleStocks[1], marketSector: "consumer-discretionary", sector: "자동차, 장기" };
    expect(validateStoredCollection("stocks", [legacy, classified])).toEqual({ valid: true });
    expect(legacy.sector).toBe(sampleStocks[0].sector);
  });

  it("quarantines an invalid Market sector while leaving user categories unrestricted", () => {
    expect(validateStoredCollection("stocks", [{ ...sampleStocks[0], marketSector: "technology" }])).toEqual({ valid: false, errorType: "INVALID_RECORD", index: 0 });
    expect(validateStoredCollection("stocks", [{ ...sampleStocks[0], sector: "반도체, IT / Custom" }])).toEqual({ valid: true });
  });

  it("rejects invalid provider metadata", () => {
    expect(validateStoredCollection("stocks", [{ ...eodhdStock, providerRefs: [{ provider: "manual", symbol: "SHOP.US" }] }])).toMatchObject({ valid: false, index: 0 });
  });
});

describe("account fee policy storage validation", () => {
  const account: InvestmentAccount = { id: "a", name: "A", institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: true, archivedAt: null, memo: "", createdAt: "2026-08-17T00:00:00Z", updatedAt: "2026-08-17T00:00:00Z" };
  const feePolicy = { version: 1 as const, enabled: true, rules: [{ id: "r1", name: "Fee", market: "all" as const, currency: "KRW" as const, side: "both" as const, ratePercent: "0.1", fixedFee: "0", minimumFee: null, maximumFee: null, grossAmountFrom: null, grossAmountTo: null, effectiveFrom: "2026-01-01", effectiveTo: null, roundingMode: "floor" as const, roundingUnit: "1" }] };

  it("accepts absent, null, and valid policies", () => {
    expect(validateStoredCollection("accounts", [account])).toEqual({ valid: true });
    expect(validateStoredCollection("accounts", [{ ...account, feePolicy: null }])).toEqual({ valid: true });
    expect(validateStoredCollection("accounts", [{ ...account, feePolicy }])).toEqual({ valid: true });
  });

  it("quarantines invalid and future policy records", () => {
    expect(validateStoredCollection("accounts", [{ ...account, feePolicy: { ...feePolicy, version: 2 } }])).toEqual({ valid: false, errorType: "INVALID_RECORD", index: 0 });
    expect(validateStoredCollection("accounts", [{ ...account, feePolicy: { ...feePolicy, rules: [{ ...feePolicy.rules[0], fixedFee: "-1" }] } }])).toEqual({ valid: false, errorType: "INVALID_RECORD", index: 0 });
  });
});

describe("Trade fee provenance storage validation", () => {
  const legacy = sampleTrades[0];
  const feeCalculation = { version: 1 as const, policyAccountId: "retired-account", ruleId: "r1", ruleName: "Historical", market: "all" as const, currency: "KRW" as const, side: "buy" as const, ratePercent: "0", fixedFee: "1200", minimumFee: null, maximumFee: null, grossAmountFrom: null, grossAmountTo: null, effectiveFrom: "2020-01-01", effectiveTo: null, roundingMode: "floor" as const, roundingUnit: "1", tradedAtDate: legacy.tradedAt.slice(0, 10), quantity: "120", price: "64100", grossAmount: "7692000", calculatedFee: "1200", calculatedAt: "2026-08-17T00:00:00Z" };

  it("accepts mixed legacy and valid fee-provenance Trades", () => {
    expect(validateStoredCollection("trades", [legacy, { ...legacy, id: "manual", feeMode: "manual", feeCalculation: null }, { ...legacy, id: "policy", feeMode: "accountPolicy", feeCalculation }])).toEqual({ valid: true });
  });

  it("identifies only the invalid fee-provenance record index", () => {
    expect(validateStoredCollection("trades", [legacy, { ...legacy, id: "invalid", feeMode: "accountPolicy", feeCalculation: null }])).toEqual({ valid: false, errorType: "INVALID_RECORD", index: 1 });
  });
});
describe("Trade-ledger reset snapshot storage validation", () => {
  const now = "2026-08-21T00:00:00.000Z";
  const snapshot: TradeLedgerResetSnapshotV1 = { id: "latest", version: 1, resetAt: now, tradeIds: ["trade-1", "trade-2"], createdAt: now, updatedAt: now };

  it("accepts one strict, minimal snapshot", () => {
    expect(validateStoredCollection("trade-ledger-reset-snapshots", [snapshot])).toEqual({ valid: true });
  });

  it.each([
    ["duplicate Trade IDs", { ...snapshot, tradeIds: ["trade-1", "trade-1"] }],
    ["an empty Trade ID", { ...snapshot, tradeIds: [""] }],
    ["an empty snapshot", { ...snapshot, tradeIds: [] }],
    ["an invalid reset timestamp", { ...snapshot, resetAt: "not-a-date" }],
    ["an unknown version", { ...snapshot, version: 2 }],
    ["an unknown field", { ...snapshot, rawTrades: [{ private: true }] }],
  ])("rejects %s", (_label, value) => {
    expect(validateStoredCollection("trade-ledger-reset-snapshots", [value])).toMatchObject({ valid: false, errorType: "INVALID_RECORD", index: 0 });
  });

  it("rejects more than one snapshot record", () => {
    expect(validateStoredCollection("trade-ledger-reset-snapshots", [snapshot, { ...snapshot }])).toEqual({ valid: false, errorType: "INVALID_COLLECTION_SHAPE" });
  });
});

describe("Portfolio Plan storage validation", () => {
  const now = "2026-08-18T00:00:00Z";
  const state: PortfolioPlanState = { id: "default", activeRevisionId: "r1", contributionAmountMinor: 1_800_000, contributionCurrency: "KRW", updatedAt: now };
  const revision: PortfolioPlanRevision = { id: "r1", revisionNumber: 1, basedOnRevisionId: null, thesis: "", changeNote: "", createdAt: now, activatedAt: now, updatedAt: now };
  const group: PortfolioAllocationGroup = { id: "g1", revisionId: "r1", name: "Stocks", targetWeightBps: 10000, sortOrder: 0, updatedAt: now };
  const target: PortfolioAllocationTarget = { id: "t1", revisionId: "r1", groupId: "g1", accountId: "a", targetType: "stock", stockId: sampleStocks[0].id, weightWithinGroupBps: 10000, sortOrder: 0, updatedAt: now };

  it("accepts valid state, revision, Group, and Target records", () => {
    expect(validateStoredCollection("portfolio-plan-state", [state])).toEqual({ valid: true });
    expect(validateStoredCollection("portfolio-plan-revisions", [revision])).toEqual({ valid: true });
    expect(validateStoredCollection("portfolio-allocation-groups", [group])).toEqual({ valid: true });
    expect(validateStoredCollection("portfolio-allocation-targets", [target])).toEqual({ valid: true });
  });

  it("rejects malformed Portfolio Plan records", () => {
    expect(validateStoredCollection("portfolio-plan-state", [{ ...state, id: "other" }])).toMatchObject({ valid: false });
    expect(validateStoredCollection("portfolio-plan-revisions", [{ ...revision, revisionNumber: 0 }])).toMatchObject({ valid: false });
    expect(validateStoredCollection("portfolio-allocation-groups", [{ ...group, targetWeightBps: 100.5 }])).toMatchObject({ valid: false });
    expect(validateStoredCollection("portfolio-allocation-targets", [{ ...target, weightWithinGroupBps: 100.5 }])).toMatchObject({ valid: false });
    expect(validateStoredCollection("portfolio-allocation-targets", [{ ...target, targetType: "cash", stockId: sampleStocks[0].id }])).toMatchObject({ valid: false });
  });

  it("still accepts V6 records long enough for coordinated migration", () => {
    expect(validateStoredCollection("portfolio-plan-state", [{ id: "default", activeRevisionId: "r1", updatedAt: now }])).toEqual({ valid: true });
    expect(validateStoredCollection("portfolio-plan-revisions", [{ ...revision, targetAmountKrw: 1_800_000 }])).toEqual({ valid: true });
    expect(validateStoredCollection("portfolio-allocation-targets", [{ id: "legacy", revisionId: "r1", targetType: "stock", stockId: sampleStocks[0].id, targetWeightBps: 10000, sortOrder: 0, updatedAt: now }])).toEqual({ valid: true });
  });
});
