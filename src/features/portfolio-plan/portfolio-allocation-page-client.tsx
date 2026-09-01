"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, Info, Plus, RotateCcw, Save, Scale, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { buildPortfolioBalanceSnapshot } from "@/domain/portfolio-balance";
import { buildPortfolioStockAllocationSnapshot, invalidPortfolioStockTargetIds } from "@/domain/portfolio-stock-allocation";
import { formatCurrency } from "@/domain/money";
import { usePortfolioShell } from "@/features/portfolio-shell/portfolio-shell";
import { useStockStore } from "@/features/stocks/use-stock-store";
import { isBondStock } from "@/features/stocks/asset-class";
import { useI18n } from "@/i18n/i18n-provider";
import { useExchangeRates } from "@/lib/use-exchange-rates";
import { useLocalCollection } from "@/lib/use-local-collection";
import {
  formatBpsInput,
  parsePercentageToBps,
  portfolioPlanCategories,
  portfolioPlanDraftFromActive,
  portfolioTargetAllocationCategoryName,
} from "./portfolio-plan-draft";
import {
  buildPortfolioPlanRepairActivation,
  isLegacyPortfolioPlanV6Data,
  migratePortfolioPlanV6,
  persistPortfolioPlanRepairActivation,
  persistPortfolioPlanV6Migration,
} from "./portfolio-plan-migration";
import { buildPortfolioBalancePolicyUpdate, persistPortfolioBalancePolicyUpdate } from "./portfolio-plan-mutation";
import type {
  LegacyPortfolioAllocationTargetV6,
  LegacyPortfolioPlanRevisionV6,
  LegacyPortfolioPlanStateV6,
  PortfolioAllocationGroup,
  PortfolioAllocationTarget,
  PortfolioBalancePolicy,
  PortfolioPlanRevision,
  PortfolioPlanState,
} from "./types";
import { PortfolioExchangeRateStatus } from "./portfolio-exchange-rate-status";

