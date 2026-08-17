import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { sampleStocks } from "./sample-data";
import { PortfolioCategoryManager } from "./portfolio-category-manager";
import type { Stock } from "./types";

describe("PortfolioCategoryManager", () => {
  it("shows normalized categories with active and total counts", () => {
    renderManager([stock("a", "Energy"), stock("b", " energy "), stock("c", "Energy", { deletedAt: "2026-08-17T00:00:00Z" })]);
    expect(screen.getByText("Energy")).toBeInTheDocument();
    expect(screen.getByText("2개 활성 종목 · 3개 전체 종목")).toBeInTheDocument();
  });

  it("renames all exact normalized matches in one replacement", async () => {
    const onReplace = replaceMock();
    const stocks = [stock("a", "Energy"), stock("b", " energy ", { deletedAt: "2026-08-17T00:00:00Z" }), stock("c", "반도체")];
    renderManager(stocks, onReplace);
    fireEvent.click(screen.getAllByRole("button", { name: "이름 변경" })[0]);
    fireEvent.change(screen.getByLabelText("새 분류 이름"), { target: { value: "원자재" } });
    fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));
    await waitFor(() => expect(onReplace).toHaveBeenCalledTimes(1));
    expect((onReplace.mock.calls[0][0] as Stock[]).map((item) => item.sector)).toEqual(["원자재", "원자재", "반도체"]);
  });

  it("requires confirmation before merging into an existing category", async () => {
    const onReplace = replaceMock();
    renderManager([stock("a", "Energy"), stock("b", "반도체")], onReplace);
    fireEvent.click(screen.getAllByRole("button", { name: "병합" })[0]);
    fireEvent.change(screen.getByLabelText("합칠 대상"), { target: { value: "반도체" } });
    fireEvent.click(screen.getByRole("button", { name: "병합 계속" }));
    const dialog = screen.getByRole("alertdialog", { name: "분류를 병합할까요?" });
    expect(dialog).toHaveTextContent("Energy 분류의 종목 1개를 반도체(으)로 변경합니다.");
    expect(onReplace).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "분류 병합" }));
    await waitFor(() => expect(onReplace).toHaveBeenCalledTimes(1));
  });

  it("turns a rename to an existing normalized category into an explicit merge", async () => {
    const onReplace = replaceMock();
    renderManager([stock("a", "Energy"), stock("b", "반도체")], onReplace);
    fireEvent.click(screen.getAllByRole("button", { name: "이름 변경" })[0]);
    fireEvent.change(screen.getByLabelText("새 분류 이름"), { target: { value: " 반도체 " } });
    fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));
    const dialog = screen.getByRole("alertdialog", { name: "분류를 병합할까요?" });
    expect(onReplace).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "분류 병합" }));
    await waitFor(() => expect(onReplace).toHaveBeenCalledTimes(1));
    expect((onReplace.mock.calls[0][0] as Stock[]).map((item) => item.sector)).toEqual(["반도체", "반도체"]);
  });

  it("clears only the category after destructive confirmation", async () => {
    const onReplace = replaceMock();
    renderManager([stock("a", "Energy", { marketSector: "energy", tags: ["oil"] })], onReplace);
    fireEvent.click(screen.getByRole("button", { name: "분류 해제" }));
    const dialog = screen.getByRole("alertdialog", { name: "분류를 해제할까요?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "분류 해제" }));
    await waitFor(() => expect(onReplace).toHaveBeenCalledTimes(1));
    expect(onReplace.mock.calls[0][0]).toEqual([expect.objectContaining({ id: "a", sector: "", marketSector: "energy", tags: ["oil"], deletedAt: null })]);
  });

  it("keeps the manager open and reports persistence failure", async () => {
    const onReplace = replaceMock();
    onReplace.mockRejectedValue(new Error("disk full"));
    renderManager([stock("a", "Energy")], onReplace);
    fireEvent.click(screen.getByRole("button", { name: "분류 해제" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "분류 해제" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("내 분류 변경을 저장하지 못했습니다.");
    expect(screen.getByRole("dialog", { name: "내 분류 관리" })).toBeInTheDocument();
  });
});

function replaceMock() {
  return vi.fn<(stocks: Stock[]) => Promise<void>>().mockResolvedValue(undefined);
}

function renderManager(stocks: Stock[], onReplace: (stocks: Stock[]) => Promise<void> = replaceMock()) {
  return render(<PortfolioCategoryManager stocks={stocks} onReplace={onReplace} onClose={vi.fn()} />);
}

function stock(id: string, sector: string, overrides: Partial<Stock> = {}): Stock {
  return { ...sampleStocks[0], id, sector, deletedAt: null, ...overrides };
}
