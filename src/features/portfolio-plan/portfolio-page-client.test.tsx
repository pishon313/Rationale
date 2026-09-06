import { render, screen, waitFor, within } from "@testing-library/react";
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

describe("Portfolio Overview", () => {
  beforeEach(() => reset());

  it("keeps current assets and the next contribution usable without a Plan or Account", () => {
    render(<PortfolioPageClient />);
    expect(screen.getByRole("heading", { name: "현재 자산과 다음 저축 계획을 한눈에 보세요." })).toBeInTheDocument();
    expect(screen.getByText("아직 평가할 자산이 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("아직 Contribution Plan이 없습니다.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Plan 만들기" })[0]).toHaveAttribute("href", "/portfolio/plan");
  });

  it("renders current assets separately from the normalized next contribution", () => {
    reset(true);
    mocks.ledger = { ...mocks.ledger, positions: [{ key: "p", stockId: sampleStocks[0]!.id, stockName: "Samsung", accountId: "a", accountName: "A", currency: "KRW", quantity: 2, averagePrice: 0, investedAmount: 0, investedAmountKrw: 0, realizedProfit: 0, realizedProfitKrw: 0 }] };
    render(<PortfolioPageClient />);
    const currentAllocation = screen.getByRole("region", { name: "현재 자산 배분" });
    const nextContribution = screen.getByRole("region", { name: "다음 저축 계획" });
    expect(within(currentAllocation).getByRole("heading", { name: "현재 자산 배분" })).toBeInTheDocument();
    expect(within(currentAllocation).getByText("현금성 자산")).toBeInTheDocument();
    expect(within(currentAllocation).queryByText("적금")).not.toBeInTheDocument();
    expect(within(nextContribution).getByRole("heading", { name: "다음 저축 계획" })).toBeInTheDocument();
    expect(within(nextContribution).getByText("적금")).toBeInTheDocument();
    expect(screen.getAllByText("주식 투자").length).toBeGreaterThan(0);
    expect(screen.getAllByText("₩1,800,000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("₩200").length).toBeGreaterThan(0);
    expect(screen.getByText("리비전 1 · 현재 활성")).toBeInTheDocument();
  });

  it("shows whole-portfolio drift and an editable-in-Plan new-cash balance suggestion", () => {
    reset(true);
    mocks.collections.set("portfolio-plan-state", [{ ...state, balancePolicy: { version: 1, mode: "balanceAssist", targetWeightsBps: { savings: 3000, stocks: 6000, bonds: 1000 }, toleranceBps: 100, updatedAt: now } }]);
    mocks.ledger = { ...mocks.ledger, positions: [{ key: "p", stockId: sampleStocks[0]!.id, stockName: "Samsung", accountId: "a", accountName: "A", currency: "KRW", quantity: 80_000, averagePrice: 0, investedAmount: 0, investedAmountKrw: 0, realizedProfit: 0, realizedProfitKrw: 0 }] };
    render(<PortfolioPageClient />);
    expect(screen.getByText("균형 맞추기 제안")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "현재 자산 배분" })).getByText("현재 / 목표")).toBeInTheDocument();
    expect(screen.getByText("조정 필요")).toBeInTheDocument();
    expect(screen.getByText("목표보다 30%p 부족")).toBeInTheDocument();
    expect(screen.getByText("₩1,350,000")).toBeInTheDocument();
    expect(screen.getByText("₩450,000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plan에서 금액과 비율 수정" })).toHaveAttribute("href", "/portfolio/plan");
  });

  it("shows Allocation targets even before a Plan or Account exists", () => {
    mocks.collections.set("portfolio-plan-state", [{ ...state, activeRevisionId: null, balancePolicy: { version: 1, mode: "fixed", targetWeightsBps: { savings: 3000, stocks: 6000, bonds: 1000 }, toleranceBps: 500, updatedAt: now } }]);
    render(<PortfolioPageClient />);
    const allocation = screen.getByRole("region", { name: "현재 자산 배분" });
    expect(within(allocation).getByText("현재 자산은 없지만 저장된 Allocation 목표는 확인할 수 있습니다.")).toBeInTheDocument();
    expect(within(allocation).getByText("현금성 자산")).toBeInTheDocument();
    expect(screen.getByText("비교 대기")).toBeInTheDocument();
  });

  it("shows optional stock targets with their next contribution amounts", () => {
    reset(true);
    mocks.collections.set("portfolio-plan-state", [{ ...state, balancePolicy: {
      version: 1, mode: "fixed", targetWeightsBps: { savings: 0, stocks: 10000, bonds: 0 }, toleranceBps: 500,
      stockTargets: [{ stockId: sampleStocks[0]!.id, targetWeightBps: 7000 }, { stockId: sampleStocks[1]!.id, targetWeightBps: 3000 }], stockToleranceBps: 300, updatedAt: now,
    } }]);
    render(<PortfolioPageClient />);
    const stockPlan = screen.getByRole("region", { name: "종목별 다음 투자 계획" });
    expect(within(stockPlan).getByText("삼성전자")).toBeInTheDocument();
    expect(within(stockPlan).getByText("현대차")).toBeInTheDocument();
    expect(within(stockPlan).getByText("₩1,260,000")).toBeInTheDocument();
    expect(within(stockPlan).getByText("₩540,000")).toBeInTheDocument();
  });

  it("shows the stock-bucket Balance Assist amounts on Overview", () => {
    reset(true);
    mocks.collections.set("portfolio-plan-state", [{ ...state, balancePolicy: {
      version: 1, mode: "balanceAssist", targetWeightsBps: { savings: 0, stocks: 10000, bonds: 0 }, toleranceBps: 500,
      stockTargets: [{ stockId: sampleStocks[0]!.id, targetWeightBps: 7000 }, { stockId: sampleStocks[1]!.id, targetWeightBps: 3000 }], stockToleranceBps: 300, updatedAt: now,
    } }]);
    mocks.ledger = { ...mocks.ledger, positions: [{ key: "p", stockId: sampleStocks[0]!.id, stockName: "Samsung", accountId: "a", accountName: "A", currency: "KRW", quantity: 100_000, averagePrice: 0, investedAmount: 0, investedAmountKrw: 0, realizedProfit: 0, realizedProfitKrw: 0 }] };
    render(<PortfolioPageClient />);
    const stockPlan = screen.getByRole("region", { name: "종목별 다음 투자 계획" });
    expect(within(stockPlan).getByText("부족한 종목을 우선한 이번 저축 제안입니다.")).toBeInTheDocument();
    expect(within(stockPlan).getByText("₩0")).toBeInTheDocument();
    expect(within(stockPlan).getByText("₩1,800,000")).toBeInTheDocument();
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