export function PortfolioAllocationPageClient() {
  const { t } = useI18n();
  const { snapshot: shellSnapshot } = usePortfolioShell();
  const stockStore = useStockStore();
  const exchangeRates = useExchangeRates();
  const stateStore = useLocalCollection<PortfolioPlanState | LegacyPortfolioPlanStateV6>("portfolio-plan-state", []);
  const revisionStore = useLocalCollection<PortfolioPlanRevision | LegacyPortfolioPlanRevisionV6>("portfolio-plan-revisions", []);
  const groupStore = useLocalCollection<PortfolioAllocationGroup>("portfolio-allocation-groups", []);
  const targetStore = useLocalCollection<PortfolioAllocationTarget | LegacyPortfolioAllocationTargetV6>("portfolio-allocation-targets", []);
  const [migrationError, setMigrationError] = useState("");
  const migrationStarted = useRef(false);
  const repairUpgradeStarted = useRef(false);
  const legacy = isLegacyPortfolioPlanV6Data({ states: stateStore.allItems, revisions: revisionStore.allItems, targets: targetStore.allItems });
  const ready = stockStore.ready && exchangeRates.ready && stateStore.ready && revisionStore.ready && groupStore.ready && targetStore.ready;
  const states = legacy ? [] : stateStore.allItems as PortfolioPlanState[];
  const revisions = legacy ? [] : revisionStore.allItems as PortfolioPlanRevision[];
  const targets = useMemo(() => legacy ? [] : targetStore.allItems as PortfolioAllocationTarget[], [legacy, targetStore.allItems]);
  const state = states[0] ?? null;
  const repairState = state?.repairDraft ? state : null;
  const activeRevision = revisions.find((revision) => revision.id === state?.activeRevisionId) ?? null;
  const fallbackCurrency = shellSnapshot.status === "ready" ? shellSnapshot.portfolio.baseCurrency : "KRW";
  const planDraft = useMemo(() => portfolioPlanDraftFromActive({ state, revision: activeRevision, groups: groupStore.allItems, targets, fallbackCurrency }), [activeRevision, fallbackCurrency, groupStore.allItems, state, targets]);
  const bondStockIds = useMemo(() => new Set(planDraft.groups.find((group) => group.category === "bonds")?.targets.flatMap((target) => target.stockId ? [target.stockId] : []) ?? []), [planDraft]);
  const balanceSnapshot = useMemo(() => buildPortfolioBalanceSnapshot({ ledger: stockStore.ledger, stocks: stockStore.allStocks, ratesToKrw: exchangeRates.snapshot.ratesToKrw, bondStockIds }), [bondStockIds, exchangeRates.snapshot.ratesToKrw, stockStore.allStocks, stockStore.ledger]);
  const stockAllocationSnapshot = useMemo(() => buildPortfolioStockAllocationSnapshot({ ledger: stockStore.ledger, stocks: stockStore.allStocks, ratesToKrw: exchangeRates.snapshot.ratesToKrw, bondStockIds }), [bondStockIds, exchangeRates.snapshot.ratesToKrw, stockStore.allStocks, stockStore.ledger]);
  const allocationStocks = useMemo(() => stockStore.allStocks.filter((stock) => !bondStockIds.has(stock.id) && !isBondStock(stock)), [bondStockIds, stockStore.allStocks]);

  useEffect(() => {
    if (!ready || !legacy || migrationStarted.current) return;
    migrationStarted.current = true;
    void (async () => {
      try {
        const migration = migratePortfolioPlanV6({
          states: stateStore.allItems as LegacyPortfolioPlanStateV6[],
          revisions: revisionStore.allItems as LegacyPortfolioPlanRevisionV6[],
          targets: targetStore.allItems as LegacyPortfolioAllocationTargetV6[],
          stocks: stockStore.allStocks,
          accounts: stockStore.accounts,
          trades: stockStore.trades,
        });
        await persistPortfolioPlanV6Migration(migration);
        applyPortfolioCollections({ stateStore, revisionStore, groupStore, targetStore }, migration);
      } catch {
        setMigrationError(t("Allocation을 불러오지 못했습니다. 다시 시도해 주세요."));
      }
    })();
  }, [groupStore, legacy, ready, revisionStore, stateStore, stockStore.accounts, stockStore.allStocks, stockStore.trades, t, targetStore]);

  useEffect(() => {
    if (!ready || legacy || !repairState || repairUpgradeStarted.current) return;
    repairUpgradeStarted.current = true;
    void (async () => {
      try {
        const activation = buildPortfolioPlanRepairActivation({
          state: repairState,
          accountIdsByTargetId: {},
          stocks: stockStore.allStocks,
          accounts: stockStore.accounts,
          contributionAmountMinor: repairState.contributionAmountMinor,
          contributionCurrency: repairState.contributionCurrency,
        });
        await persistPortfolioPlanRepairActivation(activation);
        applyPortfolioCollections({ stateStore, revisionStore, groupStore, targetStore }, activation);
      } catch {
        setMigrationError(t("Allocation을 불러오지 못했습니다. 다시 시도해 주세요."));
      }
    })();
  }, [groupStore, legacy, ready, repairState, revisionStore, stateStore, stockStore.accounts, stockStore.allStocks, t, targetStore]);

  const loadError = migrationError || stockStore.loadError || stateStore.loadError || revisionStore.loadError || groupStore.loadError || targetStore.loadError;
  if (!ready || (legacy || repairState) && !loadError) return <p className="py-20 text-center text-sm text-[var(--muted)]">{t("Allocation을 불러오는 중입니다.")}</p>;
  if (loadError) return <section role="alert" className="rounded-xl border border-red-300 bg-red-50 p-6 text-center text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100"><h1 className="font-semibold">{t("Allocation을 불러오지 못했습니다.")}</h1><p className="mt-2">{loadError}</p></section>;

  return <><PortfolioExchangeRateStatus snapshot={exchangeRates.snapshot} refreshing={exchangeRates.refreshing} onlineError={exchangeRates.onlineError} onRefresh={() => void exchangeRates.refresh()} /><PortfolioAllocationEditor
    state={state}
    fallbackCurrency={fallbackCurrency}
    snapshot={balanceSnapshot}
    stockSnapshot={stockAllocationSnapshot}
    stocks={allocationStocks}
    applyStates={(values) => stateStore.applyCommitted(values)}
  /></>;
}

type StockTargetDraft = { id: string; stockId: string; weightInput: string };
type AllocationDraft = {
  mode: PortfolioBalancePolicy["mode"];
  targetInputs: Record<(typeof portfolioPlanCategories)[number], string>;
  toleranceInput: string;
  stockDetailEnabled: boolean;
  stockTargets: StockTargetDraft[];
  stockToleranceInput: string;
};

const allocationColors = { savings: "#b38337", stocks: "#238769", bonds: "#5d85b2" } as const;

