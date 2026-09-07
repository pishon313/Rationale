import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { AccountDetailClient } from "./account-detail-client";
import { AccountsPageClient } from "./accounts-page-client";
import type { InvestmentAccount } from "./types";

const collectionState = vi.hoisted(() => ({
  data: {} as Record<string, unknown[]>,
  replaceAsync: vi.fn(async () => undefined),
  applyCommitted: vi.fn(),
}));

vi.mock("@/lib/use-local-collection", () => ({
  useLocalCollection: (name: string) => {
    const allItems = collectionState.data[name] ?? [];
    return { allItems, items: allItems.filter((item) => !(item as { deletedAt?: string | null }).deletedAt), ready: true, replaceAsync: collectionState.replaceAsync, applyCommitted: collectionState.applyCommitted };
  },
}));

vi.mock("@/lib/use-exchange-rates", () => ({
  useExchangeRates: () => ({ snapshot: { ratesToKrw: { KRW: 1, USD: 1400, JPY: 9, EUR: 1600, CAD: 1000, HKD: 180 } }, ready: true }),
  useCurrencyPreference: () => ({ displayCurrency: "KRW", ready: true, setDisplayCurrency: vi.fn() }),
}));

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({
    localeTag: "ko-KR",
    t: (key: string, params?: Record<string, string | number>) => Object.entries(params ?? {}).reduce((value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)), key),
    formatDate: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ko-KR", options).format(new Date(value)),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat("ko-KR", options).format(value),
  }),
}));

const at = "2026-01-01T00:00:00.000Z";
const account: InvestmentAccount = { id: "a", name: "Trade Account", institution: "Broker", kind: "brokerage", subtype: "ISA", baseCurrency: "KRW", isDefault: true, archivedAt: null, memo: "", createdAt: at, updatedAt: at };
const trade: Trade = { id: "buy", stockId: "stock", stockName: "Stock", planId: null, tradeType: "매수", tradedAt: "2026-01-02T00:00:00.000Z", quantity: 5, price: 100, currency: "KRW", exchangeRate: 1, fee: 0, tax: 0, accountId: "a", accountName: "Trade Account", memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", deletedAt: null };
const stock = { id: "stock", name: "Stock", currentPrice: 120, currency: "KRW", deletedAt: null } as Stock;

beforeEach(() => {
  collectionState.data = { accounts: [account], trades: [trade], stocks: [stock] };
  window.history.replaceState(null, "", "/accounts");
});

describe("Account screens", () => {
  it("keeps Account list metrics useful while cash is untracked", () => {
    render(<AccountsPageClient />);
    const card = screen.getByRole("link", { name: "Trade Account" }).closest("article");
    expect(card).not.toBeNull();
    for (const label of ["평가금액", "보유 투자원금", "미실현손익", "실현손익", "순투입액"]) expect(within(card!).getByText(label)).toBeInTheDocument();
    expect(within(card!).getByText("현금 미추적")).toBeInTheDocument();
    expect(within(card!).getByText("₩600")).toBeInTheDocument();
    expect(within(card!).getAllByText("₩500")).toHaveLength(2);
    expect(within(card!).queryByText(/XIRR|총수익률|총자산/)).not.toBeInTheDocument();
  });

  it("uses cash-independent detail KPIs and exposes optional current-cash management", () => {
    window.history.replaceState(null, "", "/accounts/detail?id=a");
    render(<AccountDetailClient />);
    for (const label of ["평가금액", "보유 투자원금", "순투입액", "실현손익", "미실현손익", "열린 포지션"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("현금 미추적")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "현재 현금 입력" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "현재 현금 입력" }));
    expect(screen.getByRole("dialog", { name: "현재 현금 입력" })).toBeInTheDocument();
    expect(screen.queryByText(/XIRR|총수익률|총자산/)).not.toBeInTheDocument();
  });

  it("shows tracked and partial-Currency cash as explicit statuses", () => {
    const tracked: InvestmentAccount = { ...account, cashTracking: { version: 1, baselines: [{ currency: "KRW", balance: "1000", asOf: at, createdAt: at, updatedAt: at }] } };
    collectionState.data = { accounts: [tracked], trades: [trade], stocks: [stock] };
    const trackedView = render(<AccountsPageClient />);
    expect(screen.getByText(/추적 현금: KRW/)).toBeInTheDocument();
    trackedView.unmount();

    const usdTrade = { ...trade, id: "usd", stockId: "usd", stockName: "USD Stock", currency: "USD" as const, exchangeRate: 1400, price: 10 };
    const usdStock = { ...stock, id: "usd", name: "USD Stock", currency: "USD", currentPrice: 12 } as Stock;
    collectionState.data = { accounts: [tracked], trades: [usdTrade], stocks: [usdStock] };
    render(<AccountsPageClient />);
    expect(screen.getByText(/일부 통화 현금 미추적/)).toBeInTheDocument();
  });

  it("surfaces distinct archive reasons and explains known versus unknown cash before merge", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const archiveView = render(<AccountsPageClient />);
    fireEvent.click(screen.getByRole("button", { name: "보관" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("열린 포지션");
    archiveView.unmount();
    confirm.mockRestore();

    const second: InvestmentAccount = { ...account, id: "b", name: "Second", isDefault: false };
    collectionState.data = { accounts: [account, second], trades: [], stocks: [] };
    const mergeConfirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const view = render(<AccountsPageClient />);
    fireEvent.click(screen.getAllByRole("button", { name: "다른 계좌로 병합" })[0]);
    fireEvent.change(screen.getByRole("combobox", { name: "병합 대상 계좌" }), { target: { value: "b" } });
    await waitFor(() => expect(mergeConfirm).toHaveBeenCalledWith(expect.stringContaining("미추적 현금은 임의로 계산하지 않습니다")));
    view.unmount();
    mergeConfirm.mockRestore();
  });
});
