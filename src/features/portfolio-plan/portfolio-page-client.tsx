"use client";

import { useMemo, useState } from "react";
import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import type { RatesToKrw } from "@/domain/currency";
import { formatCurrency } from "@/domain/money";
import { comparePortfolioPlan } from "@/domain/portfolio-plan";
import type { TradingLedger } from "@/domain/trading-ledger";
import { RegisteredStockPicker } from "@/features/stocks/registered-stock-picker";
import type { Stock } from "@/features/stocks/types";
import { useStockStore } from "@/features/stocks/use-stock-store";
import { useI18n } from "@/i18n/i18n-provider";
import { useExchangeRates } from "@/lib/use-exchange-rates";
import { useLocalCollection } from "@/lib/use-local-collection";
import { buildPortfolioPlanActivation, persistPortfolioPlanActivation } from "./portfolio-plan-mutation";
import type { PortfolioAllocationDraft, PortfolioAllocationTarget, PortfolioPlanRevision, PortfolioPlanState } from "./types";

const draftRevision: PortfolioPlanRevision = {
  id: "portfolio-draft",
  revisionNumber: 1,
  basedOnRevisionId: null,
  targetAmountKrw: null,
  thesis: "",
  changeNote: "",
  createdAt: "2000-01-01T00:00:00.000Z",
  activatedAt: "2000-01-01T00:00:00.000Z",
  updatedAt: "2000-01-01T00:00:00.000Z",
};