function PortfolioAllocationEditor({ state, fallbackCurrency, snapshot, stockSnapshot, stocks, applyStates }: {
  state: PortfolioPlanState | null;
  fallbackCurrency: PortfolioPlanState["contributionCurrency"];
  snapshot: ReturnType<typeof buildPortfolioBalanceSnapshot>;
  stockSnapshot: ReturnType<typeof buildPortfolioStockAllocationSnapshot>;
  stocks: ReturnType<typeof useStockStore>["allStocks"];
  applyStates: (states: PortfolioPlanState[]) => void;
}) {
  const { t, formatNumber, localeTag } = useI18n();
  const [stored, setStored] = useState<PortfolioBalancePolicy | null>(state?.balancePolicy ?? null);
  const [draft, setDraft] = useState<AllocationDraft>(() => allocationDraftFromPolicy(state?.balancePolicy));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const parsed = useMemo(() => parseAllocationDraft(draft), [draft]);
  const invalidStockTargetIds = useMemo(() => invalidPortfolioStockTargetIds(draft.stockTargets, stocks), [draft.stockTargets, stocks]);
  const saveablePolicy = invalidStockTargetIds.length ? null : parsed;
  const dirty = stored ? !sameBalancePolicy(parsed, stored) : touched;
  const total = portfolioPlanCategories.reduce((sum, category) => sum + (parsePercentageToBps(draft.targetInputs[category]) ?? 0), 0);
  const toleranceBps = parsePercentageToBps(draft.toleranceInput);
  const currentByCategory = new Map(snapshot.categories.map((row) => [row.category, row.currentWeightBps]));
  const stockCurrentById = new Map(stockSnapshot.rows.map((row) => [row.stockId, row.currentWeightBps]));
  const stockById = new Map(stocks.map((stock) => [stock.id, stock]));
  const activeStocks = stocks.filter((stock) => !stock.deletedAt);
  const selectedStockIds = new Set(draft.stockTargets.map((target) => target.stockId).filter(Boolean));
  const untrackedStocks = stockSnapshot.rows.filter((row) => row.currentWeightBps > 0 && !selectedStockIds.has(row.stockId));
  const categoryRows = portfolioPlanCategories.map((category) => {
    const current = currentByCategory.get(category) ?? null;
    const target = parsePercentageToBps(draft.targetInputs[category]);
    return { category, current, target, drift: current === null || target === null ? null : current - target };
  });
  const comparableRows = categoryRows.filter((row): row is typeof row & { drift: number } => row.drift !== null);
  const outsideRows = toleranceBps === null ? [] : comparableRows.filter((row) => Math.abs(row.drift) > toleranceBps);
  const largestDrift = comparableRows.slice().sort((left, right) => Math.abs(right.drift) - Math.abs(left.drift))[0] ?? null;
  const highestOver = comparableRows.filter((row) => row.drift > 0).sort((left, right) => right.drift - left.drift)[0] ?? null;
  const highestUnder = comparableRows.filter((row) => row.drift < 0).sort((left, right) => left.drift - right.drift)[0] ?? null;
  const currentMix = Object.fromEntries(categoryRows.map((row) => [row.category, row.current ?? 0])) as Record<(typeof portfolioPlanCategories)[number], number>;

  function change(update: (current: AllocationDraft) => AllocationDraft) {
    setDraft(update); setTouched(true); setNotice(""); setError("");
  }
  function reset() { setDraft(allocationDraftFromPolicy(stored)); setTouched(false); setNotice(""); setError(""); }
  function effectiveState() { return state ? { ...state, balancePolicy: stored } : null; }
  function enableStockDetails() {
    const held = stockSnapshot.rows.filter((row) => activeStocks.some((stock) => stock.id === row.stockId));
    const initial = held.length ? normalizeStockWeights(held.map((row) => ({ stockId: row.stockId, score: row.currentValueKrw }))) : activeStocks[0] ? [{ stockId: activeStocks[0].id, targetWeightBps: 10000 }] : [];
    if (!initial.length) return;
    change((current) => ({ ...current, stockDetailEnabled: true, stockTargets: initial.map((target, index) => ({ id: allocationRowId(index), stockId: target.stockId, weightInput: formatBpsInput(target.targetWeightBps) })) }));
  }
  function addStockTarget() {
    const stock = activeStocks.find((candidate) => !selectedStockIds.has(candidate.id));
    if (!stock) return;
    const used = draft.stockTargets.reduce((sum, target) => sum + (parsePercentageToBps(target.weightInput) ?? 0), 0);
    change((current) => ({ ...current, stockTargets: [...current.stockTargets, { id: allocationRowId(current.stockTargets.length), stockId: stock.id, weightInput: formatBpsInput(Math.max(0, 10000 - used)) }] }));
  }
  function useCurrentCategoryWeights() {
    if (!snapshot.available || snapshot.totalValueKrw === null || snapshot.totalValueKrw <= 0) return;
    const normalized = normalizeCategoryWeights(snapshot.categories.map((row) => ({ category: row.category, score: row.currentValueKrw ?? 0 })));
    change((current) => ({ ...current, targetInputs: Object.fromEntries(normalized.map((row) => [row.category, formatBpsInput(row.targetWeightBps)])) as AllocationDraft["targetInputs"] }));
  }
  function useCurrentStockWeights() {
    const selected = draft.stockTargets.map((target) => ({ stockId: target.stockId, score: stockSnapshot.rows.find((row) => row.stockId === target.stockId)?.currentValueKrw ?? 0 }));
    if (!selected.length || selected.every((row) => row.score <= 0)) return;
    const normalized = normalizeStockWeights(selected);
    const byStockId = new Map(normalized.map((row) => [row.stockId, row.targetWeightBps]));
    change((current) => ({ ...current, stockTargets: current.stockTargets.map((target) => ({ ...target, weightInput: formatBpsInput(byStockId.get(target.stockId) ?? 0) })) }));
  }
  function distributeStockWeightsEvenly() {
    if (!draft.stockTargets.length) return;
    const normalized = normalizeStockWeights(draft.stockTargets.map((target) => ({ stockId: target.stockId, score: 1 })));
    const byStockId = new Map(normalized.map((row) => [row.stockId, row.targetWeightBps]));
    change((current) => ({ ...current, stockTargets: current.stockTargets.map((target) => ({ ...target, weightInput: formatBpsInput(byStockId.get(target.stockId) ?? 0) })) }));
  }
  async function save() {
    if (saving || !saveablePolicy || !dirty) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const update = buildPortfolioBalancePolicyUpdate({ state: effectiveState(), policy: saveablePolicy, fallbackCurrency });
      await persistPortfolioBalancePolicyUpdate(update);
      applyStates(update.states);
      const committed = update.state.balancePolicy ?? null;
      setStored(committed); setDraft(allocationDraftFromPolicy(committed)); setTouched(false);
      setNotice(t("Allocation을 저장했습니다. Plan 계산에 바로 반영됩니다."));
    } catch { setError(t("Allocation을 저장하지 못했습니다. 다시 시도해 주세요.")); }
    finally { setSaving(false); }
  }
  async function disable() {
    if (saving || !stored) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const update = buildPortfolioBalancePolicyUpdate({ state: effectiveState(), policy: null, fallbackCurrency });
      await persistPortfolioBalancePolicyUpdate(update); applyStates(update.states);
      setStored(null); setDraft(allocationDraftFromPolicy(null)); setTouched(false);
      setNotice(t("Allocation을 사용하지 않습니다. Plan은 저장된 기본 비율을 사용합니다."));
    } catch { setError(t("Allocation을 저장하지 못했습니다. 다시 시도해 주세요.")); }
    finally { setSaving(false); }
  }

  return <div className="portfolio-allocation-workspace">
    <header className="portfolio-plan-heading allocation-page-heading">
      <div><p>{t("Portfolio Allocation")}</p><h1>{t("전체 자산의 목표 비중을 정하세요.")}</h1><span>{t("현재 비중, 목표, 허용 범위를 비교하고 Plan의 다음 저축 계산에 연결합니다.")}</span></div>
      <div className="allocation-heading-actions">
        {stored && <span className="portfolio-plan-mode-badge"><Scale size={14} aria-hidden="true" />{t(stored.mode === "balanceAssist" ? "균형 맞추기" : "고정 비율")}</span>}
        {dirty && <span className="portfolio-plan-dirty-badge"><i aria-hidden="true" />{t("저장되지 않은 변경")}</span>}
        <button type="button" disabled={saving || !dirty} onClick={reset} className="allocation-secondary-action"><RotateCcw size={15} aria-hidden="true" />{t("Reset")}</button>
        <button type="button" disabled={saving || !saveablePolicy || !dirty} onClick={() => void save()} className="allocation-primary-action"><Save size={16} aria-hidden="true" />{saving ? t("저장 중...") : t("Allocation 저장")}</button>
      </div>
    </header>
    {notice && <p role="status" className="mt-5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">{notice}</p>}
    {error && <p role="alert" className="mt-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">{error}</p>}
    {invalidStockTargetIds.length > 0 && <p role="alert" className="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">{t("삭제되었거나 사용할 수 없는 주식 세부 목표가 있습니다. 종목을 교체하거나 해당 행을 삭제해 주세요.")}</p>}

    <section className={`allocation-health ${outsideRows.length ? "is-warning" : comparableRows.length ? "is-healthy" : "is-neutral"}`} aria-label={t("Allocation 상태")}>
      <div>{outsideRows.length ? <AlertTriangle size={20} aria-hidden="true" /> : <CheckCircle2 size={20} aria-hidden="true" />}<span><b>{t(outsideRows.length ? "허용 범위를 벗어난 자산군이 있습니다." : comparableRows.length ? "모든 자산군이 허용 범위 안에 있습니다." : "현재 자산 평가를 기다리고 있습니다.")}</b><small>{t(outsideRows.length ? "Plan에서 부족한 자산군을 우선하도록 계산할 수 있습니다." : "목표와 다르더라도 허용 범위 안이면 기본 Plan 비율을 유지합니다.")}</small></span></div>
      <dl><div><dt>{t("가장 큰 차이")}</dt><dd>{largestDrift ? `${t(portfolioTargetAllocationCategoryName(largestDrift.category))} ${signedBps(largestDrift.drift, formatNumber)}` : "—"}</dd></div><div><dt>{t("평가 금액")}</dt><dd>{snapshot.totalValueKrw === null ? "—" : formatCurrency(snapshot.totalValueKrw, "KRW", localeTag)}</dd></div></dl>
    </section>

    <div className="allocation-dashboard-grid">
      <section aria-labelledby="allocation-target-title" className="allocation-panel allocation-asset-panel">
        <header className="allocation-panel-header"><div><h2 id="allocation-target-title">{t("자산 배분")}</h2><p>{t("현재 비중, 목표와 허용 범위")}</p></div><div className="allocation-method-switch" aria-label={t("저축 계산 방식")}><button type="button" aria-pressed={draft.mode === "balanceAssist"} onClick={() => change((current) => ({ ...current, mode: "balanceAssist" }))}>{t("균형 맞추기")}</button><button type="button" aria-pressed={draft.mode === "fixed"} onClick={() => change((current) => ({ ...current, mode: "fixed" }))}>{t("Plan 비율 유지")}</button></div></header>
        <div className="allocation-tolerance-row"><span>{t("자산군 허용 오차")}</span><AllocationPercentageInput label={t("허용 오차")} value={draft.toleranceInput} onChange={(value) => change((current) => ({ ...current, toleranceInput: value }))} compact /></div>
        <div className="allocation-quick-actions"><button type="button" disabled={!snapshot.available || !comparableRows.length} onClick={useCurrentCategoryWeights}>{t("현재 비중 사용")}</button><button type="button" onClick={() => change((current) => ({ ...current, targetInputs: { savings: "30", stocks: "60", bonds: "10" } }))}>{t("기본 30·60·10")}</button></div>
        <div className="allocation-table allocation-asset-table" role="table" aria-label={t("자산 배분 목표 표")}>
          <div className="allocation-table-head" role="row"><span role="columnheader">{t("자산군")}</span><span role="columnheader">{t("범위 내 위치")}</span><span role="columnheader">{t("현재")}</span><span role="columnheader">{t("목표")}</span><span role="columnheader">{t("차이")}</span></div>
          {categoryRows.map((row) => <div className="allocation-table-row" key={row.category} role="row">
            <div className="allocation-asset-name" role="cell"><i style={{ background: allocationColors[row.category] }} aria-hidden="true" /><b>{t(portfolioTargetAllocationCategoryName(row.category))}</b></div>
            <AllocationRangeBar currentBps={row.current} targetBps={row.target} toleranceBps={toleranceBps} color={allocationColors[row.category]} />
            <strong role="cell">{row.current === null ? "—" : `${formatBps(row.current)}%`}</strong>
            <div role="cell"><AllocationPercentageInput label={t("{name} 전체 목표", { name: t(portfolioTargetAllocationCategoryName(row.category)) })} value={draft.targetInputs[row.category]} onChange={(value) => change((current) => ({ ...current, targetInputs: { ...current.targetInputs, [row.category]: value } }))} compact /></div>
            <span role="cell" className={row.drift !== null && toleranceBps !== null && Math.abs(row.drift) > toleranceBps ? "is-outside" : ""}>{row.drift === null ? "—" : signedBps(row.drift, formatNumber)}</span>
          </div>)}
        </div>
        <div className="allocation-table-legend"><span><i className="range" />{t("허용 범위")}</span><span><i className="target" />{t("목표")}</span></div>
        <div className="allocation-panel-note"><Info size={16} aria-hidden="true" /><p>{t("현재 비중이 목표와 다르다는 이유만으로 조정하지 않고, 허용 범위를 벗어날 때만 균형 맞추기를 제안합니다.")}</p></div>
        <p className={`allocation-validation ${saveablePolicy ? "is-valid" : "is-invalid"}`}>{saveablePolicy ? t("목표 비중 합계 {value}% · 저장 가능", { value: formatBps(total) }) : t("전체 목표 또는 선택한 주식 세부 비율을 확인해 주세요.")}</p>
      </section>

      <aside className="allocation-side-stack">
        <section className="allocation-panel allocation-mix-panel" aria-labelledby="current-mix-title"><header className="allocation-panel-header"><div><h2 id="current-mix-title">{t("현재 구성")}</h2><p>{snapshot.totalValueKrw === null ? t("평가 불가") : formatCurrency(snapshot.totalValueKrw, "KRW", localeTag)}</p></div></header><AllocationDonut weights={currentMix} empty={!comparableRows.length} /><div className="allocation-mix-legend">{portfolioPlanCategories.map((category) => <div key={category}><i style={{ background: allocationColors[category] }} /><span>{t(portfolioTargetAllocationCategoryName(category))}</span><b>{currentByCategory.get(category) === null || currentByCategory.get(category) === undefined ? "—" : `${formatBps(currentByCategory.get(category)!)}%`}</b></div>)}</div></section>
        <section className="allocation-panel allocation-drift-panel" aria-labelledby="drift-monitor-title"><header className="allocation-panel-header"><div><h2 id="drift-monitor-title">{t("차이 모니터")}</h2><p className={outsideRows.length ? "is-warning" : "is-healthy"}>{t(outsideRows.length ? "확인 필요" : "안정")}</p></div></header><DriftItem label={t("가장 높은 초과") } name={highestOver ? t(portfolioTargetAllocationCategoryName(highestOver.category)) : "—"} value={highestOver ? signedBps(highestOver.drift, formatNumber) : "—"} tone="up" /><DriftItem label={t("가장 높은 부족")} name={highestUnder ? t(portfolioTargetAllocationCategoryName(highestUnder.category)) : "—"} value={highestUnder ? signedBps(highestUnder.drift, formatNumber) : "—"} tone="down" /><DriftItem label={t("주식 집중도")} name={stockSnapshot.rows[0] ? stockById.get(stockSnapshot.rows[0].stockId)?.name ?? t("알 수 없는 종목") : "—"} value={stockSnapshot.rows[0] ? `${formatBps(stockSnapshot.rows[0].currentWeightBps)}%` : "—"} tone="neutral" /></section>
      </aside>
    </div>

    <section className="allocation-panel allocation-stock-detail" aria-labelledby="stock-detail-title">
      <header className="allocation-panel-header"><div><p className="allocation-eyebrow">{t("선택 옵션 · 주식 세부 배분")}</p><h2 id="stock-detail-title">{t("주식 자산군 안에서 종목별 목표 정하기")}</h2><span>{t("설정하지 않아도 됩니다. 설정하면 현재 보유 종목 비중과 목표 허용 범위를 비교하고 Plan의 주식 금액을 나눕니다.")}</span></div>{draft.stockDetailEnabled && <div className="allocation-stock-actions"><AllocationPercentageInput label={t("주식 세부 허용 오차")} value={draft.stockToleranceInput} onChange={(value) => change((current) => ({ ...current, stockToleranceInput: value }))} /><button type="button" onClick={() => change((current) => ({ ...current, stockDetailEnabled: false, stockTargets: [] }))}>{t("옵션 끄기")}</button></div>}</header>
      {!draft.stockDetailEnabled ? <div className="allocation-stock-empty"><div><b>{t("종목별 목표는 아직 사용하지 않습니다.")}</b><p>{t("현재 보유 종목을 기준으로 시작하거나 등록된 종목을 직접 추가할 수 있습니다.")}</p></div>{activeStocks.length ? <button type="button" onClick={enableStockDetails}><Plus size={16} aria-hidden="true" />{t("주식 세부 비율 설정")}</button> : <Link href="/stocks">{t("종목 먼저 등록하기")}<ArrowRight size={15} aria-hidden="true" /></Link>}</div> : <>
        <div className="allocation-table allocation-stock-table" role="table" aria-label={t("주식 세부 목표 표")}><div className="allocation-table-head" role="row"><span role="columnheader">{t("종목")}</span><span role="columnheader">{t("범위 내 위치")}</span><span role="columnheader">{t("현재")}</span><span role="columnheader">{t("목표")}</span><span role="columnheader">{t("차이")}</span><span role="columnheader" className="sr-only">{t("작업")}</span></div>{draft.stockTargets.map((target) => {
          const current = stockCurrentById.get(target.stockId) ?? (stockSnapshot.available ? 0 : null);
          const targetBps = parsePercentageToBps(target.weightInput);
          const stockTolerance = parsePercentageToBps(draft.stockToleranceInput);
          const drift = current === null || targetBps === null ? null : current - targetBps;
          return <div className="allocation-table-row" key={target.id} role="row">
            <div className="allocation-stock-select" role="cell"><label><span className="sr-only">{t("주식 종목")}</span><select aria-label={t("주식 종목")} value={target.stockId} onChange={(event) => change((currentDraft) => ({ ...currentDraft, stockTargets: currentDraft.stockTargets.map((item) => item.id === target.id ? { ...item, stockId: event.target.value } : item) }))}><option value="">{t("종목 선택")}</option>{stocks.filter((stock) => !stock.deletedAt || stock.id === target.stockId).map((stock) => <option key={stock.id} value={stock.id} disabled={selectedStockIds.has(stock.id) && stock.id !== target.stockId}>{stock.ticker} · {stock.name}{stock.deletedAt ? ` · ${t("삭제됨")}` : ""}</option>)}</select></label></div>
            <AllocationRangeBar currentBps={current} targetBps={targetBps} toleranceBps={stockTolerance} color={allocationColors.stocks} />
            <strong role="cell">{current === null ? "—" : `${formatBps(current)}%`}</strong>
            <div role="cell"><AllocationPercentageInput label={t("종목 목표 비중")} value={target.weightInput} onChange={(value) => change((currentDraft) => ({ ...currentDraft, stockTargets: currentDraft.stockTargets.map((item) => item.id === target.id ? { ...item, weightInput: value } : item) }))} compact /></div>
            <span role="cell" className={drift !== null && stockTolerance !== null && Math.abs(drift) > stockTolerance ? "is-outside" : ""}>{drift === null ? "—" : signedBps(drift, formatNumber)}</span>
            <div className="allocation-row-action" role="cell"><button type="button" aria-label={t("{name} 세부 목표 삭제", { name: stockById.get(target.stockId)?.name ?? t("주식") })} onClick={() => change((currentDraft) => ({ ...currentDraft, stockTargets: currentDraft.stockTargets.filter((item) => item.id !== target.id), stockDetailEnabled: currentDraft.stockTargets.length > 1 }))}><Trash2 size={16} aria-hidden="true" /></button></div>
          </div>;
        })}</div>
        <div className="allocation-stock-footer"><div><button type="button" disabled={draft.stockTargets.length >= activeStocks.length} onClick={addStockTarget}><Plus size={15} aria-hidden="true" />{t("종목 추가")}</button><button type="button" onClick={distributeStockWeightsEvenly}>{t("균등 분배")}</button><button type="button" disabled={!stockSnapshot.available || !draft.stockTargets.some((target) => stockCurrentById.has(target.stockId))} onClick={useCurrentStockWeights}>{t("현재 비중 사용")}</button></div><p>{t("주식 세부 목표 합계")}: <b>{formatBps(draft.stockTargets.reduce((sum, target) => sum + (parsePercentageToBps(target.weightInput) ?? 0), 0))}%</b></p></div>
        {untrackedStocks.length > 0 && <p className="allocation-untracked"><AlertTriangle size={15} aria-hidden="true" />{t("세부 목표에 없는 보유 종목: {names}", { names: untrackedStocks.map((row) => stockById.get(row.stockId)?.name ?? row.stockId).join(", ") })}</p>}
      </>}
      <footer className="allocation-stock-link"><p>{t("이 세부 옵션은 저장된 Contribution Plan을 바꾸지 않고 다음 계산에만 적용됩니다.")}</p><Link href="/portfolio/plan">{t("Plan에서 계산 확인")}<ArrowRight size={15} aria-hidden="true" /></Link></footer>
    </section>

    {stored && <button type="button" disabled={saving} onClick={() => void disable()} className="allocation-disable">{t("Allocation 사용 안 함")}</button>}
  </div>;
}

