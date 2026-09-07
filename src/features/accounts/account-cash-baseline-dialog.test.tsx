import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvestmentAccount } from "./types";
import { AccountCashBaselineDialog } from "./account-cash-baseline-dialog";

vi.mock("@/i18n/i18n-provider", () => ({
  useI18n: () => ({ t: (key: string, params?: Record<string, string | number>) => Object.entries(params ?? {}).reduce((value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)), key) }),
}));

const at = "2026-09-07T00:00:00.000Z";
const account = (cash = false): InvestmentAccount => ({
  id: "a", name: "Account", institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW",
  isDefault: true, archivedAt: null, memo: "", createdAt: at, updatedAt: at,
  ...(cash ? { cashTracking: { version: 1 as const, baselines: [{ currency: "KRW" as const, balance: "12", asOf: at, createdAt: at, updatedAt: at }] } } : {}),
});

afterEach(() => vi.useRealTimers());

describe("AccountCashBaselineDialog", () => {
  it("creates an actual-zero baseline and returns focus after success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T10:00:00+09:00"));
    const trigger = document.createElement("button");
    document.body.append(trigger);
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const view = render(<AccountCashBaselineDialog accounts={[account()]} initialAccountId="a" initialCurrency="KRW" returnFocus={trigger} onClose={onClose} onSave={onSave} />);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByLabelText("계좌")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("현재 현금"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await vi.runAllTimersAsync();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ accountId: "a", currency: "KRW", balance: "0" }));
    expect(onClose).toHaveBeenCalled();
    view.unmount();
    await vi.runAllTimersAsync();
    expect(trigger).toHaveFocus();
  });

  it("loads an existing baseline in update mode and rejects a materially future timestamp", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T10:00:00+09:00"));
    const onSave = vi.fn();
    render(<AccountCashBaselineDialog accounts={[account(true)]} initialAccountId="a" initialCurrency="KRW" onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByRole("heading", { name: "현재 현금 수정" })).toBeInTheDocument();
    expect(screen.getByLabelText("계좌")).toBeDisabled();
    expect(screen.getByLabelText("통화")).toBeDisabled();
    expect(screen.getByLabelText("현재 현금")).toHaveValue("12");
    fireEvent.change(screen.getByLabelText("기준 일시"), { target: { value: "2026-09-07T10:06:00" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByRole("alert")).toHaveTextContent("미래일 수 없습니다");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps the dialog open after persistence failure and permits retry", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("현재 현금을 저장하지 못했습니다. 다시 시도해 주세요.")).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    render(<AccountCashBaselineDialog accounts={[account()]} initialAccountId="a" initialCurrency="KRW" onClose={onClose} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("현재 현금"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("저장하지 못했습니다");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
