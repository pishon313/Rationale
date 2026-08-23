"use client";

import { AlertTriangle, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import {
  buildTradeLedgerReset,
  buildTradeLedgerResetUndo,
  persistTradeLedgerReset,
  summarizeTradeLedgerReset,
  tradeLedgerResetSnapshotCollection,
  TradeLedgerResetError,
  type TradeLedgerResetSnapshotV1,
} from "@/features/trades/trade-ledger-reset";
import { migrateTrades } from "@/features/trades/migrate-trades";
import type { Trade } from "@/features/trades/types";
import { useI18n } from "@/i18n/i18n-provider";
import { getCorruptionSnapshot, getPersistenceSnapshot, subscribeCorruption, subscribePersistence } from "@/lib/local-repository";
import { useLocalCollection } from "@/lib/use-local-collection";

export function TradeLedgerResetCard() {
  const { t, formatDate, formatNumber } = useI18n();
  const trades = useLocalCollection<Trade>("trades", []);
  const stocks = useLocalCollection<Stock>("stocks", []);
  const accounts = useLocalCollection<InvestmentAccount>("accounts", []);
  const snapshots = useLocalCollection<TradeLedgerResetSnapshotV1>(tradeLedgerResetSnapshotCollection, []);
  const persistence = useSyncExternalStore(subscribePersistence, getPersistenceSnapshot, getPersistenceSnapshot);
  const corruption = useSyncExternalStore(subscribeCorruption, getCorruptionSnapshot, getCorruptionSnapshot);
  const [resetOpen, setResetOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const resetTrigger = useRef<HTMLButtonElement>(null);
  const undoTrigger = useRef<HTMLButtonElement>(null);
  const cardTitle = useRef<HTMLHeadingElement>(null);

  const migration = useMemo(() => migrateTrades(stocks.allItems, trades.allItems), [stocks.allItems, trades.allItems]);
  const impact = useMemo(() => summarizeTradeLedgerReset(migration.trades), [migration.trades]);
  const snapshot = snapshots.allItems[0] ?? null;
  const ready = trades.ready && stocks.ready && accounts.ready && snapshots.ready;
  const relevantCollections = new Set(["trades", "stocks", tradeLedgerResetSnapshotCollection]);
  const hasCorruption = corruption.collections.some((item) => relevantCollections.has(item.collection));
  const pending = persistence.pendingWrites > 0;
  const legacyBlocked = migration.unresolvedStockIds.length > 0;
  const canReset = ready && !pending && !saving && !hasCorruption && !legacyBlocked && impact.totalRecords > 0;
  const canUndo = ready && !pending && !saving && !hasCorruption && Boolean(snapshot);

  function restoreFocus(target: React.RefObject<HTMLButtonElement | null>) {
    window.setTimeout(() => {
      if (target.current && !target.current.disabled) target.current.focus();
      else cardTitle.current?.focus();
    }, 0);
  }

  function closeReset() {
    if (saving) return;
    setResetOpen(false);
    setConfirmed(false);
    restoreFocus(resetTrigger);
  }

  function closeUndo() {
    if (saving) return;
    setUndoOpen(false);
    restoreFocus(undoTrigger);
  }

  async function resetLedger() {
    if (!confirmed || !canReset) return;
    setSaving(true);
    setMessage(null);
    try {
      const plan = buildTradeLedgerReset({ trades: trades.allItems, stocks: stocks.allItems, accounts: accounts.allItems });
      if (!plan.snapshot) {
        setResetOpen(false);
        setConfirmed(false);
        setMessage({ kind: "error", text: t("삭제할 활성 매매 기록이 없습니다.") });
        restoreFocus(resetTrigger);
        return;
      }
      await persistTradeLedgerReset(plan);
      trades.applyCommitted(plan.nextTrades);
      if (plan.stocksChanged) stocks.applyCommitted(plan.nextStocks);
      snapshots.applyCommitted([plan.snapshot]);
      setResetOpen(false);
      setConfirmed(false);
      setMessage({ kind: "success", text: t("매매 기록 {count}건을 삭제하고 원장을 초기화했습니다.", { count: formatNumber(plan.impact.totalRecords) }) });
      restoreFocus(resetTrigger);
    } catch (error) {
      setMessage({ kind: "error", text: resetErrorMessage(error, t) });
    } finally {
      setSaving(false);
    }
  }

  async function undoReset() {
    if (!snapshot || !canUndo) return;
    setSaving(true);
    setMessage(null);
    try {
      const plan = buildTradeLedgerResetUndo({ currentTrades: trades.allItems, accounts: accounts.allItems, snapshot });
      await persistTradeLedgerReset(plan);
      trades.applyCommitted(plan.nextTrades);
      snapshots.applyCommitted([]);
      setUndoOpen(false);
      setMessage({ kind: "success", text: t("매매 기록 {count}건을 복원했습니다.", { count: formatNumber(plan.restoredCount) }) });
      restoreFocus(undoTrigger);
    } catch (error) {
      setMessage({ kind: "error", text: undoErrorMessage(error, t) });
    } finally {
      setSaving(false);
    }
  }

  return <>
    <section className="rounded-xl border border-red-200 bg-[var(--surface)] p-5 lg:col-span-2 dark:border-red-950" aria-labelledby="trade-ledger-reset-title">
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-red-700 dark:text-red-300">{t("데이터 관리 · 위험 영역")}</p>
          <h2 id="trade-ledger-reset-title" ref={cardTitle} tabIndex={-1} className="mt-1 font-semibold outline-none">{t("매매 원장 초기화")}</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("모든 매매·배당·입출금·잔액 조정·계좌 이체 기록을 원장 계산에서 제거합니다.")}</p>
          <p className="mt-3 text-sm font-medium">{t("현재 활성 원장 기록: {count}건", { count: formatNumber(impact.totalRecords) })}</p>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("삭제된 기록은 원장 계산과 화면에서 제외됩니다. 동기화와 복구를 위해 삭제 기록 자체는 보존됩니다.")}</p>
          {legacyBlocked && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">{t("기존 보유 수량과 매매 원장이 일치하지 않는 종목이 있습니다. 매매 원장에서 해당 기록을 먼저 확인한 뒤 다시 시도해 주세요.")}</p>}
          {hasCorruption && <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">{t("손상된 데이터의 복구 방법을 선택하기 전에는 매매 원장을 초기화할 수 없습니다.")}</p>}
          {message && !resetOpen && !undoOpen && <MessageBanner message={message} />}
          <div className="mt-4 flex flex-wrap gap-2">
            <button ref={resetTrigger} type="button" disabled={!canReset} onClick={() => { setMessage(null); setConfirmed(false); setResetOpen(true); }} className="flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"><Trash2 size={16} aria-hidden="true" />{t("매매 기록 전체 삭제")}</button>
          </div>
          {snapshot && <div className="mt-5 rounded-lg border bg-[var(--surface-muted)] p-4">
            <p className="text-sm font-medium">{t("마지막 삭제: {date}", { date: formatDate(snapshot.resetAt, { dateStyle: "medium", timeStyle: "short" }) })}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("대상 기록: {count}건", { count: formatNumber(snapshot.tradeIds.length) })}</p>
            <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("되돌리기는 이 Mac에 저장된 최근 1회의 전체 삭제에만 사용할 수 있습니다.")}</p>
            <button ref={undoTrigger} type="button" disabled={!canUndo} onClick={() => { setMessage(null); setUndoOpen(true); }} className="mt-3 flex items-center gap-2 rounded-lg border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"><RotateCcw size={16} aria-hidden="true" />{t("마지막 매매 기록 삭제 되돌리기")}</button>
          </div>}
        </div>
      </div>
    </section>

    {resetOpen && <div className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-4" role="alertdialog" aria-modal="true" aria-labelledby="trade-reset-dialog-title" aria-describedby="trade-reset-dialog-description" aria-busy={saving} onKeyDown={(event) => { if (event.key === "Escape" && !saving) { event.preventDefault(); closeReset(); } }}>
      <section className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-[var(--surface)] p-5 shadow-2xl">
        <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-red-600" size={21} aria-hidden="true" /><div><h2 id="trade-reset-dialog-title" className="text-lg font-semibold">{t("매매 기록 {count}건을 모두 삭제할까요?", { count: formatNumber(impact.totalRecords) })}</h2><p id="trade-reset-dialog-description" className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("이 작업은 활성 매매 원장 전체에 적용되며, 이 Mac에서 최근 1회만 되돌릴 수 있습니다.")}</p></div></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <ScopeList title={t("원장 계산에서 제외")} values={["매수·매도", "배당", "입금·출금", "잔액 조정", "계좌 간 이체", "기초 포지션"].map((key) => t(key))} />
          <ScopeList title={t("그대로 보존")} values={["종목", "계좌", "매수 계획", "관찰 기록", "회고", "Note와 투자 원칙"].map((key) => t(key))} />
        </div>
        <div className="mt-4 rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">
          <p>{t("보유 수량, 평균단가, 현금잔액, 실현손익이 다시 계산되어 0 또는 빈 상태가 됩니다.")}</p>
          <p className="mt-2">{t("계획과 회고는 삭제된 매매 기록을 참조하더라도 변경되지 않습니다.")}</p>
          <p className="mt-2">{t("동기화와 복구를 위해 삭제 기록은 보존됩니다. 같은 파일을 다시 가져오면 삭제된 기록으로 감지되어 복원 대상으로 표시될 수 있습니다.")}</p>
        </div>
        <p className="mt-4 text-xs text-[var(--muted)]">{t("매매 {security}건 · 배당 {dividend}건 · 현금흐름 {cash}건 · 이체 {transfer}쌍 · 기초 포지션 {opening}건 · 가져온 기록 {imported}건", { security: formatNumber(impact.securityRecords), dividend: formatNumber(impact.dividendRecords), cash: formatNumber(impact.cashFlowRecords), transfer: formatNumber(impact.transferPairs), opening: formatNumber(impact.openingPositions), imported: formatNumber(impact.importedRecords) })}</p>
        {message?.kind === "error" && <MessageBanner message={message} />}
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm"><input autoFocus type="checkbox" checked={confirmed} disabled={saving} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 size-4" /><span>{t("삭제 범위와 영향을 확인했습니다.")}</span></label>
        <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={closeReset} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">{t("취소")}</button><button type="button" disabled={!confirmed || saving} onClick={() => void resetLedger()} className="rounded-lg bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? t("삭제 중...") : t("매매 기록 {count}건 삭제", { count: formatNumber(impact.totalRecords) })}</button></div>
      </section>
    </div>}

    {undoOpen && snapshot && <div className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-4" role="alertdialog" aria-modal="true" aria-labelledby="trade-reset-undo-title" aria-describedby="trade-reset-undo-description" aria-busy={saving} onKeyDown={(event) => { if (event.key === "Escape" && !saving) { event.preventDefault(); closeUndo(); } }}>
      <section className="w-full max-w-md rounded-xl bg-[var(--surface)] p-5 shadow-2xl">
        <h2 id="trade-reset-undo-title" className="text-lg font-semibold">{t("마지막 매매 기록 삭제를 되돌릴까요?")}</h2>
        <p id="trade-reset-undo-description" className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("최근 전체 삭제의 대상 기록 {count}건을 복원합니다.", { count: formatNumber(snapshot.tradeIds.length) })}</p>
        {impact.totalRecords > 0 && <p className="mt-3 rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">{t("삭제 후 추가한 기록은 유지하고 이전 기록을 복원합니다.")}</p>}
        {message?.kind === "error" && <MessageBanner message={message} />}
        <div className="mt-5 flex justify-end gap-2"><button autoFocus type="button" disabled={saving} onClick={closeUndo} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">{t("취소")}</button><button type="button" disabled={saving} onClick={() => void undoReset()} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"><RotateCcw size={15} aria-hidden="true" />{saving ? t("복원 중...") : t("기록 복원")}</button></div>
      </section>
    </div>}
  </>;
}