function AllocationPercentageInput({ label, value, onChange, compact = false }: { label: string; value: string; onChange: (value: string) => void; compact?: boolean }) {
  const id = useId();
  return <label htmlFor={id} className={`allocation-percentage-input ${compact ? "is-compact" : ""}`}><span className={compact ? "sr-only" : ""}>{label}</span><span><input id={id} aria-label={`${label} (%)`} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} /><i aria-hidden="true">%</i></span></label>;
}

function AllocationRangeBar({ currentBps, targetBps, toleranceBps, color }: { currentBps: number | null; targetBps: number | null; toleranceBps: number | null; color: string }) {
  const { t, formatNumber } = useI18n();
  const target = targetBps ?? 0;
  const tolerance = toleranceBps ?? 0;
  const start = clampBps(target - tolerance);
  const end = clampBps(target + tolerance);
  const style = { "--allocation-current": `${clampBps(currentBps ?? 0) / 100}%`, "--allocation-target": `${clampBps(target) / 100}%`, "--allocation-range-start": `${start / 100}%`, "--allocation-range-width": `${(end - start) / 100}%`, "--allocation-row-color": color } as CSSProperties;
  const label = currentBps === null || targetBps === null ? t("현재 또는 목표 비중을 계산할 수 없습니다.") : t("현재 {current}%, 목표 {target}%, 허용 오차 {tolerance}%", { current: formatNumber(currentBps / 100, { maximumFractionDigits: 2 }), target: formatNumber(targetBps / 100, { maximumFractionDigits: 2 }), tolerance: formatNumber((toleranceBps ?? 0) / 100, { maximumFractionDigits: 2 }) });
  return <div className="allocation-range-bar" style={style} role="cell" aria-label={label}><span className="track" aria-hidden="true"><i className="permitted" /><i className="current" /><i className="target" /></span></div>;
}

