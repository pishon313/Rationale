"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { comparePortfolioPlan } from "@/domain/portfolio-plan";
import { formatCurrency } from "@/domain/money";
import { RegisteredStockPicker } from "@/features/stocks/registered-stock-picker";
import { useStockStore } from "@/features/stocks/use-stock-store";
import type { Stock } from "@/features/stocks/types";
import { useI18n } from "@/i18n/i18n-provider";
import { useExchangeRates } from "@/lib/use-exchange-rates";
import { useLocalCollection } from "@/lib/use-local-collection";
import { buildPortfolioPlanActivation, persistPortfolioPlanActivation } from "./portfolio-plan-mutation";
import type { PortfolioAllocationDraft, PortfolioAllocationTarget, PortfolioPlanRevision, PortfolioPlanState } from "./types";

export function PortfolioPageClient() {
  const { t, localeTag, formatNumber } = useI18n();
  const stockStore = useStockStore();
  const exchangeRates = useExchangeRates();
  const stateStore = useLocalCollection<PortfolioPlanState>("portfolio-plan-state", []);
  const revisionStore = useLocalCollection<PortfolioPlanRevision>("portfolio-plan-revisions", []);
  const targetStore = useLocalCollection<PortfolioAllocationTarget>("portfolio-allocation-targets", []);
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState("");
  const activeId = stateStore.allItems[0]?.activeRevisionId ?? null;
  const activeRevision = revisionStore.allItems.find((revision) => revision.id === activeId) ?? null;
  const activeTargets = targetStore.allItems.filter((target) => target.revisionId === activeId);
  const ready = stockStore.ready && exchangeRates.ready && stateStore.ready && revisionStore.ready && targetStore.ready;
  const comparison = useMemo(() => comparePortfolioPlan({ revision: activeRevision, targets: activeTargets, ledger: stockStore.ledger, stocks: stockStore.allStocks, ratesToKrw: exchangeRates.snapshot.ratesToKrw }), [activeRevision, activeTargets, exchangeRates.snapshot.ratesToKrw, stockStore.allStocks, stockStore.ledger]);

  async function savePlan(draftTargets: PortfolioAllocationDraft[], thesis: string, changeNote: string) {
    setSaveError("");
    try {
      const activation = buildPortfolioPlanActivation({ states: stateStore.allItems, revisions: revisionStore.allItems, targets: targetStore.allItems, stocks: stockStore.allStocks, draftTargets, thesis, changeNote });
      await persistPortfolioPlanActivation(activation);
      revisionStore.applyCommitted(activation.revisions);
      targetStore.applyCommitted(activation.targets);
      stateStore.applyCommitted(activation.states);
      setEditing(false);
    } catch {
      setSaveError(t("포트폴리오 계획을 저장하지 못했습니다. 다시 시도해 주세요."));
    }
  }

  if (!ready) return <p className="py-20 text-center text-sm text-[var(--muted)]">{t("포트폴리오 계획을 불러오는 중입니다.")}</p>;
  return <>
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-[var(--muted)]">{t("의도한 배분과 실제 보유를 비교")}</p><h1 className="mt-1 text-2xl font-semibold">{t("포트폴리오")}</h1></div>{activeRevision && !editing && <button type="button" onClick={() => setEditing(true)} className="rounded-lg border px-4 py-2 text-sm">{t("현재 계획 수정")}</button>}</div>
    {!activeRevision && !editing ? <section className="mt-6 grid min-h-72 place-items-center rounded-xl border bg-[var(--surface)] p-6 text-center"><div><h2 className="text-xl font-semibold">{t("나의 계획")}</h2><p className="mt-2 text-sm text-[var(--muted)]">{t("포트폴리오의 목표 배분을 설정해 보세요.")}</p><button type="button" onClick={() => setEditing(true)} className="mt-5 rounded-lg bg-[var(--accent)] px-5 py-2.5 text-sm text-white">{t("계획 만들기")}</button></div></section> : null}
    {editing && <PortfolioPlanEditor stocks={stockStore.allStocks} revision={activeRevision} targets={activeTargets} onCancel={() => { setEditing(false); setSaveError(""); }} onSave={savePlan} saveError={saveError} />}
    {activeRevision && !editing && <ActivePlan revision={activeRevision} stocks={stockStore.allStocks} comparison={comparison} formatNumber={formatNumber} formatMoney={(value) => formatCurrency(value, "KRW", localeTag)} />}
  </>;
}

