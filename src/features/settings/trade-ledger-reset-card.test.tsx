import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PersistenceStatus } from "@/components/persistence-status";
import type { InvestmentAccount } from "@/features/accounts/types";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { I18nProvider } from "@/i18n/i18n-provider";
import { clearPersistenceError, getCorruptionSnapshot, getPersistenceSnapshot, resolveCorruption, saveCollection } from "@/lib/local-repository";
import { TradeLedgerResetCard } from "./trade-ledger-reset-card";

const tauriMocks = vi.hoisted(() => ({ load: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: tauriMocks.load } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriMocks.invoke }));

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
  return render(<I18nProvider><TradeLedgerResetCard /><PersistenceStatus /></I18nProvider>);
}

describe("TradeLedgerResetCard", () => {
  beforeEach(() => {
    localStorage.clear();
    clearPersistenceError();
    resolveCorruption(getCorruptionSnapshot().collections.map((item) => item.collection));
    vi.restoreAllMocks();
    tauriMocks.load.mockReset();
    tauriMocks.invoke.mockReset();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
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

  it("keeps a failed reset out of global retry and rebuilds it for an in-dialog retry", async () => {
    seed();
    const originalTrades = localStorage.getItem(key("trades"));
    const originalSetItem = Storage.prototype.setItem;
    let failed = false;
    const resetCandidates: Trade[][] = [];
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, storageKey, value) {
      if (storageKey === key("trades")) {
        const candidate = JSON.parse(value) as Trade[];
        if (candidate.some((item) => item.deletedAt)) resetCandidates.push(candidate);
      }
      if (storageKey === key("trade-ledger-reset-snapshots") && value !== "[]" && !failed) {
        failed = true;
        throw new Error("disk full");
      }
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
    expect(getPersistenceSnapshot()).toMatchObject({ error: null, canRetry: false, pendingWrites: 0 });
    expect(screen.queryByRole("button", { name: "재시도" })).not.toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "매매 기록 1건 삭제" });
    await waitFor(() => expect(retry).toBeEnabled());
    expect(screen.getByRole("checkbox", { name: "삭제 범위와 영향을 확인했습니다." })).toBeChecked();

    await new Promise((resolve) => window.setTimeout(resolve, 5));
    fireEvent.click(retry);

    expect(await screen.findByRole("status")).toHaveTextContent("매매 기록 1건을 삭제하고 원장을 초기화했습니다.");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("현재 활성 원장 기록: 0건")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "마지막 매매 기록 삭제 되돌리기" })).toBeEnabled();
    expect(resetCandidates).toHaveLength(2);
    expect(resetCandidates[1][0].deletedAt).not.toBe(resetCandidates[0][0].deletedAt);
    expect(getPersistenceSnapshot()).toMatchObject({ error: null, canRetry: false, pendingWrites: 0 });
  });

  it("keeps a failed undo local and rebuilds it for an in-dialog retry", async () => {
    const deleted = { ...trade, deletedAt: resetAt, updatedAt: resetAt };
    const snapshot = { id: "latest", version: 1, resetAt, tradeIds: [trade.id], createdAt: resetAt, updatedAt: resetAt };
    seed({ trades: [deleted], snapshots: [snapshot] });
    const originalSetItem = Storage.prototype.setItem;
    let failed = false;
    const restoreCandidates: Trade[][] = [];
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, storageKey, value) {
      if (storageKey === key("trades")) {
        const candidate = JSON.parse(value) as Trade[];
        if (candidate.some((item) => item.deletedAt === null)) restoreCandidates.push(candidate);
      }
      if (storageKey === key("trade-ledger-reset-snapshots") && value === "[]" && !failed) {
        failed = true;
        throw new Error("disk full");
      }
      return originalSetItem.call(this, storageKey, value);
    });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "마지막 매매 기록 삭제 되돌리기" }));
    fireEvent.click(screen.getByRole("button", { name: "기록 복원" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("매매 기록을 복원하지 못했습니다. 현재 데이터는 변경되지 않았습니다.");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(key("trades")) ?? "[]")).toEqual([deleted]);
    expect(JSON.parse(localStorage.getItem(key("trade-ledger-reset-snapshots")) ?? "[]")).toEqual([snapshot]);
    expect(getPersistenceSnapshot()).toMatchObject({ error: null, canRetry: false, pendingWrites: 0 });
    expect(screen.queryByRole("button", { name: "재시도" })).not.toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "기록 복원" });
    await waitFor(() => expect(retry).toBeEnabled());

    await new Promise((resolve) => window.setTimeout(resolve, 5));
    fireEvent.click(retry);

    expect(await screen.findByRole("status")).toHaveTextContent("매매 기록 1건을 복원했습니다.");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("현재 활성 원장 기록: 1건")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "마지막 매매 기록 삭제 되돌리기" })).not.toBeInTheDocument();
    expect(restoreCandidates).toHaveLength(2);
    expect(restoreCandidates[1][0].updatedAt).not.toBe(restoreCandidates[0][0].updatedAt);
    expect(JSON.parse(localStorage.getItem(key("trade-ledger-reset-snapshots")) ?? "null")).toEqual([]);
    expect(getPersistenceSnapshot()).toMatchObject({ error: null, canRetry: false, pendingWrites: 0 });
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

  it("blocks Reset and Undo without clearing an existing unrelated global failure", async () => {
    const deleted = { ...trade, deletedAt: resetAt, updatedAt: resetAt };
    const active = { ...trade, id: "t2", createdAt: "2026-08-22T00:00:00.000Z", updatedAt: "2026-08-22T00:00:00.000Z" };
    const snapshot = { id: "latest", version: 1, resetAt, tradeIds: [trade.id], createdAt: resetAt, updatedAt: resetAt };
    seed({ trades: [deleted, active], snapshots: [snapshot] });
    const originalSetItem = Storage.prototype.setItem;
    let failed = false;
    const storageSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, storageKey, value) {
      if (storageKey === key("notes") && !failed) {
        failed = true;
        throw new Error("unrelated notes failure");
      }
      return originalSetItem.call(this, storageKey, value);
    });
    await expect(saveCollection("notes", [{ id: "note-1" }])).rejects.toThrow("unrelated notes failure");
    storageSpy.mockRestore();
    const existingError = getPersistenceSnapshot().error;

    renderCard();

    expect(await screen.findByRole("button", { name: "매매 기록 전체 삭제" })).toBeDisabled();
    expect(await screen.findByRole("button", { name: "마지막 매매 기록 삭제 되돌리기" })).toBeDisabled();
    expect(screen.getByText("현재 저장 오류를 먼저 해결한 뒤 매매 원장을 초기화하거나 복원해 주세요.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "재시도" })).toBeEnabled();
    expect(getPersistenceSnapshot()).toMatchObject({ error: existingError, canRetry: true, pendingWrites: 0 });
  });

  it("disables Reset and Undo while an unrelated write is pending", async () => {
    const deleted = { ...trade, deletedAt: resetAt, updatedAt: resetAt };
    const active = { ...trade, id: "t2", createdAt: "2026-08-22T00:00:00.000Z", updatedAt: "2026-08-22T00:00:00.000Z" };
    const snapshot = { id: "latest", version: 1, resetAt, tradeIds: [trade.id], createdAt: resetAt, updatedAt: resetAt };
    seed({ trades: [deleted, active], snapshots: [snapshot] });
    renderCard();
    const reset = await screen.findByRole("button", { name: "매매 기록 전체 삭제" });
    const undo = await screen.findByRole("button", { name: "마지막 매매 기록 삭제 되돌리기" });
    expect(reset).toBeEnabled();
    expect(undo).toBeEnabled();

    let finishSave: (() => void) | undefined;
    tauriMocks.load.mockResolvedValue({ select: vi.fn(), execute: vi.fn() });
    tauriMocks.invoke.mockImplementation(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const pendingSave = saveCollection("notes", [{ id: "note-1" }]);

    await waitFor(() => expect(tauriMocks.invoke).toHaveBeenCalledOnce());
    await waitFor(() => expect(reset).toBeDisabled());
    expect(undo).toBeDisabled();
    expect(getPersistenceSnapshot().pendingWrites).toBe(1);

    finishSave?.();
    await act(async () => { await pendingSave; });
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    await waitFor(() => expect(reset).toBeEnabled());
    expect(undo).toBeEnabled();
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
