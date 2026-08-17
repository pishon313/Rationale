import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { buildTradingLedger } from "@/domain/trading-ledger";
import { sampleStocks } from "@/features/stocks/sample-data";
import { samplePlans } from "@/features/plans/sample-data";
import { sampleRules } from "@/features/rules/sample-data";
import { sampleTrades } from "./sample-data";
import { TradeForm } from "./trade-form";
import type { InvestmentAccount } from "@/features/accounts/types";
import { calculateAccountFee, type AccountFeePolicyV1 } from "@/features/accounts/account-fee-policy";
import { createAccountFeeCalculationSnapshot } from "./trade-fee";

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

  it("가져온 거래를 수정하면 초와 출처를 보존하고 검토 완료로 저장한다", () => {
    const onSave = vi.fn();
    const origin = { kind: "fileImport" as const, sourceKey: "file:v1:abc", importBatchId: "file:v1:batch:abc", importedAt: "2026-08-12T00:00:00Z", sourceRow: 2, timePrecision: "second" as const };
    const trade = { ...sampleTrades[0], tradedAt: "2026-08-12T10:11:12", origin, journalStatus: "unreviewed" as const };
    render(<TradeForm trade={trade} stocks={sampleStocks} plans={samplePlans} rules={sampleRules} ledger={buildTradingLedger([])} onCancel={vi.fn()} onSave={onSave} />);
    expect(screen.getByLabelText("거래 일시")).toHaveAttribute("step", "1");
    expect(screen.getByLabelText("거래 일시")).toHaveValue("2026-08-12T10:11:12.000");
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: trade.id, createdAt: trade.createdAt, tradedAt: "2026-08-12T10:11:12", origin, journalStatus: "recorded" }));
  });

  it("새 수동 거래는 manual 및 recorded 메타데이터를 사용한다", () => {
    const onSave = vi.fn();
    render(<TradeForm stocks={sampleStocks} plans={samplePlans} rules={sampleRules} ledger={buildTradingLedger([])} onCancel={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("수량"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("체결 가격"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "기록 저장" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ journalStatus: "recorded", origin: { kind: "manual" } }));
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

  it("새 매수는 계좌 정책으로 자동 계산하고 수량 변경 시 다시 계산해 스냅샷을 저장한다", () => {
    const onSave = vi.fn();
    render(<TradeForm stocks={[feeStock]} plans={[]} rules={[]} ledger={buildTradingLedger([])} accounts={[feeAccount()]} onCancel={vi.fn()} onSave={onSave} />);
    expect(screen.getByRole("button", { name: "자동 계산" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("수량"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("체결 가격"), { target: { value: "1000" } });
    expect(screen.getByLabelText("수수료")).toHaveValue(1);
    fireEvent.change(screen.getByLabelText("수량"), { target: { value: "2" } });
    expect(screen.getByLabelText("수수료")).toHaveValue(2);
    fireEvent.click(screen.getByRole("button", { name: "기록 저장" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fee: 2, feeMode: "accountPolicy", feeCalculation: expect.objectContaining({ policyAccountId: "fee-account", ruleId: "fee-rule", quantity: "2", price: "1000", grossAmount: "2000", calculatedFee: "2" }) }));
  });

  it("자동 계산을 직접 입력으로 바꾸면 스냅샷 없이 manual로 저장하고 세금은 유지한다", () => {
    const onSave = vi.fn();
    render(<TradeForm stocks={[feeStock]} plans={[]} rules={[]} ledger={buildTradingLedger([])} accounts={[feeAccount()]} onCancel={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("수량"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("체결 가격"), { target: { value: "1000" } });
    fireEvent.change(screen.getByLabelText("세금"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "직접 입력" }));
    fireEvent.change(screen.getByLabelText("수수료"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("수량"), { target: { value: "2" } });
    expect(screen.getByLabelText("세금")).toHaveValue(3);
    fireEvent.click(screen.getByRole("button", { name: "기록 저장" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fee: 7, feeMode: "manual", feeCalculation: null, tax: 3 }));
  });

  it("활성 정책에 일치 규칙이 없으면 자동 0 저장을 막고 직접 입력 후에만 저장한다", () => {
    const onSave = vi.fn();
    const sellOnly = feeAccount({ ...feePolicy, rules: [{ ...feePolicy.rules[0], side: "sell" }] });
    render(<TradeForm stocks={[feeStock]} plans={[]} rules={[]} ledger={buildTradingLedger([])} accounts={[sellOnly]} onCancel={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("수량"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("체결 가격"), { target: { value: "1000" } });
    expect(screen.getByRole("alert")).toHaveTextContent("적용되는 계좌 수수료 규칙이 없습니다.");
    fireEvent.click(screen.getByRole("button", { name: "기록 저장" }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "직접 입력으로 전환" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "기록 저장" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fee: 0, feeMode: "manual", feeCalculation: null }));
  });

  it("기존 자동 수수료는 현재 정책이 바뀌어도 열 때와 관련 없는 저장에서 그대로 보존한다", () => {
    const onSave = vi.fn();
    const historical = automaticTrade();
    render(<TradeForm trade={historical} stocks={[feeStock]} plans={[]} rules={[]} ledger={buildTradingLedger([])} accounts={[feeAccount({ ...feePolicy, rules: [{ ...feePolicy.rules[0], ratePercent: "0.2" }] })]} onCancel={vi.fn()} onSave={onSave} />);
    expect(screen.getByLabelText("수수료")).toHaveValue(1);
    fireEvent.change(screen.getByLabelText("메모"), { target: { value: "메모만 변경" } });
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fee: 1, feeMode: "accountPolicy", feeCalculation: historical.feeCalculation, memo: "메모만 변경" }));
  });

  it("기존 자동 거래의 계산 기준 변경은 명시적 재계산 전 저장을 막는다", () => {
    const onSave = vi.fn();
    const historical = automaticTrade();
    render(<TradeForm trade={historical} stocks={[feeStock]} plans={[]} rules={[]} ledger={buildTradingLedger([])} accounts={[feeAccount({ ...feePolicy, rules: [{ ...feePolicy.rules[0], ratePercent: "0.2" }] })]} onCancel={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("수량"), { target: { value: "2" } });
    expect(screen.getByRole("alert")).toHaveTextContent("더 이상 유효하지 않습니다");
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "현재 계좌 규칙으로 다시 계산" }));
    expect(screen.getByLabelText("수수료")).toHaveValue(4);
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ fee: 4, feeMode: "accountPolicy", feeCalculation: expect.objectContaining({ quantity: "2", calculatedFee: "4" }) }));
  });

  it("원본 제공 수수료는 기준 변경 후 직접 입력 확인 전에는 sourceProvided로 저장하지 않는다", () => {
    const onSave = vi.fn();
    const imported = { ...automaticTrade(), feeMode: "sourceProvided" as const, feeCalculation: null, origin: { kind: "fileImport" as const, sourceKey: "file:v2:test", importBatchId: "batch", importedAt: "2026-08-17T01:00:00Z" } };
    render(<TradeForm trade={imported} stocks={[feeStock]} plans={[]} rules={[]} ledger={buildTradingLedger([])} accounts={[feeAccount()]} onCancel={vi.fn()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("수량"), { target: { value: "2" } });
    expect(screen.getByRole("alert")).toHaveTextContent("원본에서 제공된 수수료");
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "직접 입력으로 확정" }));
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ feeMode: "manual", feeCalculation: null }));
  });
});