export function PortfolioPlanEditor({ stocks, revision, targets, onCancel, onSave, saveError = "" }: { stocks: Stock[]; revision: PortfolioPlanRevision | null; targets: PortfolioAllocationTarget[]; onCancel: () => void; onSave: (targets: PortfolioAllocationDraft[], thesis: string, changeNote: string) => void | Promise<void>; saveError?: string }) {
  const { t, formatNumber } = useI18n();
  const initialTargets = targets.slice().sort((left, right) => left.sortOrder - right.sortOrder).map(({ targetType, stockId, targetWeightBps, sortOrder }) => ({ targetType, stockId, targetWeightBps, sortOrder } as PortfolioAllocationDraft));
  const [drafts, setDrafts] = useState<PortfolioAllocationDraft[]>(initialTargets);
  const [thesis, setThesis] = useState(revision?.thesis ?? "");
  const [changeNote, setChangeNote] = useState("");
  const [duplicateError, setDuplicateError] = useState("");
  const [saving, setSaving] = useState(false);
  const activeStocks = stocks.filter((stock) => !stock.deletedAt);
  const stockById = new Map(stocks.map((stock) => [stock.id, stock]));
  const totalBps = drafts.reduce((sum, target) => sum + target.targetWeightBps, 0);
  function addStock(stockId: string | null) {
    if (!stockId) return;
    if (drafts.some((target) => target.targetType === "stock" && target.stockId === stockId)) { setDuplicateError(t("같은 종목은 한 번만 추가할 수 있습니다.")); return; }
    setDrafts((current) => [...current, { targetType: "stock", stockId, targetWeightBps: 0, sortOrder: current.length }]); setDuplicateError("");
  }
  function addCash() {
    if (drafts.some((target) => target.targetType === "cash")) { setDuplicateError(t("현금 목표는 한 번만 추가할 수 있습니다.")); return; }
    setDrafts((current) => [...current, { targetType: "cash", stockId: null, targetWeightBps: 0, sortOrder: current.length }]); setDuplicateError("");
  }
  function updateWeight(index: number, value: string) {
    const weight = Math.max(0, Math.min(10000, Math.round((Number(value) || 0) * 100)));
    setDrafts((current) => current.map((target, targetIndex) => targetIndex === index ? { ...target, targetWeightBps: weight } : target));
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (saving || totalBps !== 10000 || !drafts.length) return;
    setSaving(true); try { await onSave(drafts.map((target, index) => ({ ...target, sortOrder: index })), thesis, changeNote); } finally { setSaving(false); }
  }
  return <form onSubmit={submit} className="mt-6 rounded-xl border bg-[var(--surface)] p-5"><div><h2 className="text-lg font-semibold">{t(revision ? "나의 계획 수정" : "나의 계획 만들기")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("저장하면 현재 계획을 덮어쓰지 않고 새 리비전으로 활성화합니다.")}</p></div>
    <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"><RegisteredStockPicker stocks={activeStocks} value={null} onChange={addStock} label={t("등록 종목 추가")} /><button type="button" onClick={addCash} className="self-end rounded-lg border px-4 py-2 text-sm"><Plus size={15} className="mr-1 inline" />{t("현금 추가")}</button></div>
    {duplicateError && <p role="alert" className="mt-2 text-sm text-red-600">{duplicateError}</p>}
    <div className="mt-5 space-y-2">{drafts.map((target, index) => { const name = target.targetType === "cash" ? t("현금") : stockById.get(target.stockId)?.name ?? t("알 수 없는 종목"); return <div key={`${target.targetType}:${target.stockId ?? "cash"}`} className="grid items-center gap-3 rounded-lg bg-[var(--surface-muted)] p-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto]"><div><b className="text-sm">{name}</b>{target.targetType === "stock" && <small className="ml-2 text-[var(--muted)]">{stockById.get(target.stockId)?.ticker}</small>}</div><label className="text-xs text-[var(--muted)]"><span className="sr-only">{t("{name} 목표 비중", { name })}</span><span className="flex items-center gap-1"><input aria-label={t("{name} 목표 비중", { name })} type="number" min="0" max="100" step="0.01" value={target.targetWeightBps / 100} onChange={(event) => updateWeight(index, event.target.value)} className="h-9 w-full rounded-md border bg-[var(--surface)] px-2 text-right text-sm" />%</span></label><button type="button" aria-label={t("{name} 목표 삭제", { name })} onClick={() => setDrafts((current) => current.filter((_, targetIndex) => targetIndex !== index))} className="destructive-icon-action grid size-9 place-items-center rounded-md"><Trash2 size={15} /></button></div>; })}{!drafts.length && <p className="rounded-lg bg-[var(--surface-muted)] p-5 text-center text-sm text-[var(--muted)]">{t("등록 종목이나 현금을 추가해 주세요.")}</p>}</div>
    <div className={`mt-4 rounded-lg p-3 text-sm ${totalBps === 10000 ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" : "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"}`}><span>{t("총 목표 비중")}</span><b className="ml-2">{formatNumber(totalBps / 100, { maximumFractionDigits: 2 })}%</b>{totalBps !== 10000 && <span className="ml-2">· {t("합계가 정확히 100%여야 합니다.")}</span>}</div>
    <label className="mt-5 block text-sm font-medium">{t("투자 근거 (선택)")}<textarea value={thesis} onChange={(event) => setThesis(event.target.value)} className="mt-1 min-h-24 w-full rounded-lg border bg-[var(--surface)] p-3 text-sm" /></label>{revision && <label className="mt-4 block text-sm font-medium">{t("변경 이유 (선택)")}<textarea value={changeNote} onChange={(event) => setChangeNote(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border bg-[var(--surface)] p-3 text-sm" /></label>}
    {(saveError) && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">{saveError}</p>}
    <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button disabled={saving || totalBps !== 10000 || !drafts.length} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm text-white disabled:opacity-50">{t(saving ? "저장 중..." : "저장하고 활성화")}</button></div>
  </form>;
}

function ActivePlan({ revision, stocks, comparison, formatNumber, formatMoney }: { revision: PortfolioPlanRevision; stocks: Stock[]; comparison: ReturnType<typeof comparePortfolioPlan>; formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string; formatMoney: (value: number) => string }) {
  const { t, formatDate } = useI18n(); const stockById = new Map(stocks.map((stock) => [stock.id, stock]));
  return <div className="mt-6 space-y-4"><section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-semibold">{t("나의 계획")}</h2><p className="mt-1 text-xs text-[var(--muted)]">{t("리비전 {number} · {date}", { number: formatNumber(revision.revisionNumber), date: formatDate(revision.activatedAt ?? revision.createdAt, { dateStyle: "medium" }) })}</p></div><span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs text-[var(--accent)]">{t("현재 활성 계획")}</span></div>{revision.thesis && <p className="mt-4 whitespace-pre-wrap text-sm leading-6">{revision.thesis}</p>}</section>
    {!comparison.valuationAvailable && <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><b>{t("현재 배분을 계산할 수 없습니다.")}</b><p className="mt-1">{t(unavailableMessage(comparison.unavailableReason))}</p></section>}
    <section className="overflow-hidden rounded-xl border bg-[var(--surface)]"><div className="border-b p-5"><h2 className="font-semibold">{t("목표와 현재")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("현재 보유와 현금을 모두 포함해 사용자가 정한 목표와 비교합니다.")}</p></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-[var(--surface-muted)] text-xs text-[var(--muted)]"><tr>{["대상", "목표", "현재", "차이", "현재 금액", "목표 금액", "상태"].map((label) => <th key={label} className="whitespace-nowrap px-4 py-3 font-medium">{t(label)}</th>)}</tr></thead><tbody>{comparison.allocations.map((row) => { const name = row.targetType === "cash" ? t("현금") : stockById.get(row.stockId ?? "")?.name ?? t("알 수 없는 종목"); return <tr key={`${row.targetType}:${row.stockId ?? "cash"}`} className="border-t"><td className="px-4 py-4"><b>{name}</b>{row.targetType === "stock" && <small className="ml-2 text-[var(--muted)]">{stockById.get(row.stockId ?? "")?.ticker}</small>}</td><td className="px-4 tabular-nums">{formatNumber(row.targetWeightBps / 100, { maximumFractionDigits: 2 })}%</td><td className="px-4 tabular-nums">{row.currentWeight === null ? "—" : `${formatNumber(row.currentWeight, { maximumFractionDigits: 2 })}%`}</td><td className="px-4 tabular-nums">{row.driftPercentagePoints === null ? "—" : `${row.driftPercentagePoints > 0 ? "+" : ""}${formatNumber(row.driftPercentagePoints, { maximumFractionDigits: 2 })}%p`}</td><td className="px-4 tabular-nums">{row.currentValueKrw === null ? "—" : formatMoney(row.currentValueKrw)}</td><td className="px-4 tabular-nums">{row.targetValueKrw === null ? "—" : formatMoney(row.targetValueKrw)}</td><td className="px-4">{t(row.status === "outsidePlan" ? "현재 계획 밖 보유" : row.status === "unavailable" ? "계산 불가" : "계획에 포함")}</td></tr>; })}</tbody></table></div></section>
    <section className="rounded-xl border bg-[var(--surface)] p-4 text-xs leading-5 text-[var(--muted)]">{t("이 화면은 사용자가 작성한 목표와 현재 상태의 차이를 설명하며 매수·매도 또는 리밸런싱을 권고하지 않습니다.")}</section>
  </div>;
}

function unavailableMessage(reason: ReturnType<typeof comparePortfolioPlan>["unavailableReason"]) {
  if (reason === "ledgerError") return "매매 원장 오류가 있어 현재 포트폴리오를 확정할 수 없습니다.";
  if (reason === "missingPrice") return "하나 이상의 보유 종목에 유효한 현재가가 없습니다.";
  if (reason === "invalidFx") return "필요한 환율이 없거나 올바르지 않습니다.";
  if (reason === "unreconciledCash") return "조정되지 않은 현금 기록이 있어 전체 배분을 확정할 수 없습니다.";
  if (reason === "missingStock") return "보유 포지션에 연결된 종목을 찾을 수 없습니다.";
  return "현재 포트폴리오 값을 안전하게 계산할 수 없습니다.";
}
