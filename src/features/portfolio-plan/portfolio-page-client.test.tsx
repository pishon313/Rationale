import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fallbackRatesToKrw } from "@/domain/currency";
import type { TradingLedger } from "@/domain/trading-ledger";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { PortfolioAllocationTarget, PortfolioPlanRevision, PortfolioPlanState } from "./types";
import { PortfolioPageClient } from "./portfolio-page-client";

const mocks = vi.hoisted(() => ({
  collections: new Map<string, unknown[]>(),
  save: vi.fn(),
  ledger: { positions: [], cashBalances: [], cycles: [], calculations: {}, errors: [], totalRealizedKrw: 0 } as TradingLedger,
  stocks: [] as typeof sampleStocks,
}));
vi.mock("@/lib/local-repository", async (original) => ({ ...(await original<typeof import("@/lib/local-repository")>()), saveCollectionsAtomically: mocks.save }));
vi.mock("@/lib/use-local-collection", () => ({ useLocalCollection: (name: string) => ({ items: mocks.collections.get(name) ?? [], allItems: mocks.collections.get(name) ?? [], ready: true, applyCommitted: vi.fn() }) }));
vi.mock("@/features/stocks/use-stock-store", () => ({ useStockStore: () => ({ ready: true, allStocks: mocks.stocks, ledger: mocks.ledger }) }));
vi.mock("@/lib/use-exchange-rates", () => ({ useExchangeRates: () => ({ ready: true, snapshot: { ratesToKrw: fallbackRatesToKrw } }) }));

const now = "2026-08-18T00:00:00.000Z";
const revision: PortfolioPlanRevision = { id: "r1", revisionNumber: 1, basedOnRevisionId: null, targetAmountKrw: 1_800_000, thesis: "Stay intentional", changeNote: "", createdAt: now, activatedAt: now, updatedAt: now };
const state: PortfolioPlanState = { id: "default", activeRevisionId: revision.id, updatedAt: now };
const target: PortfolioAllocationTarget = { id: "t1", revisionId: revision.id, targetType: "stock", stockId: sampleStocks[0].id, targetWeightBps: 10000, sortOrder: 0, updatedAt: now };

function reset(active = false) {
  mocks.save.mockReset().mockResolvedValue(undefined);
  mocks.stocks = sampleStocks.map((stock, index) => ({ ...stock, currentPrice: index === 0 ? 100 : 50 }));
  mocks.ledger = { positions: [], cashBalances: [], cycles: [], calculations: {}, errors: [], totalRealizedKrw: 0 };
  mocks.collections = new Map([
    ["portfolio-plan-state", active ? [state] : []],
    ["portfolio-plan-revisions", active ? [revision] : []],
    ["portfolio-allocation-targets", active ? [target] : []],
  ]);
}

