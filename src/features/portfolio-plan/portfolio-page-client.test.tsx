import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fallbackRatesToKrw } from "@/domain/currency";
import type { TradingLedger } from "@/domain/trading-ledger";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { PortfolioAllocationGroup, PortfolioAllocationTarget, PortfolioPlanRevision, PortfolioPlanState } from "./types";
import { PortfolioPageClient } from "./portfolio-page-client";

const mocks = vi.hoisted(() => ({
  collections: new Map<string, unknown[]>(),
  ledger: { positions: [], cashBalances: [], cycles: [], calculations: {}, errors: [], totalRealizedKrw: 0 } as TradingLedger,
  stocks: [] as typeof sampleStocks,
  save: vi.fn(),
}));
vi.mock("@/lib/local-repository", () => ({ saveCollectionsAtomically: mocks.save }));
vi.mock("@/lib/use-local-collection", () => ({ useLocalCollection: (name: string) => ({ items: mocks.collections.get(name) ?? [], allItems: mocks.collections.get(name) ?? [], ready: true, applyCommitted: vi.fn() }) }));
vi.mock("@/features/stocks/use-stock-store", () => ({ useStockStore: () => ({ ready: true, allStocks: mocks.stocks, accounts: [{ id: "a", name: "A", institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: true, archivedAt: null, memo: "", createdAt: now, updatedAt: now }], trades: [], ledger: mocks.ledger }) }));
vi.mock("@/lib/use-exchange-rates", () => ({ useExchangeRates: () => ({ ready: true, snapshot: { ratesToKrw: fallbackRatesToKrw } }) }));

const now = "2026-08-18T00:00:00.000Z";
const revision: PortfolioPlanRevision = { id: "r1", revisionNumber: 1, basedOnRevisionId: null, thesis: "Stay intentional", changeNote: "", createdAt: now, activatedAt: now, updatedAt: now };
const state: PortfolioPlanState = { id: "default", activeRevisionId: revision.id, contributionAmountMinor: 1_800_000, contributionCurrency: "KRW", updatedAt: now };
const group: PortfolioAllocationGroup = { id: "g1", revisionId: revision.id, name: "Stocks", targetWeightBps: 10000, sortOrder: 0, updatedAt: now };
const target: PortfolioAllocationTarget = { id: "t1", revisionId: revision.id, groupId: group.id, accountId: "a", targetType: "stock", stockId: sampleStocks[0].id, weightWithinGroupBps: 10000, sortOrder: 0, updatedAt: now };

function reset(active = false) {
  mocks.save.mockReset().mockResolvedValue(undefined);
  mocks.stocks = sampleStocks.map((stock, index) => ({ ...stock, currentPrice: index === 0 ? 100 : 50 }));
  mocks.ledger = { positions: [], cashBalances: [], cycles: [], calculations: {}, errors: [], totalRealizedKrw: 0 };
  mocks.collections = new Map([
    ["portfolio-plan-state", active ? [state] : []],
    ["portfolio-plan-revisions", active ? [revision] : []],
    ["portfolio-allocation-groups", active ? [group] : []],
    ["portfolio-allocation-targets", active ? [target] : []],
  ]);
}

describe("PortfolioPageClient foundation adapter", () => {
  beforeEach(() => reset());

  it("keeps the route available without building the final Plan UI", () => {
    render(<PortfolioPageClient />);
    expect(screen.getByRole("heading", { name: "포트폴리오" })).toBeInTheDocument();
    expect(screen.getByText("활성 포트폴리오 계획이 없습니다.")).toBeInTheDocument();
  });

  it("renders the active grouped foundation and mutable Contribution Amount", () => {
    reset(true);
    render(<PortfolioPageClient />);
    expect(screen.getByText("Stocks")).toBeInTheDocument();
    expect(screen.getByText("₩1,800,000")).toBeInTheDocument();
    expect(screen.getByText("리비전 1 · 현재 활성")).toBeInTheDocument();
  });

  it("atomically upgrades locally stored V6 Portfolio records before rendering", async () => {
    mocks.collections = new Map([
      ["portfolio-plan-state", [{ id: "default", activeRevisionId: "r1", updatedAt: now }]],
      ["portfolio-plan-revisions", [{ ...revision, targetAmountKrw: 1_800_000 }]],
      ["portfolio-allocation-groups", []],
      ["portfolio-allocation-targets", [{ id: "t1", revisionId: "r1", targetType: "stock", stockId: sampleStocks[0].id, targetWeightBps: 10000, sortOrder: 0, updatedAt: now }]],
    ]);
    render(<PortfolioPageClient />);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]?.[0].map((write: { collection: string }) => write.collection)).toEqual(["portfolio-plan-state", "portfolio-plan-revisions", "portfolio-allocation-groups", "portfolio-allocation-targets"]);
  });
});
