import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fallbackRatesToKrw } from "@/domain/currency";
import type { TradingLedger } from "@/domain/trading-ledger";
import type { InvestmentAccount } from "@/features/accounts/types";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { PortfolioAllocationGroup, PortfolioAllocationTarget, PortfolioPlanRevision, PortfolioPlanState } from "./types";
import { PortfolioPlanPageClient } from "./portfolio-plan-page-client";

const mocks = vi.hoisted(() => ({
  collections: new Map<string, unknown[]>(),
  save: vi.fn(),
  applied: new Map<string, ReturnType<typeof vi.fn>>(),
  accountItems: [] as InvestmentAccount[],
  ledger: { positions: [], cashBalances: [], cycles: [], calculations: {}, errors: [], totalRealizedKrw: 0 } as TradingLedger,
}));

vi.mock("@/lib/local-repository", () => ({ saveCollectionsAtomically: mocks.save }));
vi.mock("@/lib/use-local-collection", () => ({ useLocalCollection: (name: string) => ({
  items: mocks.collections.get(name) ?? [], allItems: mocks.collections.get(name) ?? [], ready: true, loadError: "",
  applyCommitted: mocks.applied.get(name) ?? vi.fn(),
}) }));
vi.mock("@/features/stocks/use-stock-store", () => ({ useStockStore: () => ({ ready: true, loadError: "", allStocks: sampleStocks, stocks: sampleStocks, accounts: mocks.accountItems, trades: [], ledger: mocks.ledger }) }));
vi.mock("@/features/portfolio-shell/portfolio-shell", () => ({ usePortfolioShell: () => ({ snapshot: { status: "ready", portfolio: { baseCurrency: "KRW" } } }) }));
vi.mock("@/lib/use-exchange-rates", () => ({ useExchangeRates: () => ({ ready: true, snapshot: { ratesToKrw: fallbackRatesToKrw } }) }));

const now = "2026-08-30T00:00:00.000Z";
const accounts: InvestmentAccount[] = ["a", "b"].map((id, index) => ({ id, name: `Account ${id.toUpperCase()}`, institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: index === 0, archivedAt: null, memo: "", createdAt: now, updatedAt: now }));
const revision: PortfolioPlanRevision = { id: "r1", revisionNumber: 1, basedOnRevisionId: null, thesis: "Original", changeNote: "", createdAt: now, activatedAt: now, updatedAt: now };
const state: PortfolioPlanState = { id: "default", activeRevisionId: "r1", contributionAmountMinor: 1_000_000, contributionCurrency: "KRW", updatedAt: now };
const group: PortfolioAllocationGroup = { id: "g1", revisionId: "r1", name: "Core", targetWeightBps: 10000, sortOrder: 0, updatedAt: now };
const target: PortfolioAllocationTarget = { id: "t1", revisionId: "r1", groupId: "g1", accountId: "a", targetType: "stock", stockId: sampleStocks[0]!.id, weightWithinGroupBps: 10000, sortOrder: 0, updatedAt: now };

