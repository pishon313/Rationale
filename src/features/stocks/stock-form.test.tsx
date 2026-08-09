import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { sampleStocks } from "./sample-data";
import { StockForm } from "./stock-form";
import type { StockAccountHolding } from "./stock-account-holdings";
import type { Trade } from "@/features/trades/types";

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

  it("기존 매매가 한 통화이면 종목 통화를 해당 통화로 바로잡을 수 있다", async () => {
    const onSave = vi.fn();
    const stock = { ...sampleStocks[0], ledgerInitializedAt: "2026-08-01T00:00:00.000Z" };
    render(<StockForm stock={stock} trades={[securityTrade("buy-1", "KRW")]} onCancel={vi.fn()} onSave={onSave} />);

    const currency = screen.getByLabelText("통화");
    expect(currency).not.toBeDisabled();
    fireEvent.change(currency, { target: { value: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    expect(await screen.findByRole("alertdialog", { name: "종목 통화를 변경할까요?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "통화 변경" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ currency: "USD" })));
  });

  it("기존 매매에 여러 통화가 섞여 있으면 자동 변경을 차단한다", async () => {
    const stock = { ...sampleStocks[0], ledgerInitializedAt: "2026-08-01T00:00:00.000Z" };
    render(<StockForm stock={stock} trades={[securityTrade("buy-1", "KRW"), securityTrade("buy-2", "USD")]} onCancel={vi.fn()} onSave={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("통화"), { target: { value: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("서로 다른 통화의 매매 기록");
  });

  it("통화 변경 확인을 취소하면 저장하지 않는다", async () => {
    const onSave = vi.fn();
    const stock = { ...sampleStocks[0], ledgerInitializedAt: "2026-08-01T00:00:00.000Z" };
    render(<StockForm stock={stock} trades={[securityTrade("buy-1", "KRW")]} onCancel={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("통화"), { target: { value: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    await screen.findByRole("alertdialog", { name: "종목 통화를 변경할까요?" });
    fireEvent.click(screen.getAllByRole("button", { name: "취소" }).at(-1)!);
    expect(screen.queryByRole("alertdialog", { name: "종목 통화를 변경할까요?" })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("통화 변경 저장이 실패하면 form을 유지하고 오류를 표시한다", async () => {
    const stock = { ...sampleStocks[0], ledgerInitializedAt: "2026-08-01T00:00:00.000Z" };
    render(<StockForm stock={stock} trades={[securityTrade("buy-1", "KRW")]} onCancel={vi.fn()} onSave={vi.fn(async () => { throw new Error("저장 실패"); })} />);
    fireEvent.change(screen.getByLabelText("통화"), { target: { value: "USD" } });
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    fireEvent.click(await screen.findByRole("button", { name: "통화 변경" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("저장 실패");
    expect(screen.getByRole("dialog", { name: "종목 수정" })).toBeInTheDocument();
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

function securityTrade(id: string, currency: Trade["currency"]): Trade {
  return { id, stockId: sampleStocks[0].id, stockName: sampleStocks[0].name, planId: null, tradeType: "매수", tradedAt: "2026-08-01T10:00:00.000Z", quantity: 1, price: 100, currency, exchangeRate: currency === "KRW" ? 1 : 1400, fee: 0, tax: 0, accountId: "account", accountName: "계좌", memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z", deletedAt: null };
}
