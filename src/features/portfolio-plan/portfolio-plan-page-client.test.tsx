import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvestmentAccount } from "@/features/accounts/types";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { PortfolioAllocationGroup, PortfolioAllocationTarget, PortfolioPlanRevision, PortfolioPlanState } from "./types";
import { PortfolioPlanPageClient } from "./portfolio-plan-page-client";

const mocks = vi.hoisted(() => ({
  collections: new Map<string, unknown[]>(),
  save: vi.fn(),
  applied: new Map<string, ReturnType<typeof vi.fn>>(),
}));

vi.mock("@/lib/local-repository", () => ({ saveCollectionsAtomically: mocks.save }));
vi.mock("@/lib/use-local-collection", () => ({ useLocalCollection: (name: string) => ({
  items: mocks.collections.get(name) ?? [], allItems: mocks.collections.get(name) ?? [], ready: true, loadError: "",
  applyCommitted: mocks.applied.get(name) ?? vi.fn(),
}) }));
vi.mock("@/features/stocks/use-stock-store", () => ({ useStockStore: () => ({ ready: true, loadError: "", allStocks: sampleStocks, stocks: sampleStocks, accounts, trades: [], ledger: { positions: [], cashBalances: [], cycles: [], calculations: {}, errors: [], totalRealizedKrw: 0 } }) }));
vi.mock("@/features/portfolio-shell/portfolio-shell", () => ({ usePortfolioShell: () => ({ snapshot: { status: "ready", portfolio: { baseCurrency: "KRW" } } }) }));

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
    mocks.collections = new Map([["portfolio-plan-state", []], ["portfolio-plan-revisions", []], ["portfolio-allocation-groups", []], ["portfolio-allocation-targets", []]]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("builds and activates the first complete Group/Target plan", async () => {
    render(<PortfolioPlanPageClient />);
    expect(screen.getByRole("heading", { name: "Contribution Plan" })).toBeInTheDocument();
    expect(screen.getByText("첫 Allocation Group을 추가해 주세요.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Allocation Group 추가" })[0]!);
    fireEvent.change(screen.getByLabelText(/^Group 이름/), { target: { value: "Core" } });
    fireEvent.click(screen.getByRole("button", { name: "Stock 추가" }));
    const stockPicker = screen.getByRole("combobox", { name: "Stock" });
    fireEvent.focus(stockPicker);
    fireEvent.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]!);
    fireEvent.change(screen.getByLabelText(/^실행 Account/), { target: { value: "a" } });
    const activate = screen.getByRole("button", { name: "Plan 활성화" });
    expect(activate).toBeEnabled();
    fireEvent.click(activate);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]?.[0].map((write: { collection: string }) => write.collection)).toEqual(["portfolio-plan-state", "portfolio-plan-revisions", "portfolio-allocation-groups", "portfolio-allocation-targets"]);
    expect(await screen.findByRole("status")).toHaveTextContent("Contribution Plan을 저장하고 활성화했습니다.");
  });

  it("saves contribution-only edits as one state write", async () => {
    seedActive();
    render(<PortfolioPlanPageClient />);
    fireEvent.change(screen.getByLabelText("Contribution Amount"), { target: { value: "1000.25" } });
    fireEvent.change(screen.getByLabelText("통화"), { target: { value: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: "Contribution 저장" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]?.[0]).toEqual([expect.objectContaining({ collection: "portfolio-plan-state", values: [expect.objectContaining({ contributionAmountMinor: 100_025, contributionCurrency: "USD", activeRevisionId: "r1" })] })]);
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
    fireEvent.change(screen.getByLabelText("Target Weight (%)"), { target: { value: "99.999" } });
    expect(screen.getByRole("button", { name: "새 리비전 저장" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("저장하기 전에 확인해 주세요.");
  });

  it("keeps the edited draft and committed stores unchanged when saving fails", async () => {
    seedActive();
    mocks.save.mockRejectedValue(new Error("disk full"));
    render(<PortfolioPlanPageClient />);
    fireEvent.change(screen.getByLabelText("Contribution Amount"), { target: { value: "2000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Contribution 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("포트폴리오 계획을 저장하지 못했습니다.");
    expect(screen.getByLabelText("Contribution Amount")).toHaveValue("2000000");
    expect(mocks.applied.get("portfolio-plan-state")).not.toHaveBeenCalled();
  });

  it("presents the three-step editor with an exact manual execution summary", () => {
    seedActive();
    render(<PortfolioPlanPageClient />);
    expect(screen.getByText("01 · Contribution Amount")).toBeInTheDocument();
    expect(screen.getByText("02 · Target Allocation")).toBeInTheDocument();
    const summary = screen.getByRole("complementary", { name: "This Contribution" });
    expect(within(summary).getByText("03 · This Contribution")).toBeInTheDocument();
    expect(within(summary).getByLabelText("합계")).toHaveTextContent("₩1,000,000");
    expect(within(summary).getByText("Rationale은 주문을 실행하지 않습니다. 계산된 금액을 사용해 관련 은행 또는 증권 계좌에서 직접 매수하세요.")).toBeInTheDocument();
  });

  it("finishes V6 account repair with one four-collection activation", async () => {
    const legacyRevision = { ...revision, targetAmountKrw: 1_000_000 };
    const legacyTarget = { id: "legacy-cash", revisionId: "r1", targetType: "cash" as const, stockId: null, targetWeightBps: 10000, sortOrder: 0, updatedAt: now };
    const repairState: PortfolioPlanState = { id: "default", activeRevisionId: null, contributionAmountMinor: 1_000_000, contributionCurrency: "KRW", updatedAt: now, repairDraft: { version: 1, status: "needsAccountSelection", legacyState: { id: "default", activeRevisionId: "r1", updatedAt: now }, legacyRevisions: [legacyRevision], legacyTargets: [legacyTarget], unresolvedTargetIds: ["legacy-cash"], inferredAccountIdsByTargetId: {} } };
    mocks.collections.set("portfolio-plan-state", [repairState]);
    render(<PortfolioPlanPageClient />);
    expect(screen.getByText("Account 복구 모드")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^실행 Account/), { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: "복구된 Plan 활성화" }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]?.[0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ collection: "portfolio-plan-state", values: [expect.objectContaining({ activeRevisionId: "r1", repairDraft: null })] }),
      expect.objectContaining({ collection: "portfolio-allocation-targets", values: [expect.objectContaining({ id: "legacy-cash", accountId: "b" })] }),
    ]));
  });
});

function seedActive() {
  mocks.collections = new Map([["portfolio-plan-state", [state]], ["portfolio-plan-revisions", [revision]], ["portfolio-allocation-groups", [group]], ["portfolio-allocation-targets", [target]]]);
}