function AllocationDonut({ weights, empty }: { weights: Record<(typeof portfolioPlanCategories)[number], number>; empty: boolean }) {
  const { t } = useI18n();
  const savings = weights.savings / 100;
  const stocks = weights.stocks / 100;
  const background = empty ? "var(--color-surface-muted)" : `conic-gradient(${allocationColors.savings} 0 ${savings}%, ${allocationColors.stocks} ${savings}% ${savings + stocks}%, ${allocationColors.bonds} ${savings + stocks}% 100%)`;
  return <div className="allocation-donut" style={{ background }}><div><b>{empty ? "—" : `${formatBps(Math.max(weights.savings, weights.stocks, weights.bonds))}%`}</b><span>{empty ? "" : t(portfolioTargetAllocationCategoryName(portfolioPlanCategories.slice().sort((left, right) => weights[right] - weights[left])[0]!))}</span></div></div>;
}

function DriftItem({ label, name, value, tone }: { label: string; name: string; value: string; tone: "up" | "down" | "neutral" }) {
  return <div className="allocation-drift-item"><span className={`icon is-${tone}`} aria-hidden="true">{tone === "up" ? "↗" : tone === "down" ? "↘" : "◎"}</span><div><b>{label}</b><small>{name}</small></div><strong>{value}</strong></div>;
}

