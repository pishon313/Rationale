import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTradingLedger } from "@/domain/trading-ledger";
import type { InvestmentAccount } from "@/features/accounts/types";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "./types";
import { AccountTransferDialog, TradeRow, TradesPageClient } from "./trades-page-client";

const collectionState = vi.hoisted(() => ({
  data: {} as Record<string, unknown[]>,
  writes: [] as Array<{ name: string; items: unknown[] }>,
  applyCommitted: vi.fn(),
}));

vi.mock("@/lib/use-local-collection", () => ({
  useLocalCollection: (name: string) => {
    const allItems = collectionState.data[name] ?? [];
    return { allItems, items: allItems.filter((item) => !(item as { deletedAt?: string | null }).deletedAt), ready: true, replaceAsync: async (items: unknown[]) => { collectionState.writes.push({ name, items }); }, applyCommitted: collectionState.applyCommitted };
  },
}));

vi.mock("@/lib/use-exchange-rates", () => ({
  useExchangeRates: () => ({ snapshot: { ratesToKrw: { KRW: 1, USD: 1400, JPY: 9, EUR: 1600, CAD: 1000, HKD: 180 }, fetchedAt: "2026-01-01T00:00:00.000Z", rateDate: "2026-01-01" }, ready: true, refreshing: false, onlineError: "", refresh: vi.fn() }),
  useCurrencyPreference: () => ({ displayCurrency: "KRW", ready: true, setDisplayCurrency: vi.fn() }),
}));

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => Object.entries(params ?? {}).reduce((value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)), key),
    formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ko-KR", options).format(new Date(value)),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat("ko-KR", options).format(value),
  }),
}));

const at = "2026-01-01T00:00:00.000Z";
const untrackedA: InvestmentAccount = { id: "a", name: "Account A", institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: true, archivedAt: null, memo: "", createdAt: at, updatedAt: at };
const untrackedB: InvestmentAccount = { ...untrackedA, id: "b", name: "Account B", isDefault: false };
const stock: Stock = { ...sampleStocks[0], id: "stock", ticker: "TEST", name: "Test Stock", currency: "KRW", quantity: 6, averagePrice: 100, currentPrice: 200, ledgerInitializedAt: at, deletedAt: null };

const buy = trade({ id: "buy", tradeType: "매수", tradedAt: "2026-01-02T00:00:00.000Z", quantity: 10, price: 100 });
const sell = trade({ id: "sell", tradeType: "매도", tradedAt: "2026-01-03T00:00:00.000Z", quantity: 4, price: 150 });

beforeEach(() => {
  collectionState.data = { accounts: [untrackedA, untrackedB], trades: [buy, sell], stocks: [stock], plans: [], rules: [] };
  collectionState.writes = [];
  collectionState.applyCommitted.mockClear();
  window.history.replaceState(null, "", "/trades");
});

