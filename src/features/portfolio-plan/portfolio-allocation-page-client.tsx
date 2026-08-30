"use client";

import { ArrowRight, RotateCcw, Save, Scale } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { buildPortfolioBalanceSnapshot } from "@/domain/portfolio-balance";
import { usePortfolioShell } from "@/features/portfolio-shell/portfolio-shell";
import { useStockStore } from "@/features/stocks/use-stock-store";
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

  return <PortfolioAllocationEditor
    state={state}
    fallbackCurrency={fallbackCurrency}
    snapshot={balanceSnapshot}
    applyStates={(values) => stateStore.applyCommitted(values)}
  />;
}

type AllocationDraft = {
  mode: PortfolioBalancePolicy["mode"];
  targetInputs: Record<(typeof portfolioPlanCategories)[number], string>;
  toleranceInput: string;
};

function PortfolioAllocationEditor({ state, fallbackCurrency, snapshot, applyStates }: {
  state: PortfolioPlanState | null;
  fallbackCurrency: PortfolioPlanState["contributionCurrency"];
  snapshot: ReturnType<typeof buildPortfolioBalanceSnapshot>;
  applyStates: (states: PortfolioPlanState[]) => void;
}) {
  const { t, formatNumber } = useI18n();
  const [stored, setStored] = useState<PortfolioBalancePolicy | null>(state?.balancePolicy ?? null);
  const [draft, setDraft] = useState<AllocationDraft>(() => allocationDraftFromPolicy(state?.balancePolicy));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const parsed = useMemo(() => parseAllocationDraft(draft), [draft]);
  const dirty = stored ? !sameBalancePolicy(parsed, stored) : touched;
  const total = portfolioPlanCategories.reduce((sum, category) => sum + (parsePercentageToBps(draft.targetInputs[category]) ?? 0), 0);
  const currentByCategory = new Map(snapshot.categories.map((row) => [row.category, row.currentWeightBps]));

  function change(update: (current: AllocationDraft) => AllocationDraft) {
    setDraft(update);
    setTouched(true);
    setNotice("");
    setError("");
  }
  function reset() {
    setDraft(allocationDraftFromPolicy(stored));
    setTouched(false);
    setNotice("");
    setError("");
  }
  function effectiveState() {
    return state ? { ...state, balancePolicy: stored } : null;
  }
  async function save() {
    if (saving || !parsed || !dirty) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const update = buildPortfolioBalancePolicyUpdate({ state: effectiveState(), policy: parsed, fallbackCurrency });
      await persistPortfolioBalancePolicyUpdate(update);
      applyStates(update.states);
      const committed = update.state.balancePolicy ?? null;
      setStored(committed);
      setDraft(allocationDraftFromPolicy(committed));
      setTouched(false);
      setNotice(t("Allocation을 저장했습니다. Plan 계산에 바로 반영됩니다."));
    } catch {
      setError(t("Allocation을 저장하지 못했습니다. 다시 시도해 주세요."));
    } finally { setSaving(false); }
  }
  async function disable() {
    if (saving || !stored) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const update = buildPortfolioBalancePolicyUpdate({ state: effectiveState(), policy: null, fallbackCurrency });
      await persistPortfolioBalancePolicyUpdate(update);
      applyStates(update.states);
      setStored(null);
      setDraft(allocationDraftFromPolicy(null));
      setTouched(false);
      setNotice(t("Allocation을 사용하지 않습니다. Plan은 저장된 기본 비율을 사용합니다."));
    } catch {
      setError(t("Allocation을 저장하지 못했습니다. 다시 시도해 주세요."));
    } finally { setSaving(false); }
  }

  return <div className="portfolio-plan-form">
    <header className="portfolio-plan-heading">
      <div><p>{t("Portfolio Allocation")}</p><h1>{t("전체 자산의 목표 비중을 정하세요.")}</h1><span>{t("Allocation은 현재 보유 자산의 목표를 관리하고, Plan은 이 값을 읽어 다음 저축액을 계산합니다.")}</span></div>
      <div className="portfolio-plan-heading-badges">{stored && <span className="portfolio-plan-mode-badge"><Scale size={14} aria-hidden="true" />{t(stored.mode === "balanceAssist" ? "균형 맞추기" : "고정 비율")}</span>}{dirty && <span className="portfolio-plan-dirty-badge"><i aria-hidden="true" />{t("저장되지 않은 변경")}</span>}</div>
    </header>
    {notice && <p role="status" className="mt-5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">{notice}</p>}
    {error && <p role="alert" className="mt-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">{error}</p>}

    <section aria-label={t("Allocation과 Plan 연결")} className="mt-5 grid items-center gap-2 rounded-xl border bg-[var(--surface)] p-4 text-center text-xs sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
      <b className="rounded-lg bg-[var(--surface-muted)] px-3 py-3">{t("현재 보유 자산")}</b><ArrowRight className="mx-auto rotate-90 text-[var(--muted)] sm:rotate-0" size={17} aria-hidden="true" /><b className="rounded-lg bg-[var(--accent-soft)] px-3 py-3 text-[var(--accent)]">{t("Allocation 목표")}</b><ArrowRight className="mx-auto rotate-90 text-[var(--muted)] sm:rotate-0" size={17} aria-hidden="true" /><b className="rounded-lg bg-[var(--surface-muted)] px-3 py-3">{t("Plan 저축 계산")}</b>
    </section>

    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section aria-labelledby="allocation-target-title" className="portfolio-plan-card p-4 sm:p-5">
        <div><p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">{t("01 · 목표 자산 배분")}</p><h2 id="allocation-target-title" className="mt-1 text-lg font-semibold">{t("현금성 자산·주식·채권 목표")}</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--muted)]">{t("세 자산군의 목표 비중 합계는 정확히 100%여야 합니다.")}</p></div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">{portfolioPlanCategories.map((category) => {
          const current = currentByCategory.get(category);
          const target = parsePercentageToBps(draft.targetInputs[category]);
          const drift = current === null || current === undefined || target === null ? null : current - target;
          return <div key={category} className="rounded-xl border bg-[var(--surface-muted)] p-4"><AllocationPercentageInput label={t("{name} 전체 목표", { name: t(portfolioTargetAllocationCategoryName(category)) })} value={draft.targetInputs[category]} onChange={(value) => change((currentDraft) => ({ ...currentDraft, targetInputs: { ...currentDraft.targetInputs, [category]: value } }))} /><dl className="mt-3 grid grid-cols-2 gap-2 text-[0.7rem]"><div><dt className="text-[var(--muted)]">{t("현재 비중")}</dt><dd className="mt-1 font-semibold tabular-nums">{current === null || current === undefined ? "—" : `${formatNumber(current / 100, { maximumFractionDigits: 2 })}%`}</dd></div><div><dt className="text-[var(--muted)]">{t("목표 대비")}</dt><dd className="mt-1 font-semibold tabular-nums">{drift === null ? "—" : `${drift > 0 ? "+" : ""}${formatNumber(drift / 100, { maximumFractionDigits: 2 })}%p`}</dd></div></dl></div>;
        })}</div>
        <p className={`mt-4 rounded-lg px-3 py-2 text-xs ${parsed ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100"}`}>{parsed ? t("목표 비중 합계 {value}% · 저장 가능", { value: formatBps(total) }) : t("전체 목표 비율 합계는 정확히 100%여야 합니다.")}</p>
      </section>

      <aside aria-labelledby="allocation-method-title" className="portfolio-plan-card h-fit p-4 sm:p-5">
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">{t("02 · Plan 반영 방식")}</p><h2 id="allocation-method-title" className="mt-1 text-lg font-semibold">{t("다음 저축액 계산 방식")}</h2>
        <div className="mt-4 grid gap-2" aria-label={t("저축 계산 방식")}>
          <button type="button" aria-pressed={draft.mode === "balanceAssist"} onClick={() => change((current) => ({ ...current, mode: "balanceAssist" }))} className={`rounded-xl border p-3 text-left text-xs ${draft.mode === "balanceAssist" ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "bg-[var(--surface-muted)]"}`}><b className="block">{t("균형 맞추기")}</b><span className="mt-1 block leading-5 text-[var(--muted)]">{t("목표보다 부족한 자산군에 새 저축액을 우선 배분합니다.")}</span></button>
          <button type="button" aria-pressed={draft.mode === "fixed"} onClick={() => change((current) => ({ ...current, mode: "fixed" }))} className={`rounded-xl border p-3 text-left text-xs ${draft.mode === "fixed" ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "bg-[var(--surface-muted)]"}`}><b className="block">{t("Plan 비율 유지")}</b><span className="mt-1 block leading-5 text-[var(--muted)]">{t("목표는 비교에만 사용하고 기존 Contribution Plan 비율을 유지합니다.")}</span></button>
        </div>
        <div className="mt-4"><AllocationPercentageInput label={t("허용 오차")} value={draft.toleranceInput} onChange={(value) => change((current) => ({ ...current, toleranceInput: value }))} /><p className="mt-2 text-[0.7rem] leading-5 text-[var(--muted)]">{t("현재 비중이 이 범위 안이면 기존 Plan 비율을 유지합니다.")}</p></div>
        <div className="mt-5 grid gap-2"><button type="button" disabled={saving || !parsed || !dirty} onClick={() => void save()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[var(--foreground)] px-4 text-xs font-semibold text-[var(--background)] disabled:opacity-40"><Save size={16} aria-hidden="true" />{saving ? t("저장 중...") : t("Allocation 저장")}</button><button type="button" disabled={saving || !dirty} onClick={reset} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-4 text-xs font-semibold disabled:opacity-40"><RotateCcw size={15} aria-hidden="true" />{t("Reset")}</button>{stored && <button type="button" disabled={saving} onClick={() => void disable()} className="min-h-10 rounded-lg border px-4 text-xs font-semibold text-red-700 disabled:opacity-40 dark:text-red-300">{t("Allocation 사용 안 함")}</button>}</div>
        <Link href="/portfolio/plan" className="mt-4 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent-soft)] px-4 text-xs font-semibold text-[var(--accent)]">{t("Plan에서 계산 확인")}<ArrowRight size={15} aria-hidden="true" /></Link>
      </aside>
    </div>
  </div>;
}

function AllocationPercentageInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  return <label htmlFor={id} className="block"><span className="mb-1 block text-xs font-medium text-[var(--muted)]">{label}</span><span className="flex h-11 items-center overflow-hidden rounded-lg border bg-[var(--surface)]"><input id={id} aria-label={`${label} (%)`} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} className="h-full min-w-0 flex-1 border-0 bg-transparent pl-3 pr-1 text-right text-sm tabular-nums outline-none" /><span aria-hidden="true" className="pr-3 text-xs text-[var(--muted)]">%</span></span></label>;
}

function allocationDraftFromPolicy(policy: PortfolioBalancePolicy | null | undefined): AllocationDraft {
  const weights = policy?.targetWeightsBps ?? { savings: 3000, stocks: 6000, bonds: 1000 };
  return {
    mode: policy?.mode ?? "balanceAssist",
    targetInputs: Object.fromEntries(portfolioPlanCategories.map((category) => [category, formatBpsInput(weights[category])])) as AllocationDraft["targetInputs"],
    toleranceInput: formatBpsInput(policy?.toleranceBps ?? 500),
  };
}

function parseAllocationDraft(draft: AllocationDraft): PortfolioBalancePolicy | null {
  const weights = Object.fromEntries(portfolioPlanCategories.map((category) => [category, parsePercentageToBps(draft.targetInputs[category])])) as Record<(typeof portfolioPlanCategories)[number], number | null>;
  const toleranceBps = parsePercentageToBps(draft.toleranceInput);
  if (toleranceBps === null || portfolioPlanCategories.some((category) => weights[category] === null)) return null;
  const targetWeightsBps = weights as PortfolioBalancePolicy["targetWeightsBps"];
  if (portfolioPlanCategories.reduce((sum, category) => sum + targetWeightsBps[category], 0) !== 10000) return null;
  return { version: 1, mode: draft.mode, targetWeightsBps, toleranceBps, updatedAt: new Date().toISOString() };
}

function sameBalancePolicy(left: PortfolioBalancePolicy | null, right: PortfolioBalancePolicy | null) {
  if (!left || !right) return left === right;
  return left.mode === right.mode && left.toleranceBps === right.toleranceBps && portfolioPlanCategories.every((category) => left.targetWeightsBps[category] === right.targetWeightsBps[category]);
}

function formatBps(bps: number) {
  const whole = Math.floor(bps / 100);
  const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

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
