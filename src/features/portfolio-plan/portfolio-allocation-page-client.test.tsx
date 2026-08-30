import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fallbackRatesToKrw } from "@/domain/currency";
import type { TradingLedger } from "@/domain/trading-ledger";
import { sampleStocks } from "@/features/stocks/sample-data";
import { PortfolioAllocationPageClient } from "./portfolio-allocation-page-client";
import type { PortfolioPlanState } from "./types";

const mocks = vi.hoisted(() => ({
  collections: new Map<string, unknown[]>(),
  save: vi.fn(),
  applied: new Map<string, ReturnType<typeof vi.fn>>(),
  ledger: { positions: [], cashBalances: [], cycles: [], calculations: {}, errors: [], totalRealizedKrw: 0 } as TradingLedger,
}));

vi.mock("@/lib/local-repository", () => ({ saveCollectionsAtomically: mocks.save }));
vi.mock("@/lib/use-local-collection", () => ({ useLocalCollection: (name: string) => ({
  items: mocks.collections.get(name) ?? [], allItems: mocks.collections.get(name) ?? [], ready: true, loadError: "",
  applyCommitted: mocks.applied.get(name) ?? vi.fn(),
}) }));
vi.mock("@/features/stocks/use-stock-store", () => ({ useStockStore: () => ({ ready: true, loadError: "", allStocks: sampleStocks, accounts: [], trades: [], ledger: mocks.ledger }) }));
vi.mock("@/features/portfolio-shell/portfolio-shell", () => ({ usePortfolioShell: () => ({ snapshot: { status: "ready", portfolio: { baseCurrency: "KRW" } } }) }));
vi.mock("@/lib/use-exchange-rates", () => ({ useExchangeRates: () => ({ ready: true, snapshot: { ratesToKrw: fallbackRatesToKrw } }) }));

const now = "2026-08-31T00:00:00.000Z";

describe("Portfolio Allocation page", () => {
  beforeEach(() => {
    mocks.save.mockReset().mockResolvedValue(undefined);
    mocks.applied = new Map(["portfolio-plan-state", "portfolio-plan-revisions", "portfolio-allocation-groups", "portfolio-allocation-targets"].map((name) => [name, vi.fn()]));
    mocks.ledger = { positions: [], cashBalances: [], cycles: [], calculations: {}, errors: [], totalRealizedKrw: 0 };
    mocks.collections = new Map([["portfolio-plan-state", []], ["portfolio-plan-revisions", []], ["portfolio-allocation-groups", []], ["portfolio-allocation-targets", []]]);
  });

  it("creates Allocation independently without a Plan or Account", async () => {
    render(<PortfolioAllocationPageClient />);
    expect(screen.getByRole("heading", { name: "전체 자산의 목표 비중을 정하세요." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /균형 맞추기/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("현금성 자산 전체 목표 (%)"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("주식 투자 전체 목표 (%)"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Allocation 저장" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]?.[0]).toEqual([{ collection: "portfolio-plan-state", values: [expect.objectContaining({
      activeRevisionId: null,
      contributionAmountMinor: 0,
      contributionCurrency: "KRW",
      balancePolicy: expect.objectContaining({ mode: "balanceAssist", targetWeightsBps: { savings: 2000, stocks: 7000, bonds: 1000 }, toleranceBps: 500 }),
    })] }]);
    expect(screen.getByRole("status")).toHaveTextContent("Allocation을 저장했습니다. Plan 계산에 바로 반영됩니다.");
  });

  it("loads a saved Allocation and can disable its effect on Plan", async () => {
    const state: PortfolioPlanState = { id: "default", activeRevisionId: null, contributionAmountMinor: 0, contributionCurrency: "KRW", updatedAt: now, balancePolicy: { version: 1, mode: "fixed", targetWeightsBps: { savings: 3000, stocks: 5000, bonds: 2000 }, toleranceBps: 300, updatedAt: now } };
    mocks.collections.set("portfolio-plan-state", [state]);
    render(<PortfolioAllocationPageClient />);
    expect(screen.getByLabelText("주식 투자 전체 목표 (%)")).toHaveValue("50");
    expect(screen.getByRole("button", { name: /Plan 비율 유지/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Allocation 사용 안 함" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]?.[0][0].values[0].balancePolicy).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Plan은 저장된 기본 비율을 사용합니다.");
  });

  it("optionally stores stock targets and their own tolerance", async () => {
    render(<PortfolioAllocationPageClient />);
    fireEvent.click(screen.getByRole("button", { name: "주식 세부 비율 설정" }));
    fireEvent.click(screen.getByRole("button", { name: "종목 추가" }));
    const weights = screen.getAllByLabelText("종목 목표 비중 (%)");
    fireEvent.change(weights[0]!, { target: { value: "70" } });
    fireEvent.change(weights[1]!, { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("주식 세부 허용 오차 (%)"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Allocation 저장" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]?.[0][0].values[0].balancePolicy).toMatchObject({
      stockTargets: [
        { stockId: sampleStocks[0]!.id, targetWeightBps: 7000 },
        { stockId: sampleStocks[1]!.id, targetWeightBps: 3000 },
      ],
      stockToleranceBps: 300,
    });
  });
});
