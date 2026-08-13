import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { vi } from "vitest";
import { sampleStocks } from "./sample-data";
import { StockForm } from "./stock-form";
import type { StockAccountHolding } from "./stock-account-holdings";
import type { Trade } from "@/features/trades/types";
import type { InstrumentSearchResult } from "./market-data";
import type { Stock } from "./types";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("StockForm", () => {
  afterEach(() => {
    invokeMock.mockReset();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

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

  it("검색으로 연결된 종목의 8개 identity 필드를 읽기 전용 정보로 표시한다", () => {
    render(<StockForm stock={linkedStock({ priceStatus: "error" })} onCancel={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "검색으로 연결된 종목 정보" })).toBeInTheDocument();
    for (const label of ["티커", "종목명", "시장", "통화", "가격 제공자", "Provider symbol", "국가 코드", "거래소 코드"]) {
      expect(screen.getByLabelText(label).tagName).toBe("OUTPUT");
    }
    expect(screen.getByLabelText("가격 제공자")).toHaveTextContent("EODHD");
    expect(screen.getByLabelText("Provider symbol")).toHaveTextContent("005930.KO");
    expect(screen.getByLabelText("국가 코드")).toHaveTextContent("KR");
    expect(screen.getByLabelText("거래소 코드")).toHaveTextContent("KO");
  });

  it("직접 입력한 종목의 identity 필드는 기존처럼 수정할 수 있다", () => {
    render(<StockForm stock={{ ...sampleStocks[0], quantity: 0, providerRefs: [], quotePreference: "manual" }} onCancel={vi.fn()} onSave={vi.fn()} />);

    for (const label of ["티커", "종목명", "시장", "통화", "가격 제공자", "Provider symbol", "국가 코드", "거래소 코드"]) {
      expect(screen.getByLabelText(label)).toBeEnabled();
      expect(screen.getByLabelText(label).tagName).not.toBe("OUTPUT");
    }
  });

  it("수동 관리 전환을 취소하면 데이터를 변경하지 않고 window.confirm도 호출하지 않는다", () => {
    const onSave = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<StockForm stock={linkedStock()} onCancel={vi.fn()} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "수동 관리로 전환" }));
    const dialog = screen.getByRole("alertdialog", { name: "수동 관리로 전환할까요?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));

    expect(screen.queryByRole("alertdialog", { name: "수동 관리로 전환할까요?" })).not.toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Provider symbol")).toHaveTextContent("005930.KO");
  });

  it("수동 관리 전환 승인 시 연결만 제거하고 마지막 가격과 metadata를 보존한다", async () => {
    const onSave = vi.fn();
    const stock = linkedStock();
    render(<StockForm stock={stock} onCancel={vi.fn()} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "수동 관리로 전환" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "수동 관리로 전환할까요?" })).getByRole("button", { name: "수동 관리로 전환" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0][0] as Stock;
    expect(saved.providerRefs).toEqual([]);
    expect(saved.quotePreference).toBe("manual");
    expect(saved).toMatchObject({
      currentPrice: stock.currentPrice,
      priceUpdatedAt: stock.priceUpdatedAt,
      priceQuotedAt: stock.priceQuotedAt,
      priceSource: stock.priceSource,
      priceFreshness: stock.priceFreshness,
      priceDelayMinutes: stock.priceDelayMinutes,
      priceStatus: stock.priceStatus,
    });
  });

  it("현재 가격을 수동 수정해도 자동 listing identity와 잠금 상태를 유지한다", async () => {
    const onSave = vi.fn();
    const stock = linkedStock();
    render(<StockForm stock={stock} onCancel={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("현재 가격"), { target: { value: "75000" } });
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      ticker: stock.ticker,
      currency: stock.currency,
      providerRefs: stock.providerRefs,
      quotePreference: "auto",
      currentPrice: 75000,
      priceSource: "manual",
    });
  });

  it.each([
    ["매매 기록", { trades: [securityTrade("buy-1", "KRW")], holdings: [] }],
    ["보유 수량", { trades: [], holdings: [holding("a", "ISA", 2)] }],
  ])("%s이 있는 연결 종목은 재연결할 수 없다", (_case, context) => {
    render(<StockForm stock={linkedStock()} trades={context.trades} holdings={context.holdings} onCancel={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByRole("button", { name: "다른 종목으로 다시 연결" })).toBeDisabled();
    expect(screen.getByText("기존 기록 보호를 위해 새 종목으로 추가해 주세요.")).toBeInTheDocument();
  });

  it("재연결 검색을 취소하면 기존 listing을 유지한다", () => {
    const onSave = vi.fn();
    render(<StockForm stock={linkedStock()} onCancel={vi.fn()} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "다른 종목으로 다시 연결" }));
    expect(screen.getByRole("textbox", { name: "종목 검색어" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "재연결 취소" }));

    expect(screen.queryByRole("textbox", { name: "종목 검색어" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("티커")).toHaveTextContent("005930");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("거래와 보유가 없는 종목은 검색 결과의 identity 전체를 원자적으로 교체한다", async () => {
    const onSave = vi.fn();
    enableTauriSearch([canadianListing]);
    render(<StockForm stock={linkedStock()} onCancel={vi.fn()} onSave={onSave} />);

    fireEvent.click(screen.getByRole("button", { name: "다른 종목으로 다시 연결" }));
    fireEvent.change(screen.getByRole("textbox", { name: "종목 검색어" }), { target: { value: "Shopify" } });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));
    fireEvent.click(await screen.findByRole("button", { name: /SHOP · Shopify/ }));

    expect(screen.getByLabelText("티커")).toHaveTextContent("SHOP");
    expect(screen.getByLabelText("종목명")).toHaveTextContent("Shopify");
    expect(screen.getByLabelText("시장")).toHaveTextContent("캐나다");
    expect(screen.getByLabelText("통화")).toHaveTextContent("CAD");
    expect(screen.getByLabelText("가격 제공자")).toHaveTextContent("EODHD");
    expect(screen.getByLabelText("Provider symbol")).toHaveTextContent("SHOP.TO");
    expect(screen.getByLabelText("국가 코드")).toHaveTextContent("CA");
    expect(screen.getByLabelText("거래소 코드")).toHaveTextContent("TO");

    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({
      ticker: "SHOP",
      name: "Shopify",
      market: "캐나다",
      currency: "CAD",
      countryCode: "CA",
      exchangeCode: "TO",
      exchangeMic: "XTSE",
      exchangeName: "Toronto Stock Exchange",
      isin: "CA82509L1076",
      providerRefs: [{ provider: "eodhd", symbol: "SHOP.TO", exchangeCode: "TO" }],
      quotePreference: "auto",
    });
  });

  it("지원하지 않는 통화의 검색 결과는 선택할 수 없다", async () => {
    enableTauriSearch([{ ...canadianListing, ticker: "VOD", name: "Vodafone", currency: "GBP", countryCode: "GB", exchangeCode: "LSE", providerSymbol: "VOD.LSE" }]);
    render(<StockForm stock={linkedStock()} onCancel={vi.fn()} onSave={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "다른 종목으로 다시 연결" }));
    fireEvent.change(screen.getByRole("textbox", { name: "종목 검색어" }), { target: { value: "Vodafone" } });
    fireEvent.click(screen.getByRole("button", { name: "검색" }));

    expect(await screen.findByRole("button", { name: /VOD · Vodafone/ })).toBeDisabled();
    expect(screen.getByText("지원하지 않는 통화")).toBeInTheDocument();
  });
});