export function PortfolioPageClient() {
  const { t, localeTag, formatNumber } = useI18n();
  const stockStore = useStockStore();
  const exchangeRates = useExchangeRates();
  const stateStore = useLocalCollection<PortfolioPlanState>("portfolio-plan-state", []);
  const revisionStore = useLocalCollection<PortfolioPlanRevision>("portfolio-plan-revisions", []);
  const targetStore = useLocalCollection<PortfolioAllocationTarget>("portfolio-allocation-targets", []);
  const [saveError, setSaveError] = useState("");
  const activeId = stateStore.allItems[0]?.activeRevisionId ?? null;
  const activeRevision = revisionStore.allItems.find((revision) => revision.id === activeId) ?? null;
  const activeTargets = targetStore.allItems.filter((target) => target.revisionId === activeId);
  const ready = stockStore.ready && exchangeRates.ready && stateStore.ready && revisionStore.ready && targetStore.ready;
  const comparison = useMemo(() => comparePortfolioPlan({
    revision: activeRevision ?? draftRevision,
    targets: activeTargets,
    ledger: stockStore.ledger,
    stocks: stockStore.allStocks,
    ratesToKrw: exchangeRates.snapshot.ratesToKrw,
  }), [activeRevision, activeTargets, exchangeRates.snapshot.ratesToKrw, stockStore.allStocks, stockStore.ledger]);

  async function savePlan(draftTargets: PortfolioAllocationDraft[], targetAmountKrw: number, thesis: string, changeNote: string) {
    setSaveError("");
    try {
      const activation = buildPortfolioPlanActivation({
        states: stateStore.allItems,
        revisions: revisionStore.allItems,
        targets: targetStore.allItems,
        stocks: stockStore.allStocks,
        draftTargets,
        targetAmountKrw,
        thesis,
        changeNote,
      });
      await persistPortfolioPlanActivation(activation);
      revisionStore.applyCommitted(activation.revisions);
      targetStore.applyCommitted(activation.targets);
      stateStore.applyCommitted(activation.states);
    } catch {
      setSaveError(t("포트폴리오 계획을 저장하지 못했습니다. 다시 시도해 주세요."));
    }
  }

  if (!ready) return <p className="py-20 text-center text-sm text-[var(--muted)]">{t("포트폴리오 계획을 불러오는 중입니다.")}</p>;

  return <>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm text-[var(--muted)]">{t("의도한 배분과 실제 보유를 비교")}</p>
        <h1 className="mt-1 text-2xl font-semibold">{t("포트폴리오")}</h1>
      </div>
      {activeRevision && <div className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-xs text-[var(--accent)]">{t("리비전 {number} · 현재 활성", { number: formatNumber(activeRevision.revisionNumber) })}</div>}
    </div>
    <PortfolioPlanWorkspace
      key={activeRevision?.id ?? "new-plan"}
      stocks={stockStore.allStocks}
      ledger={stockStore.ledger}
      ratesToKrw={exchangeRates.snapshot.ratesToKrw}
      revision={activeRevision}
      targets={activeTargets}
      currentComparison={comparison}
      onSave={savePlan}
      saveError={saveError}
      localeTag={localeTag}
    />
  </>;
}

function PortfolioPlanWorkspace({ stocks, ledger, ratesToKrw, revision, targets, currentComparison, onSave, saveError, localeTag }: {
  stocks: Stock[];
  ledger: TradingLedger;
  ratesToKrw: RatesToKrw;
  revision: PortfolioPlanRevision | null;
  targets: PortfolioAllocationTarget[];
  currentComparison: ReturnType<typeof comparePortfolioPlan>;
  onSave: (targets: PortfolioAllocationDraft[], targetAmountKrw: number, thesis: string, changeNote: string) => void | Promise<void>;
  saveError: string;
  localeTag: string;
}) {
  const { t, formatNumber } = useI18n();
  const initialDrafts = targets.slice().sort((left, right) => left.sortOrder - right.sortOrder).map(({ targetType, stockId, targetWeightBps, sortOrder }) => ({ targetType, stockId, targetWeightBps, sortOrder } as PortfolioAllocationDraft));
  const initialTargetAmount = revision?.targetAmountKrw ?? (currentComparison.totalCurrentValueKrw === null ? 0 : Math.max(0, Math.round(currentComparison.totalCurrentValueKrw)));
  const [drafts, setDrafts] = useState<PortfolioAllocationDraft[]>(initialDrafts);
  const [targetAmountInput, setTargetAmountInput] = useState(String(initialTargetAmount));
  const [thesis, setThesis] = useState(revision?.thesis ?? "");
  const [changeNote, setChangeNote] = useState("");
  const [duplicateError, setDuplicateError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const activeStocks = stocks.filter((stock) => !stock.deletedAt);
  const stockById = new Map(stocks.map((stock) => [stock.id, stock]));
  const targetAmountValid = validTargetAmount(targetAmountInput);
  const targetAmountKrw = normalizeTargetAmount(targetAmountInput);
  const totalBps = drafts.reduce((sum, target) => sum + target.targetWeightBps, 0);
  const draftTargets = useMemo<PortfolioAllocationTarget[]>(() => drafts.map((target, index) => ({ ...target, id: `portfolio-draft-target-${index}`, revisionId: draftRevision.id, sortOrder: index, updatedAt: draftRevision.updatedAt })), [drafts]);
  const liveComparison = useMemo(() => comparePortfolioPlan({ revision: { ...draftRevision, targetAmountKrw }, targets: draftTargets, ledger, stocks, ratesToKrw }), [draftTargets, ledger, ratesToKrw, stocks, targetAmountKrw]);
  const allocatedAmountKrw = targetAmountKrw * totalBps / 10000;
  const canSave = dirty && targetAmountValid && drafts.length > 0 && totalBps === 10000;

  function markDirty() { setDirty(true); setDuplicateError(""); }

  function addStock(stockId: string | null) {
    if (!stockId) return;
    if (drafts.some((target) => target.targetType === "stock" && target.stockId === stockId)) { setDuplicateError(t("같은 종목은 한 번만 추가할 수 있습니다.")); return; }
    setDrafts((current) => [...current, { targetType: "stock", stockId, targetWeightBps: 0, sortOrder: current.length }]);
    markDirty();
  }

  function addCash() {
    if (drafts.some((target) => target.targetType === "cash")) { setDuplicateError(t("현금 목표는 한 번만 추가할 수 있습니다.")); return; }
    setDrafts((current) => [...current, { targetType: "cash", stockId: null, targetWeightBps: 0, sortOrder: current.length }]);
    markDirty();
  }

  function updateWeight(targetType: "stock" | "cash", stockId: string | null, value: string) {
    const weight = Math.max(0, Math.min(10000, Math.round((Number(value) || 0) * 100)));
    setDrafts((current) => {
      const index = current.findIndex((target) => target.targetType === targetType && target.stockId === stockId);
      if (index >= 0) return current.map((target, targetIndex) => targetIndex === index ? { ...target, targetWeightBps: weight } : target);
      if (weight === 0) return current;
      return [...current, targetType === "cash" ? { targetType: "cash", stockId: null, targetWeightBps: weight, sortOrder: current.length } : { targetType: "stock", stockId: stockId as string, targetWeightBps: weight, sortOrder: current.length }];
    });
    markDirty();
  }

  function removeTarget(targetType: "stock" | "cash", stockId: string | null) {
    setDrafts((current) => current.filter((target) => !(target.targetType === targetType && target.stockId === stockId)));
    markDirty();
  }

  function reset() {
    setDrafts(initialDrafts); setTargetAmountInput(String(initialTargetAmount)); setThesis(revision?.thesis ?? ""); setChangeNote(""); setDuplicateError(""); setDirty(false);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !canSave) return;
    setSaving(true);
    try { await onSave(drafts.map((target, index) => ({ ...target, sortOrder: index })), targetAmountKrw, thesis, changeNote); } finally { setSaving(false); }
  }

  return <form onSubmit={submit} className="mt-6 space-y-4">
    <section className="rounded-xl border bg-[var(--surface)] p-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(20rem,1.2fr)_repeat(3,minmax(10rem,0.7fr))]">
        <label className="rounded-lg bg-[var(--surface-muted)] p-4">
          <span className="text-xs font-medium text-[var(--muted)]">{t("목표 운용 금액")}</span>
          <span className="mt-2 flex items-baseline gap-2">
            <input aria-label={t("목표 운용 금액")} aria-invalid={!targetAmountValid} type="number" min="0" step="10000" value={targetAmountInput} onChange={(event) => { setTargetAmountInput(event.target.value); markDirty(); }} className="min-w-0 flex-1 border-0 bg-transparent text-2xl font-semibold tabular-nums outline-none" />
            <span className="text-sm text-[var(--muted)]">KRW</span>
          </span>
          <span className="mt-1 block text-xs text-[var(--muted)]">{t("이 금액에 목표 비중을 적용해 종목별 목표 금액을 계산합니다.")}</span>
        </label>
        <Metric label={t("배분 예정 금액")} value={formatCurrency(allocatedAmountKrw, "KRW", localeTag)} />
        <Metric label={t("현재 포트폴리오")} value={liveComparison.totalCurrentValueKrw === null ? "—" : formatCurrency(liveComparison.totalCurrentValueKrw, "KRW", localeTag)} />
        <Metric label={t("총 목표 비중")} value={`${formatNumber(totalBps / 100, { maximumFractionDigits: 2 })}%`} tone={totalBps === 10000 ? "good" : "warn"} note={totalBps === 10000 ? t("저장할 수 있습니다.") : t("합계가 정확히 100%여야 합니다.")} />
      </div>
    </section>

    {!liveComparison.valuationAvailable && <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><b>{t("현재 배분을 계산할 수 없습니다.")}</b><p className="mt-1">{t(unavailableMessage(liveComparison.unavailableReason))}</p></section>}

    <section className="overflow-hidden rounded-xl border bg-[var(--surface)]">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b p-5">
        <div><h2 className="font-semibold">{t("목표 배분 워크시트")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("비중을 입력하면 목표 금액과 현재 대비 차이가 즉시 계산됩니다.")}</p></div>
        <div className="grid w-full gap-2 sm:grid-cols-[minmax(16rem,1fr)_auto] xl:w-auto"><RegisteredStockPicker stocks={activeStocks} value={null} onChange={addStock} ariaLabel={t("등록 종목 추가")} /><button type="button" onClick={addCash} className="rounded-lg border px-4 py-2 text-sm"><Plus size={15} className="mr-1 inline" />{t("현금 추가")}</button></div>
      </div>
      {duplicateError && <p role="alert" className="border-b bg-red-50 px-5 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">{duplicateError}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] text-left text-sm">
          <thead className="bg-[var(--surface-muted)] text-xs text-[var(--muted)]"><tr>{["대상", "내 분류", "목표 비중", "목표 금액", "현재 비중", "차이", "현재 금액", "상태", ""].map((label) => <th key={label || "action"} className="whitespace-nowrap px-4 py-3 font-medium">{label ? t(label) : <span className="sr-only">{t("작업")}</span>}</th>)}</tr></thead>
          <tbody>{liveComparison.allocations.map((row) => {
            const stock = row.targetType === "stock" ? stockById.get(row.stockId ?? "") : null;
            const name = row.targetType === "cash" ? t("현금") : stock?.name ?? t("알 수 없는 종목");
            const draft = drafts.find((target) => target.targetType === row.targetType && target.stockId === row.stockId);
            return <tr key={`${row.targetType}:${row.stockId ?? "cash"}`} className="border-t align-middle">
              <td className="px-4 py-3"><b>{name}</b>{stock && <small className="ml-2 text-[var(--muted)]">{stock.ticker}</small>}</td>
              <td className="px-4 py-3 text-[var(--muted)]">{row.targetType === "cash" ? t("유동성") : stock?.sector || "—"}</td>
              <td className="px-4 py-3"><label className="flex w-28 items-center gap-1"><span className="sr-only">{t("{name} 목표 비중", { name })}</span><input aria-label={t("{name} 목표 비중", { name })} type="number" min="0" max="100" step="0.01" value={(draft?.targetWeightBps ?? 0) / 100} onChange={(event) => updateWeight(row.targetType, row.stockId, event.target.value)} className="h-9 w-full rounded-md border bg-[var(--surface)] px-2 text-right tabular-nums" /><span className="text-[var(--muted)]">%</span></label></td>
              <td className="px-4 py-3 text-right font-medium tabular-nums">{row.targetValueKrw === null ? "—" : formatCurrency(row.targetValueKrw, "KRW", localeTag)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.currentWeight === null ? "—" : `${formatNumber(row.currentWeight, { maximumFractionDigits: 2 })}%`}</td>
              <td className={`px-4 py-3 text-right tabular-nums ${driftTone(row.driftPercentagePoints)}`}>{row.driftPercentagePoints === null ? "—" : `${row.driftPercentagePoints > 0 ? "+" : ""}${formatNumber(row.driftPercentagePoints, { maximumFractionDigits: 2 })}%p`}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.currentValueKrw === null ? "—" : formatCurrency(row.currentValueKrw, "KRW", localeTag)}</td>
              <td className="px-4 py-3"><Status status={row.status} /></td>
              <td className="px-4 py-3">{draft && <button type="button" aria-label={t("{name} 목표 삭제", { name })} onClick={() => removeTarget(row.targetType, row.stockId)} className="destructive-icon-action grid size-9 place-items-center rounded-md"><Trash2 size={15} /></button>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {!liveComparison.allocations.length && <div className="border-t p-10 text-center text-sm text-[var(--muted)]">{t("등록 종목이나 현금을 추가해 주세요.")}</div>}
    </section>

    <section className="grid gap-4 rounded-xl border bg-[var(--surface)] p-5 lg:grid-cols-2">
      <label className="block text-sm font-medium">{t("투자 근거 (선택)")}<textarea value={thesis} onChange={(event) => { setThesis(event.target.value); markDirty(); }} className="mt-1 min-h-24 w-full rounded-lg border bg-[var(--surface)] p-3 text-sm" /></label>
      <label className="block text-sm font-medium">{t("변경 이유 (선택)")}<textarea value={changeNote} onChange={(event) => { setChangeNote(event.target.value); markDirty(); }} className="mt-1 min-h-24 w-full rounded-lg border bg-[var(--surface)] p-3 text-sm" /></label>
      {saveError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200 lg:col-span-2">{saveError}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 lg:col-span-2">
        <p className="text-xs leading-5 text-[var(--muted)]">{t("저장하면 현재 계획을 덮어쓰지 않고 새 리비전으로 활성화합니다.")}</p>
        <div className="flex gap-2"><button type="button" disabled={saving || !dirty} onClick={reset} className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm disabled:opacity-40"><RotateCcw size={15} />{t("변경 취소")}</button><button disabled={saving || !canSave} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white disabled:opacity-40"><Save size={15} />{t(saving ? "저장 중..." : revision ? "변경사항 저장" : "계획 저장")}</button></div>
      </div>
    </section>

    <section className="rounded-xl border bg-[var(--surface)] p-4 text-xs leading-5 text-[var(--muted)]">{t("이 화면은 사용자가 작성한 목표와 현재 상태의 차이를 설명하며 매수·매도 또는 리밸런싱을 권고하지 않습니다.")}</section>
  </form>;
}

function Metric({ label, value, note, tone = "default" }: { label: string; value: string; note?: string; tone?: "default" | "good" | "warn" }) {
  return <div className={`rounded-lg border p-4 ${tone === "good" ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30" : tone === "warn" ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30" : "bg-[var(--surface)]"}`}><p className="text-xs font-medium text-[var(--muted)]">{label}</p><strong className="mt-2 block truncate text-xl tabular-nums" title={value}>{value}</strong>{note && <small className="mt-1 block text-[var(--muted)]">{note}</small>}</div>;
}

function Status({ status }: { status: "onPlan" | "outsidePlan" | "unavailable" }) {
  const { t } = useI18n();
  const label = status === "outsidePlan" ? t("현재 계획 밖 보유") : status === "unavailable" ? t("계산 불가") : t("계획에 포함");
  const tone = status === "outsidePlan" ? "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200" : status === "unavailable" ? "bg-[var(--surface-muted)] text-[var(--muted)]" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200";
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${tone}`}>{label}</span>;
}

function normalizeTargetAmount(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(parsed)));
}

function validTargetAmount(value: string) {
  const parsed = Number(value);
  return value.trim() !== "" && Number.isSafeInteger(parsed) && parsed >= 0;
}

function driftTone(value: number | null) {
  if (value === null || Math.abs(value) < 0.005) return "text-[var(--muted)]";
  return value > 0 ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300";
}

function unavailableMessage(reason: ReturnType<typeof comparePortfolioPlan>["unavailableReason"]) {
  if (reason === "ledgerError") return "매매 원장 오류가 있어 현재 포트폴리오를 확정할 수 없습니다.";
  if (reason === "missingPrice") return "하나 이상의 보유 종목에 유효한 현재가가 없습니다.";
  if (reason === "invalidFx") return "필요한 환율이 없거나 올바르지 않습니다.";
  if (reason === "unreconciledCash") return "조정되지 않은 현금 기록이 있어 전체 배분을 확정할 수 없습니다.";
  if (reason === "missingStock") return "보유 포지션에 연결된 종목을 찾을 수 없습니다.";
  return "현재 포트폴리오 값을 안전하게 계산할 수 없습니다.";
}