function account(id: string, name: string, isDefault = false): InvestmentAccount {
  return { id, name, institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault, archivedAt: null, memo: "", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

const feePolicy: AccountFeePolicyV1 = { version: 1, enabled: true, rules: [{ id: "fee-rule", name: "한국 매수", market: "한국", currency: "KRW", side: "buy", ratePercent: "0.1", fixedFee: "0", minimumFee: null, maximumFee: null, grossAmountFrom: null, grossAmountTo: null, effectiveFrom: "2026-01-01", effectiveTo: null, roundingMode: "floor", roundingUnit: "1" }] };
const feeStock = { ...sampleStocks[0], id: "fee-stock", ticker: "FEE", name: "수수료 종목", market: "한국" as const, currency: "KRW" as const };

function feeAccount(policy: AccountFeePolicyV1 = feePolicy): InvestmentAccount {
  return { ...account("fee-account", "수수료 계좌", true), feePolicy: policy };
}

function automaticTrade() {
  const matched = calculateAccountFee(feePolicy, { accountId: "fee-account", market: "한국", currency: "KRW", side: "buy", tradedAt: "2026-08-17T10:00:00", grossAmount: "1000" });
  if (matched.status !== "matched") throw new Error("fixture did not match");
  const feeCalculation = createAccountFeeCalculationSnapshot({ policyAccountId: "fee-account", side: "buy", tradedAt: "2026-08-17T10:00:00", quantity: "1", price: "1000", currency: "KRW", result: matched, calculatedAt: "2026-08-17T01:00:00Z" });
  return { ...sampleTrades[0], id: "automatic", stockId: feeStock.id, stockName: feeStock.name, tradeType: "매수" as const, tradedAt: "2026-08-17T10:00:00", quantity: 1, price: 1000, currency: "KRW" as const, exchangeRate: 1, fee: 1, feeMode: "accountPolicy" as const, feeCalculation, tax: 0, accountId: "fee-account", accountName: "수수료 계좌", createdAt: "2026-08-17T01:00:00Z", updatedAt: "2026-08-17T01:00:00Z" };
}