describe("TradesPageClient", () => {
  it("uses Trade/P&L-first KPIs and shows buy input versus sell recovery without pseudo-cash", () => {
    render(<TradesPageClient />);
    const capitalMetric = screen.getByText("누적 순투입액").closest("article");
    const realizedMetric = screen.getByText("누적 실현손익").closest("article");
    expect(capitalMetric).not.toBeNull();
    expect(realizedMetric).not.toBeNull();
    expect(within(capitalMetric!).getByText("+₩400")).toBeInTheDocument();
    expect(within(realizedMetric!).getByText("+₩200")).toBeInTheDocument();
    expect(screen.queryByText("현금 잔액")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /잔액 조정/ })).not.toBeInTheDocument();

    const rows = screen.getAllByRole("row").slice(1);
    const sellCapital = within(rows[0]).getAllByRole("cell")[5];
    const buyCapital = within(rows[1]).getAllByRole("cell")[5];
    expect(sellCapital).toHaveTextContent("-₩600");
    expect(buyCapital).toHaveTextContent("+₩1,000");
    expect(within(sellCapital).queryByText(/현금/)).not.toBeInTheDocument();
    expect(within(buyCapital).queryByText(/현금/)).not.toBeInTheDocument();
    expect(screen.queryByText("기초 현금이 등록되지 않은 계좌가 있습니다.")).not.toBeInTheDocument();
  });

  it("opens current cash from the Trade page and writes Account metadata without creating a Trade", async () => {
    render(<TradesPageClient />);
    fireEvent.click(screen.getAllByRole("button", { name: "현재 현금 입력" })[0]);
    const dialog = screen.getByRole("dialog", { name: "현재 현금 입력" });
    fireEvent.change(within(dialog).getByLabelText("현재 현금"), { target: { value: "0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(collectionState.writes).toHaveLength(1));
    expect(collectionState.writes[0].name).toBe("accounts");
    expect(collectionState.writes[0].items).toEqual([expect.objectContaining({ id: "a", cashTracking: { version: 1, baselines: [expect.objectContaining({ currency: "KRW", balance: "0" })] } }), untrackedB]);
    expect(collectionState.writes.some((write) => write.name === "trades")).toBe(false);
  });

  it("persists an edited cash-event amount through the mounted Trade page", async () => {
    const deposit = trade({ id: "deposit", stockId: null, stockName: "", tradeType: "입금", quantity: 0, price: 0, amount: 100_000, cashFlowKind: "external" });
    collectionState.data = { accounts: [withCash(untrackedA)], trades: [deposit], stocks: [], plans: [], rules: [] };
    render(<TradesPageClient />);
    fireEvent.click(screen.getByRole("button", { name: "기록 수정" }));
    fireEvent.change(screen.getByLabelText("입금 금액"), { target: { value: "120000" } });
    fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
    await waitFor(() => expect(collectionState.writes.find((write) => write.name === "trades")?.items).toEqual([expect.objectContaining({ id: "deposit", amount: 120_000 })]));
  });
});

describe("TradeRow", () => {
  it("keeps opening positions outside net trade capital and adds cash only when tracked", () => {
    const opening = trade({ id: "opening", tradeType: "매수", quantity: 3, price: 100, isOpeningPosition: true });
    const untrackedLedger = buildTradingLedger([opening], [untrackedA]);
    const first = render(<table><tbody><TradeRow trade={opening} accountName="Account A" ledger={untrackedLedger} onEdit={vi.fn()} onDelete={vi.fn()} /></tbody></table>);
    expect(screen.getAllByRole("cell")[5]).toHaveTextContent("—");
    first.unmount();

    const tracked = withCash(untrackedA);
    const trackedLedger = buildTradingLedger([buy], [tracked]);
    render(<table><tbody><TradeRow trade={buy} accountName="Account A" ledger={trackedLedger} onEdit={vi.fn()} onDelete={vi.fn()} /></tbody></table>);
    const capitalCell = screen.getAllByRole("cell")[5];
    expect(capitalCell).toHaveTextContent("+₩1,000");
    expect(capitalCell).toHaveTextContent("현금 -₩1,000");
  });
});

describe("AccountTransferDialog", () => {
  it("requires explicit current cash on both sides and links directly to each missing baseline", async () => {
    const onRequestCash = vi.fn();
    const onSave = vi.fn().mockResolvedValue(true);
    const props = { pair: undefined, onRequestCash, onClose: vi.fn(), onSave };
    const view = render(<AccountTransferDialog {...props} accounts={[untrackedA, untrackedB]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("양쪽 계좌의 현재 현금");
    expect(screen.getByRole("button", { name: "보내는 계좌 현재 현금 입력" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "받는 계좌 현재 현금 입력" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "보내는 계좌 현재 현금 입력" }));
    expect(onRequestCash).toHaveBeenCalledWith("a", "KRW", expect.any(HTMLElement));
    expect(onRequestCash.mock.calls[0][2]).toHaveTextContent("이체 저장");
    expect(screen.getByRole("button", { name: "이체 저장" })).toBeDisabled();

    view.rerender(<AccountTransferDialog {...props} accounts={[withCash(untrackedA), withCash(untrackedB)]} />);
    fireEvent.change(screen.getByLabelText("금액"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "이체 저장" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ sourceAccountId: "a", targetAccountId: "b", amount: 100, currency: "KRW" })));
  });
});

function trade(overrides: Partial<Trade>): Trade {
  return {
    id: "trade", stockId: "stock", stockName: "Test Stock", planId: null, tradeType: "매수", tradedAt: "2026-01-02T00:00:00.000Z",
    quantity: 1, price: 100, currency: "KRW", exchangeRate: 1, fee: 0, tax: 0, accountId: "a", accountName: "Account A",
    memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", deletedAt: null,
    ...overrides,
  };
}

function withCash(account: InvestmentAccount): InvestmentAccount {
  return { ...account, cashTracking: { version: 1, baselines: [{ currency: "KRW", balance: "0", asOf: at, createdAt: at, updatedAt: at }] } };
}