describe("Contribution Plan page", () => {
  beforeEach(() => {
    mocks.save.mockReset().mockResolvedValue(undefined);
    mocks.applied = new Map(["portfolio-plan-state", "portfolio-plan-revisions", "portfolio-allocation-groups", "portfolio-allocation-targets"].map((name) => [name, vi.fn()]));
    mocks.accountItems = accounts;
    mocks.ledger = { positions: [], cashBalances: [], cycles: [], calculations: {}, errors: [], totalRealizedKrw: 0 };
    mocks.collections = new Map([["portfolio-plan-state", []], ["portfolio-plan-revisions", []], ["portfolio-allocation-groups", []], ["portfolio-allocation-targets", []]]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("builds and activates the first calculator plan without any Account", async () => {
    mocks.accountItems = [];
    render(<PortfolioPlanPageClient />);
    expect(screen.getByRole("heading", { name: "월 저축액을 적금·주식·채권으로 나눠보세요." })).toBeInTheDocument();
    expect(screen.getByText("적금")).toBeInTheDocument();
    expect(screen.getByText("주식 투자")).toBeInTheDocument();
    expect(screen.getByText("채권")).toBeInTheDocument();
    const categoryWeights = screen.getAllByLabelText("전체 저축액 중 비율 (%)");
    fireEvent.change(categoryWeights[0]!, { target: { value: "0" } });
    fireEvent.change(categoryWeights[1]!, { target: { value: "100" } });
    fireEvent.change(categoryWeights[2]!, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "주식 종목 추가" }));
    const stockPicker = screen.getByRole("combobox", { name: "주식 종목" });
    fireEvent.focus(stockPicker);
    fireEvent.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]!);
    const activate = screen.getByRole("button", { name: "Plan 활성화" });
    expect(activate).toBeEnabled();
    fireEvent.click(activate);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]?.[0].map((write: { collection: string }) => write.collection)).toEqual(["portfolio-plan-state", "portfolio-plan-revisions", "portfolio-allocation-groups", "portfolio-allocation-targets"]);
    expect(mocks.save.mock.calls[0]?.[0].find((write: { collection: string }) => write.collection === "portfolio-allocation-targets").values[0].accountId).toBeNull();
    expect(await screen.findByRole("status")).toHaveTextContent("Contribution Plan을 저장하고 활성화했습니다.");
  });

  it("calculates the default 30/60/10 category amounts before targets are complete", () => {
    render(<PortfolioPlanPageClient />);
    fireEvent.change(screen.getByLabelText("전체 저축액"), { target: { value: "1000000" } });
    const savings = screen.getByRole("button", { name: "적금 카테고리 펼치기" }).closest("article")!;
    const stocks = screen.getByRole("button", { name: "주식 투자 카테고리 펼치기" }).closest("article")!;
    const bonds = screen.getByRole("button", { name: "채권 카테고리 펼치기" }).closest("article")!;
    expect(within(savings).getByText("₩300,000")).toBeInTheDocument();
    expect(within(stocks).getAllByText("₩600,000").length).toBeGreaterThan(0);
    expect(within(bonds).getByText("₩100,000")).toBeInTheDocument();
  });

  it("adds multiple savings accounts with independent within-category ratios", () => {
    render(<PortfolioPlanPageClient />);
    fireEvent.click(screen.getByRole("button", { name: "적금 카테고리 펼치기" }));
    fireEvent.click(screen.getByRole("button", { name: "적금 계좌 추가" }));
    fireEvent.click(screen.getByRole("button", { name: "적금 계좌 추가" }));
    expect(screen.getAllByLabelText(/^은행 \/ 계좌/)).toHaveLength(2);
    expect(screen.getAllByLabelText("Within Group (%)")).toHaveLength(2);
  });

  it("saves contribution-only edits as one state write", async () => {
    seedActive();
    render(<PortfolioPlanPageClient />);
    fireEvent.change(screen.getByLabelText("전체 저축액"), { target: { value: "1000.25" } });
    fireEvent.change(screen.getByLabelText("통화"), { target: { value: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: "Contribution 저장" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ collection: "portfolio-plan-state", values: [expect.objectContaining({ contributionAmountMinor: 100_025, contributionCurrency: "USD", activeRevisionId: "r1" })] })]);
  });

  it("reads the saved Allocation policy and applies it to the Plan calculation", () => {
    seedActive();
    mocks.collections.set("portfolio-plan-state", [{ ...state, balancePolicy: { version: 1, mode: "balanceAssist", targetWeightsBps: { savings: 3000, stocks: 6000, bonds: 1000 }, toleranceBps: 500, updatedAt: now } }]);
    mocks.ledger = { ...mocks.ledger, positions: [{ key: "p", stockId: sampleStocks[0]!.id, stockName: "삼성전자", accountId: "a", accountName: "Account A", currency: "KRW", quantity: 1_000, averagePrice: 0, investedAmount: 0, investedAmountKrw: 0, realizedProfit: 0, realizedProfitKrw: 0 }] };
    render(<PortfolioPlanPageClient />);
    expect(screen.getByRole("link", { name: "Allocation에서 수정" })).toHaveAttribute("href", "/portfolio/allocation");
    expect(screen.queryByRole("button", { name: "전체 목표 저장" })).not.toBeInTheDocument();
    const categoryWeights = screen.getAllByLabelText("전체 저축액 중 비율 (%)");
    expect(categoryWeights[0]).toHaveValue("75");
    expect(categoryWeights[1]).toHaveValue("0");
    expect(categoryWeights[2]).toHaveValue("25");
  });

  it("uses optional Allocation stock targets to split the Plan stock amount", () => {
    seedActive();
    mocks.collections.set("portfolio-plan-state", [{ ...state, balancePolicy: { version: 1, mode: "fixed", targetWeightsBps: { savings: 0, stocks: 10000, bonds: 0 }, toleranceBps: 500, stockTargets: [{ stockId: sampleStocks[0]!.id, targetWeightBps: 7000 }, { stockId: sampleStocks[1]!.id, targetWeightBps: 3000 }], stockToleranceBps: 300, updatedAt: now } }]);
    render(<PortfolioPlanPageClient />);
    const summary = screen.getByRole("complementary", { name: "이번 저축 실행표" });
    expect(within(summary).getByText("005930 · 삼성전자")).toBeInTheDocument();
    expect(within(summary).getByText("005380 · 현대차")).toBeInTheDocument();
    expect(within(summary).getByText("₩700,000")).toBeInTheDocument();
    expect(within(summary).getByText("₩300,000")).toBeInTheDocument();
  });

  it("creates a new immutable revision when Thesis changes and disables invalid saves", async () => {
    seedActive();
    render(<PortfolioPlanPageClient />);
    fireEvent.click(screen.getByText(/Investment Thesis와 Change Note/));
    fireEvent.change(screen.getByLabelText("투자 근거 (선택)"), { target: { value: "Changed thesis" } });
    expect(screen.getByLabelText("변경 이유 (선택)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "새 리비전 저장" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    const revisionWrite = mocks.save.mock.calls[0]?.[0].find((write: { collection: string }) => write.collection === "portfolio-plan-revisions");
    expect(revisionWrite.values).toHaveLength(2);
    expect(revisionWrite.values[1]).toMatchObject({ revisionNumber: 2, basedOnRevisionId: "r1", thesis: "Changed thesis" });

    mocks.save.mockClear();
    fireEvent.change(screen.getAllByLabelText("전체 저축액 중 비율 (%)")[1]!, { target: { value: "99.999" } });
    expect(screen.getByRole("button", { name: "새 리비전 저장" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("저장하기 전에 확인해 주세요.");
  });

  it("keeps the edited draft and committed stores unchanged when saving fails", async () => {
    seedActive();
    mocks.save.mockRejectedValue(new Error("disk full"));
    render(<PortfolioPlanPageClient />);
    fireEvent.change(screen.getByLabelText("전체 저축액"), { target: { value: "2000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Contribution 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("포트폴리오 계획을 저장하지 못했습니다.");
    expect(screen.getByLabelText("전체 저축액")).toHaveValue("2000000");
    expect(mocks.applied.get("portfolio-plan-state")).not.toHaveBeenCalled();
  });

  it("presents the three-step editor with an exact manual execution summary", () => {
    seedActive();
    render(<PortfolioPlanPageClient />);
    expect(screen.getByText("01 · 전체 저축액")).toBeInTheDocument();
    expect(screen.getByText("02 · Target Allocation")).toBeInTheDocument();
    expect(screen.getAllByText("고정 카테고리")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Group 삭제/ })).not.toBeInTheDocument();
    expect(screen.getByText("Target 1개 · 100%")).toBeInTheDocument();
    const summary = screen.getByRole("complementary", { name: "이번 저축 실행표" });
    expect(within(summary).getByText("03 · 계산 결과")).toBeInTheDocument();
    expect(within(summary).getByRole("heading", { name: "이번 저축 실행표" })).toBeInTheDocument();
    expect(within(summary).getByLabelText("합계")).toHaveTextContent("₩1,000,000");
    expect(within(summary).getByText("Allocation 유효 · minor-unit 합계 일치")).toBeInTheDocument();
    expect(within(summary).getByText("Rationale은 주문을 실행하지 않습니다. 계산된 금액을 사용해 관련 은행 또는 증권 계좌에서 직접 매수하세요.")).toBeInTheDocument();
  });

  it("automatically upgrades a previously stored V6 account repair draft", async () => {
    const legacyRevision = { ...revision, targetAmountKrw: 1_000_000 };
    const legacyTarget = { id: "legacy-cash", revisionId: "r1", targetType: "cash" as const, stockId: null, targetWeightBps: 10000, sortOrder: 0, updatedAt: now };
    const repairState: PortfolioPlanState = { id: "default", activeRevisionId: null, contributionAmountMinor: 1_000_000, contributionCurrency: "KRW", updatedAt: now, repairDraft: { version: 1, status: "needsAccountSelection", legacyState: { id: "default", activeRevisionId: "r1", updatedAt: now }, legacyRevisions: [legacyRevision], legacyTargets: [legacyTarget], unresolvedTargetIds: ["legacy-cash"], inferredAccountIdsByTargetId: {} } };
    mocks.collections.set("portfolio-plan-state", [repairState]);
    render(<PortfolioPlanPageClient />);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ collection: "portfolio-plan-state", values: [expect.objectContaining({ activeRevisionId: "r1", repairDraft: null })] }),
      expect.objectContaining({ collection: "portfolio-allocation-targets", values: [expect.objectContaining({ id: "legacy-cash", accountId: null })] }),
    ]));
  });
});

function seedActive() {
  mocks.collections = new Map([["portfolio-plan-state", [state]], ["portfolio-plan-revisions", [revision]], ["portfolio-allocation-groups", [group]], ["portfolio-allocation-targets", [target]]]);
}
