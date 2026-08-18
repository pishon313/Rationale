import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { Stock } from "@/features/stocks/types";
import type { BuyPlan } from "./types";
import { buildPlanStockMutation, persistPlanStockMutation } from "./plan-stock-mutation";

const now = "2026-08-18T05:00:00.000Z";
const plan = (overrides: Partial<BuyPlan> = {}): BuyPlan => ({
  id: "plan-1", stockId: sampleStocks[0].id, stockName: sampleStocks[0].name, ticker: sampleStocks[0].ticker, title: "Plan",
  scenarioType: "눌림목", conditionType: "특정 가격 도달", conditionDescription: "", targetPrice: null, stopLossPrice: null,
  takeProfitPrice: null, priceRangeMin: null, priceRangeMax: null, plannedAmount: 0, plannedQuantity: 0, plannedPortfolioPercent: 30,
  priority: 3, status: "아이디어", invalidationCondition: "invalid", expectedHoldingPeriod: "", memo: "", conditions: [],
  createdAt: now, updatedAt: now, executedAt: null, deletedAt: null, ...overrides,
});
const remoteStock = (overrides: Partial<Stock> = {}): Stock => ({
  ...sampleStocks[0], id: "remote-stock", ticker: "CRWD", name: "CrowdStrike Holdings", market: "미국", currency: "USD",
  countryCode: "US", exchangeCode: "US", isin: "US22788C1053", providerRefs: [{ provider: "eodhd", symbol: "CRWD.US", exchangeCode: "US" }],
  status: "관찰", investmentType: "관찰 전용", quantity: 0, averagePrice: 0, ledgerInitializedAt: now, createdAt: now, updatedAt: now, deletedAt: null, ...overrides,
});

describe("plan stock mutation", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("changes only Plans for an existing active Stock", () => {
    const result = buildPlanStockMutation({ stocks: sampleStocks, plans: [], plan: plan(), selection: { kind: "existing", stockId: sampleStocks[0].id }, now });
    expect(result.stocksChanged).toBe(false);
    expect(result.writes.map((write) => write.collection)).toEqual(["plans"]);
    expect(result.nextStocks).toEqual(sampleStocks);
  });

  it("creates a Stock and Plan with the same stable ID without mutating inputs", () => {
    const stocks = [...sampleStocks]; const plans: BuyPlan[] = [];
    const result = buildPlanStockMutation({ stocks, plans, plan: plan({ stockId: "remote-stock" }), selection: { kind: "create", stock: remoteStock() }, now });
    expect(result.writes.map((write) => write.collection)).toEqual(["stocks", "plans"]);
    expect(result.nextStocks[0].id).toBe("remote-stock");
    expect(result.nextPlans[0]).toMatchObject({ stockId: "remote-stock", stockName: "CrowdStrike Holdings", ticker: "CRWD" });
    expect(stocks).toEqual(sampleStocks); expect(plans).toEqual([]);
  });

  it("restores the same deleted Stock ID while preserving metadata", () => {
    const deleted = remoteStock({ deletedAt: "2026-08-01T00:00:00Z", thesisSummary: "preserve", sector: "security" });
    const result = buildPlanStockMutation({ stocks: [deleted, ...sampleStocks], plans: [], plan: plan({ stockId: deleted.id }), selection: { kind: "restore", stockId: deleted.id }, now });
    expect(result.nextStocks[0]).toMatchObject({ id: deleted.id, deletedAt: null, updatedAt: now, thesisSummary: "preserve", sector: "security" });
    expect(result.nextPlans[0].stockId).toBe(deleted.id);
  });

  it("edits an existing Plan to a new Stock", () => {
    const previous = plan();
    const edited = plan({ stockId: "remote-stock", title: "Edited" });
    const result = buildPlanStockMutation({ stocks: sampleStocks, plans: [previous], plan: edited, previousPlan: previous, selection: { kind: "create", stock: remoteStock() }, now });
    expect(result.nextPlans).toEqual([expect.objectContaining({ id: previous.id, title: "Edited", stockId: "remote-stock" })]);
  });

  it("re-resolves a stale draft to an active Stock instead of creating a duplicate", () => {
    const existing = remoteStock({ id: "existing" });
    const result = buildPlanStockMutation({
      stocks: [existing, ...sampleStocks], plans: [], plan: plan({ stockId: "remote-stock" }),
      selection: { kind: "create", stock: remoteStock() }, now,
    });
    expect(result.stocksChanged).toBe(false);
    expect(result.writes.map((write) => write.collection)).toEqual(["plans"]);
    expect(result.nextPlans[0].stockId).toBe(existing.id);
  });

  it("blocks ambiguous or deleted identity discovered again at final save", () => {
    const first = remoteStock({ id: "existing-1" });
    const second = remoteStock({ id: "existing-2", providerRefs: [] });
    const input = { plans: [] as BuyPlan[], plan: plan({ stockId: "remote-stock" }), selection: { kind: "create", stock: remoteStock() } as const, now };
    expect(() => buildPlanStockMutation({ ...input, stocks: [first, second, ...sampleStocks] })).toThrow("AMBIGUOUS_STOCK_IDENTITY");
    expect(() => buildPlanStockMutation({ ...input, stocks: [first, remoteStock({ id: "deleted", deletedAt: now }), ...sampleStocks] })).toThrow("AMBIGUOUS_STOCK_IDENTITY");
    expect(() => buildPlanStockMutation({ ...input, stocks: [remoteStock({ id: "deleted", deletedAt: now }), ...sampleStocks] })).toThrow("DELETED_STOCK_REVIEW_REQUIRED");
  });

  it("switches an existing Plan to another registered Stock without changing Stocks", () => {
    const previous = plan();
    const target = sampleStocks[1];
    const result = buildPlanStockMutation({
      stocks: sampleStocks, plans: [previous], plan: plan({ stockId: target.id, title: "Switched" }), previousPlan: previous,
      selection: { kind: "existing", stockId: target.id }, now,
    });
    expect(result.stocksChanged).toBe(false);
    expect(result.nextPlans[0]).toMatchObject({ stockId: target.id, stockName: target.name, ticker: target.ticker, title: "Switched" });
  });

  it("persists all writes in one atomic call and propagates failures", async () => {
    const mutation = buildPlanStockMutation({ stocks: sampleStocks, plans: [], plan: plan({ stockId: "remote-stock" }), selection: { kind: "create", stock: remoteStock() }, now });
    const save = vi.fn().mockResolvedValue(undefined);
    await persistPlanStockMutation(mutation, save);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].map((write: { collection: string }) => write.collection)).toEqual(["stocks", "plans"]);
    await expect(persistPlanStockMutation(mutation, vi.fn().mockRejectedValue(new Error("plans failed")))).rejects.toThrow("plans failed");
  });
});
