import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { sampleStocks } from "@/features/stocks/sample-data";
import { ReviewForm } from "./reviews-page-client";

describe("Review registered Stock picker", () => {
  it("links a searched registered Stock and hides the free-text target", () => {
    const save = vi.fn();
    render(<ReviewForm stocks={sampleStocks} cancel={vi.fn()} save={save} />);
    const picker = screen.getByRole("combobox", { name: "연결할 종목 (선택)" });
    selectStock(picker, "MU", "MU · Micron Technology");
    expect(screen.queryByLabelText("회고 대상")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ stockId: "micron", stockName: "Micron Technology" }));
  });

  it("keeps an unlinked review as free text without creating or linking a Stock", () => {
    const save = vi.fn();
    render(<ReviewForm stocks={sampleStocks} cancel={vi.fn()} save={save} />);
    expect(screen.getByRole("combobox", { name: "연결할 종목 (선택)" })).toHaveValue("종목에 연결하지 않고 직접 입력");
    fireEvent.change(screen.getByPlaceholderText("예: NVIDIA · 매수하지 않은 결정"), {
      target: { value: "등록하지 않은 후보" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ stockId: null, stockName: "등록하지 않은 후보" }));
  });

  it("switches a linked Review to the explicit direct-input option", () => {
    const save = vi.fn();
    render(<ReviewForm stocks={sampleStocks} initialStockId="micron" cancel={vi.fn()} save={save} />);
    const picker = screen.getByRole("combobox", { name: "연결할 종목 (선택)" });
    fireEvent.focus(picker);
    fireEvent.click(screen.getByRole("option", { name: "종목에 연결하지 않고 직접 입력" }));
    fireEvent.change(screen.getByPlaceholderText("예: NVIDIA · 매수하지 않은 결정"), {
      target: { value: "별도 판단" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ stockId: null, stockName: "별도 판단" }));
  });
});

function selectStock(picker: HTMLElement, query: string, optionName: string) {
  fireEvent.focus(picker);
  fireEvent.change(picker, { target: { value: query } });
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}