function ScopeList({ title, values }: { title: string; values: string[] }) {
  return <div className="rounded-lg border p-3"><h3 className="text-sm font-semibold">{title}</h3><ul className="mt-2 space-y-1 text-xs leading-5 text-[var(--muted)]">{values.map((value) => <li key={value}>• {value}</li>)}</ul></div>;
}

function MessageBanner({ message }: { message: { kind: "success" | "error"; text: string } }) {
  return <p role={message.kind === "error" ? "alert" : "status"} aria-live={message.kind === "error" ? "assertive" : "polite"} className={`mt-3 rounded-lg p-3 text-sm ${message.kind === "error" ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-200" : "bg-[var(--accent-soft)] text-[var(--accent)]"}`}>{message.text}</p>;
}

function resetErrorMessage(error: unknown, t: (key: string) => string) {
  if (error instanceof TradeLedgerResetError && error.code === "UNRESOLVED_LEGACY_STATE") return t("기존 보유 수량과 매매 원장이 일치하지 않는 종목이 있습니다. 매매 원장에서 해당 기록을 먼저 확인한 뒤 다시 시도해 주세요.");
  return t("매매 기록을 삭제하지 못했습니다. 기존 데이터는 변경되지 않았습니다.");
}

function undoErrorMessage(error: unknown, t: (key: string) => string) {
  if (error instanceof TradeLedgerResetError && (error.code === "STALE_SNAPSHOT" || error.code === "UNDO_LEDGER_INVALID" || error.code === "INVALID_CANDIDATE")) return t("삭제 후 일부 기록이 변경되어 자동으로 되돌릴 수 없습니다. 백업을 사용하거나 현재 기록을 먼저 확인해 주세요.");
  return t("매매 기록을 복원하지 못했습니다. 현재 데이터는 변경되지 않았습니다.");
}