function allocationDraftFromPolicy(policy: PortfolioBalancePolicy | null | undefined): AllocationDraft {
  const weights = policy?.targetWeightsBps ?? { savings: 3000, stocks: 6000, bonds: 1000 };
  return { mode: policy?.mode ?? "balanceAssist", targetInputs: Object.fromEntries(portfolioPlanCategories.map((category) => [category, formatBpsInput(weights[category])])) as AllocationDraft["targetInputs"], toleranceInput: formatBpsInput(policy?.toleranceBps ?? 500), stockDetailEnabled: Boolean(policy?.stockTargets?.length), stockTargets: (policy?.stockTargets ?? []).map((target, index) => ({ id: allocationRowId(index), stockId: target.stockId, weightInput: formatBpsInput(target.targetWeightBps) })), stockToleranceInput: formatBpsInput(policy?.stockToleranceBps ?? 500) };
}

function parseAllocationDraft(draft: AllocationDraft): PortfolioBalancePolicy | null {
  const weights = Object.fromEntries(portfolioPlanCategories.map((category) => [category, parsePercentageToBps(draft.targetInputs[category])])) as Record<(typeof portfolioPlanCategories)[number], number | null>;
  const toleranceBps = parsePercentageToBps(draft.toleranceInput);
  if (toleranceBps === null || portfolioPlanCategories.some((category) => weights[category] === null)) return null;
  const targetWeightsBps = weights as PortfolioBalancePolicy["targetWeightsBps"];
  if (portfolioPlanCategories.reduce((sum, category) => sum + targetWeightsBps[category], 0) !== 10000) return null;
  if (!draft.stockDetailEnabled) return { version: 1, mode: draft.mode, targetWeightsBps, toleranceBps, updatedAt: new Date().toISOString() };
  const stockToleranceBps = parsePercentageToBps(draft.stockToleranceInput);
  const targets = draft.stockTargets.map((target) => ({ stockId: target.stockId.trim(), targetWeightBps: parsePercentageToBps(target.weightInput) }));
  if (stockToleranceBps === null || !targets.length || targets.some((target) => !target.stockId || target.targetWeightBps === null) || new Set(targets.map((target) => target.stockId)).size !== targets.length || targets.reduce((sum, target) => sum + (target.targetWeightBps ?? 0), 0) !== 10000) return null;
  return { version: 1, mode: draft.mode, targetWeightsBps, toleranceBps, stockTargets: targets as PortfolioBalancePolicy["stockTargets"], stockToleranceBps, updatedAt: new Date().toISOString() };
}