describe("PortfolioPageClient", () => {
  beforeEach(() => reset());

  it("shows the editable worksheet immediately without a separate create step", () => {
    render(<PortfolioPageClient />);
    expect(screen.getByRole("heading", { name: "목표 배분 워크시트" })).toBeInTheDocument();
    expect(screen.getByLabelText("목표 운용 금액")).toHaveValue(0);
    expect(screen.queryByRole("button", { name: "계획 만들기" })).not.toBeInTheDocument();
  });

  it("creates a Plan only when targets total exactly 100%", async () => {
    render(<PortfolioPageClient />);
    const picker = screen.getByRole("combobox", { name: "등록 종목 추가" });
    fireEvent.focus(picker); fireEvent.change(picker, { target: { value: sampleStocks[0].ticker } });
    fireEvent.click(screen.getByRole("option", { name: `${sampleStocks[0].ticker} · ${sampleStocks[0].name}` }));
    const save = screen.getByRole("button", { name: "계획 저장" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("목표 운용 금액"), { target: { value: "-1" } });
    fireEvent.change(screen.getByLabelText(`${sampleStocks[0].name} 목표 비중`), { target: { value: "100" } });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("목표 운용 금액"), { target: { value: "1800000" } });
    expect(save).toBeEnabled();
    expect(screen.getAllByText("₩1,800,000").length).toBeGreaterThanOrEqual(2);
    fireEvent.click(save);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0][0].map((write: { collection: string }) => write.collection)).toEqual(["portfolio-plan-state", "portfolio-plan-revisions", "portfolio-allocation-targets"]);
    const revisionWrite = mocks.save.mock.calls[0][0].find((write: { collection: string }) => write.collection === "portfolio-plan-revisions");
    expect(revisionWrite.values.at(-1)).toMatchObject({ targetAmountKrw: 1_800_000 });
  });

  it("prevents adding a duplicate target Stock", () => {
    render(<PortfolioPageClient />);
    const picker = screen.getByRole("combobox", { name: "등록 종목 추가" });
    for (let count = 0; count < 2; count += 1) {
      fireEvent.focus(picker); fireEvent.change(picker, { target: { value: sampleStocks[0].ticker } });
      fireEvent.click(screen.getByRole("option", { name: `${sampleStocks[0].ticker} · ${sampleStocks[0].name}` }));
    }
    expect(screen.getByRole("alert")).toHaveTextContent("같은 종목은 한 번만 추가할 수 있습니다.");
    expect(screen.getAllByLabelText(`${sampleStocks[0].name} 목표 비중`)).toHaveLength(1);
  });

  it("displays active targets, drift, and an outside-plan holding", () => {
    reset(true);
    mocks.ledger = { ...mocks.ledger, positions: [
      { key: "1", stockId: sampleStocks[0].id, stockName: sampleStocks[0].name, accountId: "a", accountName: "A", currency: sampleStocks[0].currency, quantity: 1, averagePrice: 0, investedAmount: 0, investedAmountKrw: 0, realizedProfit: 0, realizedProfitKrw: 0 },
      { key: "2", stockId: sampleStocks[1].id, stockName: sampleStocks[1].name, accountId: "a", accountName: "A", currency: sampleStocks[1].currency, quantity: 1, averagePrice: 0, investedAmount: 0, investedAmountKrw: 0, realizedProfit: 0, realizedProfitKrw: 0 },
    ] };
    render(<PortfolioPageClient />);
    expect(screen.getByDisplayValue("Stay intentional")).toBeInTheDocument();
    expect(screen.getByText("현재 계획 밖 보유")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "차이" })).toBeInTheDocument();
  });

  it("fails closed when a held Stock has no valid current price", () => {
    reset(true); mocks.stocks = mocks.stocks.map((stock, index) => index === 0 ? { ...stock, currentPrice: 0 } : stock);
    mocks.ledger = { ...mocks.ledger, positions: [{ key: "1", stockId: sampleStocks[0].id, stockName: sampleStocks[0].name, accountId: "a", accountName: "A", currency: sampleStocks[0].currency, quantity: 1, averagePrice: 0, investedAmount: 0, investedAmountKrw: 0, realizedProfit: 0, realizedProfitKrw: 0 }] };
    render(<PortfolioPageClient />);
    expect(screen.getByText("현재 배분을 계산할 수 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("하나 이상의 보유 종목에 유효한 현재가가 없습니다.")).toBeInTheDocument();
  });

  it("editing starts a new revision without mutating revision 1", async () => {
    reset(true); render(<PortfolioPageClient />);
    fireEvent.change(screen.getByLabelText("목표 운용 금액"), { target: { value: "2000000" } });
    fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    const revisionWrite = mocks.save.mock.calls[0][0].find((write: { collection: string }) => write.collection === "portfolio-plan-revisions");
    expect(revisionWrite.values).toEqual([revision, expect.objectContaining({ revisionNumber: 2, basedOnRevisionId: "r1", targetAmountKrw: 2_000_000 })]);
  });
});
