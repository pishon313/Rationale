import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { sampleStocks } from "./sample-data";
import { StockForm } from "./stock-form";

describe("StockForm", () => {
  it("필수 필드 없이 제출하면 오류를 표시한다", async () => {
    render(<StockForm onCancel={vi.fn()} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("티커"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "종목 추가" }));
    await waitFor(() => expect(screen.getByText("티커를 입력해 주세요.")).toBeInTheDocument());
  });

  it("원장 관리 종목의 통화·평균단가·수량을 잠근다", async () => {
    const onSave = vi.fn();
    const stock = { ...sampleStocks[0], ledgerInitializedAt: "2026-08-01T00:00:00.000Z" };
    render(<StockForm stock={stock} onCancel={vi.fn()} onSave={onSave} />);

    expect(screen.getByLabelText("통화")).toBeDisabled();
    expect(screen.getByLabelText("평균단가")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("보유 수량")).toHaveAttribute("readonly");
    expect(screen.getByText(/매매 원장에서 자동 계산/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ currency: stock.currency, averagePrice: stock.averagePrice, quantity: stock.quantity })));
  });

  it("보유 수량이 없는 새 종목은 원장 관리 상태로 시작한다", async () => {
    const onSave = vi.fn();
    render(<StockForm onCancel={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("티커"), { target: { value: "NEW" } });
    fireEvent.change(screen.getByLabelText("종목명"), { target: { value: "새 종목" } });
    fireEvent.click(screen.getByRole("button", { name: "종목 추가" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].ledgerInitializedAt).toEqual(expect.any(String));
  });
});
