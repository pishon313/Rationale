import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useMemo, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { buildTradingLedger } from "@/domain/trading-ledger";
import type { Trade } from "@/features/trades/types";
import { AccountCashSummary } from "./account-cash-summary";
import type { InvestmentAccount } from "./types";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => Object.entries(params ?? {}).reduce((value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)), key),
    formatDate: (value: Date | string | number) => new Date(value).toISOString(),
    formatNumber: (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat("ko-KR", options).format(value),
  }),
}));

const at = "2026-01-01T00:00:00.000Z";
const account: InvestmentAccount = { id: "a", name: "Account", institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: true, archivedAt: null, memo: "", createdAt: at, updatedAt: at };
const buy: Trade = { id: "buy", stockId: "stock", stockName: "Stock", planId: null, tradeType: "매수", tradedAt: "2026-02-01T00:00:00.000Z", quantity: 1, price: 100, currency: "KRW", exchangeRate: 1, fee: 0, tax: 0, accountId: "a", accountName: "Account", memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-01T00:00:00.000Z", deletedAt: null };

describe("AccountCashSummary", () => {
  it("moves from untracked to actual zero with an Account-only update, then stops after confirmation", async () => {
    const replace = vi.fn();
    function Harness() {
      const [accounts, setAccounts] = useState([account]);
      const ledger = useMemo(() => buildTradingLedger([], accounts), [accounts]);
      return <AccountCashSummary accounts={accounts} trades={[]} ledger={ledger} onReplaceAccounts={async (next) => { replace(next); setAccounts(next); }} />;
    }
    render(<Harness />);
    expect(screen.getByText("현금 미추적")).toBeInTheDocument();
    expect(screen.queryByText(/₩0/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "현재 현금 입력" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("현재 현금"), { target: { value: "0" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "현재 현금 수정" })).toBeInTheDocument());
    expect(screen.getByText(/₩0/)).toBeInTheDocument();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0][0].cashTracking.baselines[0].balance).toBe("0");
    const stopTrigger = screen.getByRole("button", { name: "현금 추적 중단" });
    fireEvent.click(stopTrigger);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("기존 매매·입출금 기록은 삭제되지 않습니다");
    fireEvent.click(screen.getByRole("button", { name: "추적 중단" }));
    await waitFor(() => expect(screen.getByText("현금 미추적")).toBeInTheDocument());
    expect(replace).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByRole("button", { name: "현재 현금 입력" })).toHaveFocus());
  });

  it("shows a non-blocking negative tracked-cash warning with an update action", () => {
    const tracked: InvestmentAccount = { ...account, cashTracking: { version: 1, baselines: [{ currency: "KRW", balance: "0", asOf: at, createdAt: at, updatedAt: at }] } };
    render(<AccountCashSummary accounts={[tracked]} trades={[buy]} ledger={buildTradingLedger([buy], [tracked])} onReplaceAccounts={vi.fn()} />);
    expect(screen.getByText("추적 중인 현금이 음수입니다. 누락된 입출금이 있거나 현재 현금을 다시 맞춰야 할 수 있습니다.")).toBeInTheDocument();
    expect(screen.getByText(/-₩100|−₩100/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "현재 현금 수정" })).toBeEnabled();
  });
});
