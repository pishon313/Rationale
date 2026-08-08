import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { sampleStocks } from "./sample-data";
import { StockForm } from "./stock-form";
import type { StockAccountHolding } from "./stock-account-holdings";

describe("StockForm", () => {
  it("필수 필드 없이 제출하면 오류를 표시한다", async () => {
    render(<StockForm onCancel={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "종목 추가" }));
    await waitFor(() => expect(screen.getByText("티커를 입력해 주세요.")).toBeInTheDocument());
  });

  it("새 종목은 메타데이터만 입력하고 원장 관리 상태로 저장한다", async () => {
    const onSave = vi.fn();
    render(<StockForm onCancel={vi.fn()} onSave={onSave} />);

    expect(screen.queryByLabelText("계좌")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("평균단가")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("보유 수량")).not.toBeInTheDocument();
    expect(screen.getByText(/종목 추가 후 매매 원장에서 등록/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("티커"), { target: { value: "NEW" } });
    fireEvent.change(screen.getByLabelText("종목명"), { target: { value: "새 종목" } });
    fireEvent.click(screen.getByRole("button", { name: "종목 추가" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0][0];
    expect(saved).toMatchObject({ averagePrice: 0, quantity: 0, ledgerInitializedAt: expect.any(String) });
    expect(saved).not.toHaveProperty("openingAccountName");
  });

  it("원장 관리 종목은 현재 보유 계좌와 수량을 읽기 전용으로 표시한다", () => {
    const stock = { ...sampleStocks[0], ledgerInitializedAt: "2026-08-01T00:00:00.000Z" };
    render(<StockForm stock={stock} holdings={[holding("a", "ISA", 2), holding("b", "연금", 3)]} onCancel={vi.fn()} onSave={vi.fn()} />);

    expect(screen.queryByLabelText("계좌")).not.toBeInTheDocument();
    expect(screen.getByText("ISA")).toBeInTheDocument();
    expect(screen.getByText("연금")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "매매 원장 열기" })).toHaveAttribute("href", "/trades");
  });

  it("현재 포지션이 없는 원장 종목은 기초 포지션 CTA를 표시한다", () => {
    const stock = { ...sampleStocks[1], quantity: 0, averagePrice: 0, ledgerInitializedAt: "2026-08-01T00:00:00.000Z" };
    render(<StockForm stock={stock} holdings={[]} onCancel={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByText("현재 보유 포지션이 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "기초 포지션 등록" })).toHaveAttribute("href", `/trades?openingStockId=${stock.id}`);
  });

  it("legacy 종목을 수정해도 기존 기초 보유값을 보존한다", async () => {
    const onSave = vi.fn();
    const stock = { ...sampleStocks[0], ledgerInitializedAt: null, openingAccountName: "예전 계좌", quantity: 7, averagePrice: 123 };
    render(<StockForm stock={stock} onCancel={vi.fn()} onSave={onSave} />);

    expect(screen.getByText("기존 보유 정보")).toBeInTheDocument();
    expect(screen.getByText("예전 계좌")).toBeInTheDocument();
    expect(screen.queryByLabelText("계좌")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ openingAccountName: "예전 계좌", quantity: 7, averagePrice: 123, ledgerInitializedAt: null })));
  });
});

function holding(accountId: string, accountName: string, quantity: number): StockAccountHolding {
  return { stockId: "stock", accountId, accountName, currency: "KRW", quantity, averagePrice: 100, investedAmount: quantity * 100, investedAmountKrw: quantity * 100 };
}
