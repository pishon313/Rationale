import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvestmentAccount } from "@/features/accounts/types";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { I18nProvider } from "@/i18n/i18n-provider";
import { clearPersistenceError, getCorruptionSnapshot, resolveCorruption } from "@/lib/local-repository";
import { TradeLedgerResetCard } from "./trade-ledger-reset-card";

const before = "2026-08-20T00:00:00.000Z";
const resetAt = "2026-08-21T00:00:00.000Z";
const account: InvestmentAccount = { id: "a1", name: "Primary", institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: true, archivedAt: null, memo: "", createdAt: before, updatedAt: before };
const stock: Stock = { ...sampleStocks[0], id: "s1", ticker: "ONE", name: "One", currency: "KRW", quantity: 0, averagePrice: 0, ledgerInitializedAt: before, deletedAt: null };
const trade: Trade = {
  id: "t1", stockId: "s1", stockName: "One", planId: null, tradeType: "매수", tradedAt: before,
  quantity: 2, price: 100, currency: "KRW", exchangeRate: 1, fee: 0, tax: 0, accountId: "a1", accountName: "Primary",
  memo: "memo", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 4, ruleViolations: [],
  journalStatus: "recorded", origin: { kind: "manual" }, createdAt: before, updatedAt: before, deletedAt: null,
};

function key(collection: string) {
  return `tradejournal.${collection}.v1`;
}

function seed({ trades = [trade], snapshots = [], locale = "ko" }: { trades?: Trade[]; snapshots?: unknown[]; locale?: "ko" | "en" } = {}) {
  localStorage.setItem(key("accounts"), JSON.stringify([account]));
  localStorage.setItem(key("stocks"), JSON.stringify([stock]));
  localStorage.setItem(key("trades"), JSON.stringify(trades));
  localStorage.setItem(key("trade-ledger-reset-snapshots"), JSON.stringify(snapshots));
  localStorage.setItem(key("language-preferences"), JSON.stringify([{ id: "language", locale, updatedAt: "" }]));
}

function renderCard() {
  return render(<I18nProvider><TradeLedgerResetCard /></I18nProvider>);
}

describe("TradeLedgerResetCard", () => {
  beforeEach(() => {
    localStorage.clear();
    clearPersistenceError();
    resolveCorruption(getCorruptionSnapshot().collections.map((item) => item.collection));
    vi.restoreAllMocks();
  });

  it("counts active canonical records, explains impact, and gates deletion behind a checkbox", async () => {
    seed();
    renderCard();
    const trigger = await screen.findByRole("button", { name: "매매 기록 전체 삭제" });
    expect(screen.getByText("현재 활성 원장 기록: 1건")).toBeInTheDocument();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("alertdialog", { name: "매매 기록 1건을 모두 삭제할까요?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText(/종목$/, { selector: "li" })).toBeInTheDocument();
    expect(screen.getByText(/동기화와 복구를 위해 삭제 기록은 보존됩니다/)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "매매 기록 1건 삭제" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "삭제 범위와 영향을 확인했습니다." }));
    expect(confirm).toBeEnabled();
  });

  it("atomically soft-deletes, exposes one-level undo, and restores the same Trade", async () => {
    seed();
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "매매 기록 전체 삭제" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "삭제 범위와 영향을 확인했습니다." }));
    fireEvent.click(screen.getByRole("button", { name: "매매 기록 1건 삭제" }));

    expect(await screen.findByRole("status")).toHaveTextContent("매매 기록 1건을 삭제하고 원장을 초기화했습니다.");
    const deleted = JSON.parse(localStorage.getItem(key("trades")) ?? "[]") as Trade[];
    const snapshots = JSON.parse(localStorage.getItem(key("trade-ledger-reset-snapshots")) ?? "[]") as Array<{ tradeIds: string[] }>;
    expect(deleted[0]).toMatchObject({ id: trade.id, createdAt: trade.createdAt, quantity: trade.quantity, deletedAt: expect.any(String) });
    expect(snapshots).toEqual([expect.objectContaining({ id: "latest", version: 1, tradeIds: [trade.id] })]);
    expect(JSON.parse(localStorage.getItem(key("stocks")) ?? "[]")).toEqual([stock]);

    fireEvent.click(screen.getByRole("button", { name: "마지막 매매 기록 삭제 되돌리기" }));
    expect(screen.getByRole("alertdialog", { name: "마지막 매매 기록 삭제를 되돌릴까요?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "기록 복원" }));
    expect(await screen.findByRole("status")).toHaveTextContent("매매 기록 1건을 복원했습니다.");
    expect(JSON.parse(localStorage.getItem(key("trades")) ?? "[]")[0]).toMatchObject({ id: trade.id, createdAt: trade.createdAt, quantity: trade.quantity, price: trade.price, deletedAt: null });
    expect(JSON.parse(localStorage.getItem(key("trade-ledger-reset-snapshots")) ?? "null")).toEqual([]);
  });

  it("keeps the dialog and all stored data intact when the atomic reset write fails", async () => {
    seed();
    const originalTrades = localStorage.getItem(key("trades"));
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, storageKey, value) {
      if (storageKey === key("trade-ledger-reset-snapshots")) throw new Error("disk full");
      return originalSetItem.call(this, storageKey, value);
    });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "매매 기록 전체 삭제" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "삭제 범위와 영향을 확인했습니다." }));
    fireEvent.click(screen.getByRole("button", { name: "매매 기록 1건 삭제" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("매매 기록을 삭제하지 못했습니다. 기존 데이터는 변경되지 않았습니다.");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(localStorage.getItem(key("trades"))).toBe(originalTrades);
    expect(localStorage.getItem(key("trade-ledger-reset-snapshots"))).toBe("[]");
  });

  it("blocks stale undo without changing data or clearing the snapshot", async () => {
    const stale = { ...trade, deletedAt: resetAt, updatedAt: "2026-08-21T01:00:00.000Z" };
    const snapshot = { id: "latest", version: 1, resetAt, tradeIds: [trade.id], createdAt: resetAt, updatedAt: resetAt };
    seed({ trades: [stale], snapshots: [snapshot] });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "마지막 매매 기록 삭제 되돌리기" }));
    fireEvent.click(screen.getByRole("button", { name: "기록 복원" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("삭제 후 일부 기록이 변경되어 자동으로 되돌릴 수 없습니다.");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(key("trades")) ?? "[]")).toEqual([stale]);
    expect(JSON.parse(localStorage.getItem(key("trade-ledger-reset-snapshots")) ?? "[]")).toEqual([snapshot]);
  });

  it("disables deletion with no data, dismisses by Escape, and restores focus", async () => {
    seed({ trades: [] });
    const view = renderCard();
    expect(await screen.findByRole("button", { name: "매매 기록 전체 삭제" })).toBeDisabled();
    view.unmount();

    seed();
    renderCard();
    const trigger = await screen.findByRole("button", { name: "매매 기록 전체 삭제" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("renders translated card and dialog labels", async () => {
    seed({ locale: "en" });
    renderCard();
    const trigger = await screen.findByRole("button", { name: "Delete all trade records" });
    expect(screen.getByText("Active ledger records: 1")).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole("alertdialog", { name: "Delete all 1 trade records?" })).toBeInTheDocument();
  });
});
