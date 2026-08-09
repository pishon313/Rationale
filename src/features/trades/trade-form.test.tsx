import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { buildTradingLedger } from "@/domain/trading-ledger";
import { sampleStocks } from "@/features/stocks/sample-data";
import { samplePlans } from "@/features/plans/sample-data";
import { sampleRules } from "@/features/rules/sample-data";
import { sampleTrades } from "./sample-data";
import { TradeForm } from "./trade-form";
import type { InvestmentAccount } from "@/features/accounts/types";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({
    locale: "ko",
    localeTag: "ko-KR",
    t: (key: string, params?: Record<string, string | number>) => Object.entries(params ?? {}).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), key),
    formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ko-KR", options).format(new Date(value)),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat("ko-KR", options).format(value),
  }),
}));

describe("TradeForm", () => {
  it("실제 전달된 종목은 표시하고 계획 연결 항목은 숨긴다", () => {
    const stock = { ...sampleStocks[0], id: "user-stock", name: "사용자 종목", ticker: "USER" };
    const plan = { ...samplePlans[0], id: "user-plan", stockId: stock.id, stockName: stock.name, ticker: stock.ticker, title: "사용자 계획" };
    render(<TradeForm stocks={[stock]} plans={[plan]} rules={sampleRules} ledger={buildTradingLedger([])} onCancel={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole("option", { name: "사용자 종목 (USER)" })).toBeInTheDocument();
    expect(screen.queryByLabelText("연결된 매매 계획")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "사용자 계획" })).not.toBeInTheDocument();
  });

  it("기존 계획 연결은 폼에서 숨겨도 수정 저장 시 보존한다", () => {
    const onSave = vi.fn();
    const trade = { ...sampleTrades[1], quantity: 1, price: 100 };
    render(<TradeForm trade={trade} stocks={sampleStocks} plans={samplePlans} rules={sampleRules} ledger={buildTradingLedger([])} onCancel={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ planId: trade.planId }));
  });

  it("입금 유형에서는 현금 금액 필드를 표시한다", () => {
    render(<TradeForm stocks={sampleStocks} plans={samplePlans} rules={sampleRules} ledger={buildTradingLedger([])} onCancel={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "입금" }));
    expect(screen.getByLabelText("입금 금액")).toBeInTheDocument();
    expect(screen.queryByLabelText("수량")).not.toBeInTheDocument();
  });

  it("원화 종목에서 달러 종목으로 바꾸면 기본 환율을 적용한다", () => {
    render(<TradeForm stocks={sampleStocks} plans={samplePlans} rules={sampleRules} ledger={buildTradingLedger([])} onCancel={vi.fn()} onSave={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("종목"), { target: { value: "micron" } });
    expect(screen.getByLabelText("적용 환율")).toHaveValue(1380);
  });

  it("원화 현금에서 달러 현금으로 바꾸면 기본 환율을 적용한다", async () => {
    render(<TradeForm stocks={sampleStocks} plans={samplePlans} rules={sampleRules} ledger={buildTradingLedger([])} onCancel={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "입금" }));
    fireEvent.change(screen.getByLabelText("통화"), { target: { value: "USD" } });
    await waitFor(() => expect(screen.getByLabelText("적용 환율")).toHaveValue(1380));
  });

  it("원화 기록 저장 시 환율을 1로 고정하고 초기 포지션 여부를 보존한다", () => {
    const onSave = vi.fn();
    const trade = { ...sampleTrades[0], price: 0, exchangeRate: 1380, isOpeningPosition: true };
    render(<TradeForm trade={trade} stocks={sampleStocks} plans={samplePlans} rules={sampleRules} ledger={buildTradingLedger([])} onCancel={vi.fn()} onSave={onSave} />);
    expect(screen.getByRole("button", { name: "입금" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "입금" }));
    expect(screen.queryByLabelText("입금 금액")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ currency: "KRW", exchangeRate: 1, isOpeningPosition: true }));
  });

  it("기초 포지션 등록 시 종목을 미리 선택하고 현금 흐름 없는 시작 거래를 만든다", () => {
    const onSave = vi.fn();
    const stock = { ...sampleStocks[1], openingAccountName: "ISA 계좌" };
    render(<TradeForm openingPosition initialStockId={stock.id} stocks={[...sampleStocks.filter((item) => item.id !== stock.id), stock]} plans={samplePlans} rules={sampleRules} ledger={buildTradingLedger([])} onCancel={vi.fn()} onSave={onSave} />);

    expect(screen.getByRole("heading", { name: "기초 포지션 등록" })).toBeInTheDocument();
    expect(screen.getByLabelText("종목")).toHaveValue(stock.id);
    expect(screen.getByLabelText("계좌")).toHaveDisplayValue("ISA 계좌");
    expect(screen.getByLabelText("평균단가")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("수량"), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText("평균단가"), { target: { value: "45000" } });
    fireEvent.click(screen.getByRole("button", { name: "기초 포지션 저장" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ stockId: stock.id, quantity: 12, price: 45000, isOpeningPosition: true }));
  });

  it("현금 기록에서 매매로 전환하면 선택 종목의 통화와 환율을 동기화한다", () => {
    const cashTrade = { ...sampleTrades[0], id: "cash", stockId: null, stockName: "", tradeType: "입금" as const, quantity: 0, price: 0, amount: 100_000, currency: "KRW" as const, exchangeRate: 1 };
    const usdStock = sampleStocks.find((stock) => stock.id === "micron")!;
    render(<TradeForm trade={cashTrade} stocks={[usdStock]} plans={samplePlans} rules={sampleRules} ledger={buildTradingLedger([])} onCancel={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "매수" }));
    expect(screen.getByLabelText("적용 환율")).toHaveValue(1380);
  });

  it("원장 검증 오류를 열린 패널 안에 표시한다", () => {
    render(<TradeForm formError="매도 수량이 보유 수량을 초과합니다." stocks={sampleStocks} plans={samplePlans} rules={sampleRules} ledger={buildTradingLedger([])} onCancel={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("매도 수량이 보유 수량을 초과합니다.");
  });

  it("일반 매매 폼에서 이체 기록 수정을 차단한다", () => {
    const onSave = vi.fn();
    const trade = { ...sampleTrades[0], stockId: null, stockName: "", tradeType: "출금" as const, quantity: 0, price: 0, amount: 100, cashFlowKind: "transfer" as const, transferId: "pair" };
    render(<TradeForm trade={trade} stocks={sampleStocks} plans={samplePlans} rules={sampleRules} ledger={buildTradingLedger([])} onCancel={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("이체 전용 화면");
  });

  it("저장이 끝날 때까지 제출 버튼을 잠가 중복 저장을 막는다", async () => {
    let finishSave = () => {};
    const onSave = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    render(<TradeForm stocks={sampleStocks} plans={samplePlans} rules={sampleRules} ledger={buildTradingLedger([])} onCancel={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("수량"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("체결 가격"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "기록 저장" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "저장 중..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "저장 중..." }));
    expect(onSave).toHaveBeenCalledTimes(1);
    finishSave();
    await waitFor(() => expect(screen.getByRole("button", { name: "기록 저장" })).toBeEnabled());
  });

  it("context에서는 종목과 계좌를 고정하고 허용된 유형만 표시한다", () => {
    const onSave = vi.fn();
    const accounts = [account("a", "Account A", true), account("b", "Account B")];
    const stock = sampleStocks[0];
    render(<TradeForm lockedStockId={stock.id} lockedAccountId="b" allowedTypes={["매수", "매도", "배당"]} stocks={sampleStocks} plans={samplePlans} rules={sampleRules} ledger={buildTradingLedger([])} accounts={accounts} onCancel={vi.fn()} onSave={onSave} />);
    expect(screen.getByLabelText("종목")).toBeDisabled();
    expect(screen.getByLabelText("종목")).toHaveValue(stock.id);
    expect(screen.getByLabelText("계좌")).toBeDisabled();
    expect(screen.getByLabelText("계좌")).toHaveValue("b");
    expect(screen.queryByRole("button", { name: "입금" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "출금" })).not.toBeInTheDocument();
  });

  it("context의 초기 계좌를 선택하되 generic add에서는 변경할 수 있다", () => {
    const accounts = [account("a", "Account A", true), account("b", "Account B")];
    render(<TradeForm initialAccountId="b" allowedTypes={["매수", "매도", "배당"]} stocks={sampleStocks} plans={samplePlans} rules={sampleRules} ledger={buildTradingLedger([])} accounts={accounts} onCancel={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByLabelText("계좌")).toHaveValue("b");
    expect(screen.getByLabelText("계좌")).not.toBeDisabled();
  });
});

function account(id: string, name: string, isDefault = false): InvestmentAccount {
  return { id, name, institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault, archivedAt: null, memo: "", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}