function sameBalancePolicy(left: PortfolioBalancePolicy | null, right: PortfolioBalancePolicy | null) {
  if (!left || !right) return left === right;
  const leftStocks = left.stockTargets ?? [];
  const rightStocks = right.stockTargets ?? [];
  return left.mode === right.mode && left.toleranceBps === right.toleranceBps && left.stockToleranceBps === right.stockToleranceBps && portfolioPlanCategories.every((category) => left.targetWeightsBps[category] === right.targetWeightsBps[category]) && leftStocks.length === rightStocks.length && leftStocks.every((target, index) => target.stockId === rightStocks[index]?.stockId && target.targetWeightBps === rightStocks[index]?.targetWeightBps);
}

function normalizeStockWeights(values: Array<{ stockId: string; score: number }>) {
  const total = values.reduce((sum, value) => sum + value.score, 0);
  if (total <= 0) return values.map((value, index) => ({ stockId: value.stockId, targetWeightBps: index === 0 ? 10000 : 0 }));
  const rows = values.map((value, order) => { const exact = value.score / total * 10000; const floor = Math.floor(exact); return { stockId: value.stockId, order, targetWeightBps: floor, remainder: exact - floor }; });
  let remaining = 10000 - rows.reduce((sum, row) => sum + row.targetWeightBps, 0);
  const order = rows.slice().sort((left, right) => right.remainder - left.remainder || left.order - right.order);
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) order[index % order.length]!.targetWeightBps += 1;
  return rows.map(({ stockId, targetWeightBps }) => ({ stockId, targetWeightBps }));
}