const canadianListing: InstrumentSearchResult = {
  provider: "eodhd",
  providerSymbol: "SHOP.TO",
  ticker: "SHOP",
  name: "Shopify",
  countryCode: "CA",
  countryName: "Canada",
  exchangeCode: "TO",
  exchangeMic: "XTSE",
  exchangeName: "Toronto Stock Exchange",
  currency: "CAD",
  assetType: "Common Stock",
  isin: "CA82509L1076",
  previousClose: 150.25,
  previousCloseDate: "2026-08-12",
  isPrimary: true,
};

function linkedStock(overrides: Partial<Stock> = {}): Stock {
  return {
    ...sampleStocks[0],
    quantity: 0,
    countryCode: "KR",
    exchangeCode: "KO",
    exchangeMic: "XKRX",
    exchangeName: "Korea Exchange",
    isin: "KR7005930003",
    providerRefs: [{ provider: "eodhd", symbol: "005930.KO", exchangeCode: "KO" }],
    quotePreference: "auto",
    priceUpdatedAt: "2026-08-13T01:02:03.000Z",
    priceQuotedAt: "2026-08-12",
    priceSource: "eodhd",
    priceFreshness: "eod",
    priceDelayMinutes: 15,
    priceStatus: "online",
    ...overrides,
  };
}

function enableTauriSearch(results: InstrumentSearchResult[]) {
  (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  invokeMock.mockResolvedValue(results);
}

function holding(accountId: string, accountName: string, quantity: number): StockAccountHolding {
  return { stockId: "stock", accountId, accountName, currency: "KRW", quantity, averagePrice: 100, investedAmount: quantity * 100, investedAmountKrw: quantity * 100 };
}

function securityTrade(id: string, currency: Trade["currency"]): Trade {
  return { id, stockId: sampleStocks[0].id, stockName: sampleStocks[0].name, planId: null, tradeType: "매수", tradedAt: "2026-08-01T10:00:00.000Z", quantity: 1, price: 100, currency, exchangeRate: currency === "KRW" ? 1 : 1400, fee: 0, tax: 0, accountId: "account", accountName: "계좌", memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, createdAt: "2026-08-01T10:00:00.000Z", updatedAt: "2026-08-01T10:00:00.000Z", deletedAt: null };
}