function normalizeCategoryWeights(values: Array<{ category: (typeof portfolioPlanCategories)[number]; score: number }>) {
  return normalizeStockWeights(values.map((value) => ({ stockId: value.category, score: value.score }))).map((value) => ({ category: value.stockId as (typeof portfolioPlanCategories)[number], targetWeightBps: value.targetWeightBps }));
}

function formatBps(bps: number) { const rounded = Math.round(Math.max(0, Math.min(10000, bps))); const whole = Math.floor(rounded / 100); const fraction = String(rounded % 100).padStart(2, "0").replace(/0+$/, ""); return fraction ? `${whole}.${fraction}` : String(whole); }
function signedBps(bps: number, formatNumber: ReturnType<typeof useI18n>["formatNumber"]) { return `${bps > 0 ? "+" : ""}${formatNumber(bps / 100, { maximumFractionDigits: 2 })}%p`; }
function clampBps(bps: number) { return Math.max(0, Math.min(10000, bps)); }
function allocationRowId(index: number) { return `allocation-stock:${index}:${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`; }

function applyPortfolioCollections(stores: {
  stateStore: ReturnType<typeof useLocalCollection<PortfolioPlanState | LegacyPortfolioPlanStateV6>>;
  revisionStore: ReturnType<typeof useLocalCollection<PortfolioPlanRevision | LegacyPortfolioPlanRevisionV6>>;
  groupStore: ReturnType<typeof useLocalCollection<PortfolioAllocationGroup>>;
  targetStore: ReturnType<typeof useLocalCollection<PortfolioAllocationTarget | LegacyPortfolioAllocationTargetV6>>;
}, values: { states: PortfolioPlanState[]; revisions: PortfolioPlanRevision[]; groups: PortfolioAllocationGroup[]; targets: PortfolioAllocationTarget[] }) {
  stores.stateStore.applyCommitted(values.states);
  stores.revisionStore.applyCommitted(values.revisions);
  stores.groupStore.applyCommitted(values.groups);
  stores.targetStore.applyCommitted(values.targets);
}
