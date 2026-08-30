"use client";

import { ArrowRight, ChevronDown, ChevronRight, Info, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { currencies, minorUnitsToMajor, type Currency, type RatesToKrw } from "@/domain/currency";
import { buildPortfolioBalanceSnapshot, suggestContributionBalance, type PortfolioContributionBalanceSuggestion } from "@/domain/portfolio-balance";
import type { ContributionPlanCalculation } from "@/domain/portfolio-contribution";
import type { TradingLedger } from "@/domain/trading-ledger";
import { formatCurrency } from "@/domain/money";
import type { InvestmentAccount } from "@/features/accounts/types";
import { RegisteredStockPicker } from "@/features/stocks/registered-stock-picker";
import type { Stock } from "@/features/stocks/types";
import { useStockStore } from "@/features/stocks/use-stock-store";
import { useI18n } from "@/i18n/i18n-provider";
import { useExchangeRates } from "@/lib/use-exchange-rates";
import { useLocalCollection } from "@/lib/use-local-collection";
import { usePortfolioShell } from "@/features/portfolio-shell/portfolio-shell";
import {
  classifyPortfolioPlanChanges,
  calculatePortfolioPlanDraft,
  formatBpsInput,
  formatEffectiveAllocation,
  parseMajorAmountToMinor,
  parsePercentageToBps,
  portfolioPlanCategories,
  portfolioPlanCategoryName,
  portfolioPlanCategoryTargetType,
  portfolioPlanCategoryWeights,
  portfolioPlanDraftFromActive,
  portfolioTargetAllocationCategoryName,
  validatePortfolioPlanEditorDraft,
  withPortfolioPlanCategoryWeights,
  withPortfolioStockTargetWeights,
  type PortfolioPlanEditorDraft,
  type PortfolioPlanEditorGroup,
  type PortfolioPlanEditorTarget,
} from "./portfolio-plan-draft";
import {
  buildPortfolioPlanRepairActivation,
  isLegacyPortfolioPlanV6Data,
  migratePortfolioPlanV6,
  persistPortfolioPlanRepairActivation,
  persistPortfolioPlanV6Migration,
} from "./portfolio-plan-migration";
import {
  buildPortfolioContributionUpdate,
  buildPortfolioPlanActivation,
  persistPortfolioContributionUpdate,
  persistPortfolioPlanActivation,
} from "./portfolio-plan-mutation";
import type {
  LegacyPortfolioAllocationTargetV6,
  LegacyPortfolioPlanRevisionV6,
  LegacyPortfolioPlanStateV6,
  PortfolioAllocationGroup,
  PortfolioAllocationTarget,
  PortfolioPlanRevision,
  PortfolioPlanState,
} from "./types";

export function PortfolioPlanPageClient() {
  const { t } = useI18n();
  const stockStore = useStockStore();
  const exchangeRates = useExchangeRates();
  const stateStore = useLocalCollection<PortfolioPlanState | LegacyPortfolioPlanStateV6>("portfolio-plan-state", []);
  const revisionStore = useLocalCollection<PortfolioPlanRevision | LegacyPortfolioPlanRevisionV6>("portfolio-plan-revisions", []);
  const groupStore = useLocalCollection<PortfolioAllocationGroup>("portfolio-allocation-groups", []);
  const targetStore = useLocalCollection<PortfolioAllocationTarget | LegacyPortfolioAllocationTargetV6>("portfolio-allocation-targets", []);
  const [migrationError, setMigrationError] = useState("");
  const [notice, setNotice] = useState("");
  const migrationStarted = useRef(false);
  const repairUpgradeStarted = useRef(false);
  const legacy = isLegacyPortfolioPlanV6Data({ states: stateStore.allItems, revisions: revisionStore.allItems, targets: targetStore.allItems });
  const ready = stockStore.ready && exchangeRates.ready && stateStore.ready && revisionStore.ready && groupStore.ready && targetStore.ready;
  const repairState = !legacy ? (stateStore.allItems as PortfolioPlanState[])[0]?.repairDraft ? (stateStore.allItems as PortfolioPlanState[])[0]! : null : null;

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
        stateStore.applyCommitted(migration.states);
        revisionStore.applyCommitted(migration.revisions);
        groupStore.applyCommitted(migration.groups);
        targetStore.applyCommitted(migration.targets);
      } catch {
        setMigrationError(t("포트폴리오 계획을 저장하지 못했습니다. 다시 시도해 주세요."));
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
        applyActivation({ stateStore, revisionStore, groupStore, targetStore }, activation);
      } catch {
        setMigrationError(t("포트폴리오 계획을 저장하지 못했습니다. 다시 시도해 주세요."));
      }
    })();
  }, [groupStore, legacy, ready, repairState, revisionStore, stateStore, stockStore.accounts, stockStore.allStocks, t, targetStore]);

  const loadError = migrationError || stockStore.loadError || stateStore.loadError || revisionStore.loadError || groupStore.loadError || targetStore.loadError;
  if (!ready || (legacy || repairState) && !loadError) return <PlanLoading />;
  if (loadError) return <PlanLoadError message={loadError} />;

  const states = stateStore.allItems as PortfolioPlanState[];
  const revisions = revisionStore.allItems as PortfolioPlanRevision[];
  const targets = targetStore.allItems as PortfolioAllocationTarget[];
  const state = states[0] ?? null;
  const activeRevision = revisions.find((revision) => revision.id === state?.activeRevisionId) ?? null;
  const stores = { stateStore, revisionStore, groupStore, targetStore };
  return <>{notice && <p role="status" className="mb-5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">{notice}</p>}<PortfolioPlanEditor key={`plan:${state?.updatedAt ?? "empty"}:${activeRevision?.id ?? "none"}`} state={state} activeRevision={activeRevision} revisions={revisions} groups={groupStore.allItems} targets={targets} stocks={stockStore.allStocks} accounts={stockStore.accounts} ledger={stockStore.ledger} ratesToKrw={exchangeRates.snapshot.ratesToKrw} stores={stores} onSaved={(message) => setNotice(message)} onChange={() => setNotice("")} /></>;
}

type PlanStores = {
  stateStore: ReturnType<typeof useLocalCollection<PortfolioPlanState | LegacyPortfolioPlanStateV6>>;
  revisionStore: ReturnType<typeof useLocalCollection<PortfolioPlanRevision | LegacyPortfolioPlanRevisionV6>>;
  groupStore: ReturnType<typeof useLocalCollection<PortfolioAllocationGroup>>;
  targetStore: ReturnType<typeof useLocalCollection<PortfolioAllocationTarget | LegacyPortfolioAllocationTargetV6>>;
};

function PortfolioPlanEditor({ state, activeRevision, revisions, groups, targets, stocks, accounts, ledger, ratesToKrw, stores, onSaved, onChange }: {
  state: PortfolioPlanState | null;
  activeRevision: PortfolioPlanRevision | null;
  revisions: PortfolioPlanRevision[];
  groups: PortfolioAllocationGroup[];
  targets: PortfolioAllocationTarget[];
  stocks: Stock[];
  accounts: InvestmentAccount[];
  ledger: TradingLedger;
  ratesToKrw: RatesToKrw;
  stores: PlanStores;
  onSaved: (message: string) => void;
  onChange: () => void;
}) {
  const { t, localeTag, formatNumber } = useI18n();
  const { snapshot } = usePortfolioShell();
  const fallbackCurrency = snapshot.status === "ready" ? snapshot.portfolio.baseCurrency : "KRW";
  const savedDraft = useMemo(() => portfolioPlanDraftFromActive({ state, revision: activeRevision, groups, targets, fallbackCurrency }), [activeRevision, fallbackCurrency, groups, state, targets]);
  const [draft, setDraft] = useState<PortfolioPlanEditorDraft>(savedDraft);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => initialGroupExpansion(savedDraft));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const validation = useMemo(() => validatePortfolioPlanEditorDraft(draft, stocks, accounts), [accounts, draft, stocks]);
  const changeKind = useMemo(() => classifyPortfolioPlanChanges({ draft, saved: savedDraft, hasActiveRevision: Boolean(activeRevision) }), [activeRevision, draft, savedDraft]);
  const baseWeights = useMemo(() => portfolioPlanCategoryWeights(draft), [draft]);
  const bondStockIds = useMemo(() => new Set(savedDraft.groups.find((group) => group.category === "bonds")?.targets.flatMap((target) => target.stockId ? [target.stockId] : []) ?? []), [savedDraft]);
  const balanceSnapshot = useMemo(() => buildPortfolioBalanceSnapshot({ ledger, stocks, ratesToKrw, bondStockIds }), [bondStockIds, ledger, ratesToKrw, stocks]);
  const contributionAmountMinor = parseMajorAmountToMinor(draft.contributionAmountInput, draft.contributionCurrency);
  const balanceSuggestion = useMemo(() => baseWeights && contributionAmountMinor !== null ? suggestContributionBalance({ snapshot: balanceSnapshot, policy: state?.balancePolicy, baseWeightsBps: baseWeights, contributionAmountMinor, contributionCurrency: draft.contributionCurrency, ratesToKrw }) : null, [balanceSnapshot, baseWeights, contributionAmountMinor, draft.contributionCurrency, ratesToKrw, state?.balancePolicy]);
  const suggestionKey = balanceSuggestion ? `${balanceSuggestion.source}:${portfolioPlanCategories.map((category) => balanceSuggestion.weightsBps[category]).join(":")}:${draft.contributionAmountInput}:${draft.contributionCurrency}` : "none";
  const suggestedExecutionInputs = useMemo(() => suggestionInputs(balanceSuggestion, draft), [balanceSuggestion, draft]);
  const [executionOverride, setExecutionOverride] = useState<{ key: string; inputs: Record<(typeof portfolioPlanCategories)[number], string> } | null>(null);
  const executionInputs = executionOverride?.key === suggestionKey ? executionOverride.inputs : suggestedExecutionInputs;
  const balanceAssistActive = state?.balancePolicy?.mode === "balanceAssist";
  const categoryExecutionDraft = useMemo(() => balanceAssistActive ? withPortfolioPlanCategoryWeights(draft, executionInputs) : draft, [balanceAssistActive, draft, executionInputs]);
  const executionDraft = useMemo(() => withPortfolioStockTargetWeights(categoryExecutionDraft, state?.balancePolicy?.stockTargets), [categoryExecutionDraft, state?.balancePolicy?.stockTargets]);
  const executionValidation = useMemo(() => validatePortfolioPlanEditorDraft(executionDraft, stocks, accounts), [accounts, executionDraft, stocks]);
  const calculation = useMemo(() => calculatePortfolioPlanDraft(executionDraft), [executionDraft]);
  const activeAccounts = accounts.filter((account) => !account.archivedAt);
  const activeStocks = stocks.filter((stock) => !stock.deletedAt);
  const targetCount = draft.groups.reduce((count, group) => count + group.targets.length, 0);
  const revisionLabel = changeKind === "initial"
    ? t("활성화 Draft")
    : changeKind === "revision"
      ? t("새 Revision Draft")
      : activeRevision
        ? t("리비전 {number}", { number: formatNumber(activeRevision.revisionNumber) })
        : t("활성화 Draft");

  function updateGroup(groupId: string, update: (group: PortfolioPlanEditorGroup) => PortfolioPlanEditorGroup) {
    setDraft((current) => ({ ...current, groups: current.groups.map((group) => group.id === groupId ? update(group) : group) }));
    clearFeedback();
  }
  function updateTarget(groupId: string, targetId: string, update: (target: PortfolioPlanEditorTarget) => PortfolioPlanEditorTarget) {
    updateGroup(groupId, (group) => ({ ...group, targets: group.targets.map((target) => target.id === targetId ? update(target) : target) }));
  }
  function addTarget(groupId: string) {
    updateGroup(groupId, (group) => {
      const currentTotal = group.targets.reduce((sum, target) => sum + (parsePercentageToBps(target.weightInput) ?? 0), 0);
      const targetType = portfolioPlanCategoryTargetType(group.category);
      return { ...group, targets: [...group.targets, { id: draftId("target"), targetType, stockId: null, accountId: "", weightInput: formatBpsInput(Math.max(0, 10000 - currentTotal)), sortOrder: group.targets.length }] };
    });
  }
  function deleteTarget(groupId: string, target: PortfolioPlanEditorTarget) {
    if (!window.confirm(t("이 Target을 삭제할까요?"))) return;
    updateGroup(groupId, (group) => ({ ...group, targets: reindex(group.targets.filter((item) => item.id !== target.id)) }));
  }
  function reset() {
    setDraft(savedDraft);
    setExecutionInputs(suggestionInputs(balanceSuggestion, savedDraft));
    setExpanded(initialGroupExpansion(savedDraft));
    setSaveError("");
    onChange();
  }
  function clearFeedback() { setSaveError(""); onChange(); }
  function setExecutionInputs(update: Record<(typeof portfolioPlanCategories)[number], string> | ((current: Record<(typeof portfolioPlanCategories)[number], string>) => Record<(typeof portfolioPlanCategories)[number], string>)) {
    setExecutionOverride((current) => {
      const base = current?.key === suggestionKey ? current.inputs : suggestedExecutionInputs;
      return { key: suggestionKey, inputs: typeof update === "function" ? update(base) : update };
    });
  }

  async function savePlan(event: FormEvent) {
    event.preventDefault();
    if (saving || !validation.parsed || changeKind === "none") return;
    setSaving(true); setSaveError(""); onChange();
    try {
      if (changeKind === "contribution") {
        const update = buildPortfolioContributionUpdate({ state, contributionAmountMinor: validation.parsed.contributionAmountMinor, contributionCurrency: validation.parsed.contributionCurrency });
        await persistPortfolioContributionUpdate(update);
        stores.stateStore.applyCommitted(update.states);
      } else {
        const activation = buildPortfolioPlanActivation({
          states: state ? [state] : [], revisions, groups, targets, stocks, accounts,
          draftGroups: validation.parsed.groups,
          draftTargets: validation.parsed.targets,
          contributionAmountMinor: validation.parsed.contributionAmountMinor,
          contributionCurrency: validation.parsed.contributionCurrency,
          thesis: validation.parsed.thesis,
          changeNote: activeRevision ? validation.parsed.changeNote : "",
        });
        await persistPortfolioPlanActivation(activation);
        applyActivation(stores, activation);
      }
      onSaved(changeKind === "contribution" ? t("Contribution Amount를 저장했습니다.") : t("Contribution Plan을 저장하고 활성화했습니다."));
    } catch {
      setSaveError(t("포트폴리오 계획을 저장하지 못했습니다. 다시 시도해 주세요."));
    } finally { setSaving(false); }
  }

  const saveLabel = saving ? t("저장 중...") : changeKind === "initial" ? t("Plan 활성화") : changeKind === "revision" ? t("새 리비전 저장") : changeKind === "contribution" ? t("Contribution 저장") : t("변경사항 저장");

  return <form onSubmit={savePlan} noValidate className="portfolio-plan-form">
    <PlanHeader dirty={changeKind !== "none"} balanceAssist={balanceAssistActive} />
    {saveError && <p role="alert" className="mt-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">{saveError}</p>}
    <div className="portfolio-plan-layout">
      <div className="portfolio-plan-editor">
        <ContributionAmountEditor draft={draft} setDraft={setDraft} error={validation.fields.contributionAmount} onChange={clearFeedback} groupInputs={executionDraft.groups.map((group) => group.weightInput)} targetCount={targetCount} revisionLabel={revisionLabel} />

        <AllocationPlanBridge policy={state?.balancePolicy ?? null} snapshot={balanceSnapshot} suggestion={balanceSuggestion} />

        <section aria-labelledby="target-allocation-title" className="portfolio-plan-card portfolio-plan-allocation-card">
          <header className="portfolio-plan-allocation-header">
            <div className="min-w-0">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">{t("02 · Target Allocation")}</p>
              <h2 id="target-allocation-title" className="mt-1 text-lg font-semibold">{t("저축 비율과 세부 항목 설정")}</h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--muted)]">{t("적금·주식·채권 비율의 합계는 100%여야 합니다. 사용하지 않는 카테고리는 0%로 두세요.")}</p>
            </div>
          </header>
          {executionValidation.fields.groups && <div className="px-4 sm:px-5"><FieldError message={executionValidation.fields.groups} /></div>}
          {balanceAssistActive && <p className="mx-4 mb-3 rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-xs leading-5 text-[var(--accent)] sm:mx-5">{t("균형 맞추기 제안값입니다. 이번 저축에 한해 직접 수정할 수 있으며 저장된 기본 Plan 비율은 바뀌지 않습니다.")}</p>}
          <div className="portfolio-plan-group-list">{executionDraft.groups.slice().sort(byOrder).map((group) => {
              const groupErrorPath = `groups.${group.id}`;
              const groupAmount = calculation?.groups.find((item) => item.groupId === group.id)?.amountMinor;
              const groupLabel = t(portfolioPlanCategoryName(group.category));
              return <article key={group.id} className={`portfolio-plan-group ${expanded[group.id] ? "is-expanded" : ""}`} style={{ "--portfolio-group-accent": groupAccentColor(group.category) } as CSSProperties}>
                <div className="portfolio-plan-group-header">
                  <button type="button" aria-expanded={Boolean(expanded[group.id])} aria-label={t("{name} 카테고리 펼치기", { name: groupLabel })} onClick={() => setExpanded((current) => ({ ...current, [group.id]: !current[group.id] }))} className="grid size-10 place-items-center rounded-lg bg-[var(--surface-muted)] text-[var(--muted)]"><ChevronRight size={18} aria-hidden="true" className={`transition-transform ${expanded[group.id] ? "rotate-90" : ""}`} /></button>
                  <div className="portfolio-plan-group-name is-fixed"><span aria-hidden="true" /><strong>{groupLabel}</strong><small>{t("고정 카테고리")}</small></div>
                  <PercentageInput label={t("전체 저축액 중 비율")} value={group.weightInput} onChange={(value) => balanceAssistActive ? setExecutionInputs((current) => ({ ...current, [group.category]: value })) : updateGroup(group.id, (current) => ({ ...current, weightInput: value }))} error={executionValidation.fields[`${groupErrorPath}.weight`]} />
                  <div className="portfolio-plan-group-amount"><ReadOnlyMetric label={t("Contribution 금액")} value={groupAmount === undefined ? "—" : formatCurrency(minorUnitsToMajor(groupAmount, draft.contributionCurrency), draft.contributionCurrency, localeTag)} compact /></div>
                  <GroupStatusPill groupWeight={group.weightInput} inputs={group.targets.map((target) => target.weightInput)} count={group.targets.length} />
                </div>
                {expanded[group.id] && <div className="portfolio-plan-targets">
                  <div className="portfolio-plan-target-head"><span>{t("Target")}</span><span>{t("Account")}</span><span>{t("Within Group")}</span><span className="text-right">{t("유효 배분")}</span><span className="text-right">{t("Contribution 금액")}</span><span /></div>
                  <div>{group.targets.slice().sort(byOrder).map((target) => <TargetEditor key={target.id} group={group} target={target} update={updateTarget} remove={deleteTarget} activeStocks={activeStocks} activeAccounts={activeAccounts} validation={executionValidation.fields} calculation={calculation} currency={draft.contributionCurrency} />)}</div>
                  <div className="portfolio-plan-target-actions"><button type="button" onClick={() => addTarget(group.id)}><Plus size={14} aria-hidden="true" />{t(group.category === "savings" ? "적금 계좌 추가" : group.category === "stocks" ? "주식 종목 추가" : "채권 종목 추가")}</button></div>
                  {(executionValidation.fields[`${groupErrorPath}.targets`] || executionValidation.fields[`${groupErrorPath}.targetTotal`]) && <div className="border-t px-3 pb-3">{executionValidation.fields[`${groupErrorPath}.targets`] && <FieldError message={executionValidation.fields[`${groupErrorPath}.targets`]} />}{executionValidation.fields[`${groupErrorPath}.targetTotal`] && <FieldError message={executionValidation.fields[`${groupErrorPath}.targetTotal`]} />}</div>}
                </div>}
              </article>;
            })}</div>
          <details className="group portfolio-plan-thesis">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-4 font-medium"><span>{t("Investment Thesis와 Change Note")} <span className="font-normal text-[var(--muted)]">· {t("선택 사항")}</span></span><ChevronDown size={17} aria-hidden="true" className="text-[var(--muted)] transition-transform group-open:rotate-180" /></summary>
          <div className="grid gap-4 border-t p-4 sm:p-5 lg:grid-cols-2"><label className="text-sm font-medium">{t("투자 근거 (선택)")}<textarea value={draft.thesis} onChange={(event) => { setDraft((current) => ({ ...current, thesis: event.target.value })); clearFeedback(); }} rows={4} className="mt-1 w-full resize-y rounded-lg border bg-[var(--surface)] p-3 font-normal" /></label>{activeRevision && changeKind === "revision" && <label className="text-sm font-medium">{t("변경 이유 (선택)")}<textarea value={draft.changeNote} onChange={(event) => setDraft((current) => ({ ...current, changeNote: event.target.value }))} rows={4} className="mt-1 w-full resize-y rounded-lg border bg-[var(--surface)] p-3 font-normal" /></label>}</div>
          </details>
        </section>
      </div>

      <div className="portfolio-plan-summary-sticky">
        <ContributionExecutionSummary draft={executionDraft} calculation={calculation} stocks={stocks} accounts={accounts} validationMessages={executionValidation.summary} executionValid={executionValidation.valid} saveValid={validation.valid} saving={saving} changeKind={changeKind} reset={reset} saveLabel={saveLabel} balanceAssist={balanceAssistActive} />
      </div>
    </div>
  </form>;
}

function PlanHeader({ dirty, balanceAssist }: { dirty: boolean; balanceAssist: boolean }) {
  const { t } = useI18n();
  return <div className="portfolio-plan-heading"><div><p>{t("Contribution Plan")}</p><h1>{t("월 저축액을 적금·주식·채권으로 나눠보세요.")}</h1><span>{t("총 저축액과 비율을 입력하면 각 계좌와 종목에 넣을 금액을 자동으로 계산합니다.")}</span></div><div className="portfolio-plan-heading-badges">{balanceAssist && <span className="portfolio-plan-mode-badge">{t("균형 맞추기")}</span>}{dirty && <span className="portfolio-plan-dirty-badge"><i aria-hidden="true" />{t("저장되지 않은 변경")}</span>}</div></div>;
}

function ContributionAmountEditor({ draft, setDraft, error, onChange, groupInputs, targetCount, revisionLabel }: { draft: PortfolioPlanEditorDraft; setDraft: React.Dispatch<React.SetStateAction<PortfolioPlanEditorDraft>>; error?: string; onChange: () => void; groupInputs?: string[]; targetCount?: number; revisionLabel?: string }) {
  const { t } = useI18n();
  const amountId = useId();
  const currencyId = useId();
  const errorId = `${amountId}-error`;
  const values = (groupInputs ?? []).map(parsePercentageToBps);
  const invalidTotal = values.some((value) => value === null);
  const totalBps = values.reduce<number>((total, value) => total + (value ?? 0), 0);
  const showSummary = groupInputs !== undefined && targetCount !== undefined && revisionLabel !== undefined;
  return <section aria-labelledby={`${amountId}-title`} className="portfolio-plan-card portfolio-plan-contribution-card">
    <div className="portfolio-plan-contribution-content">
      <div className="portfolio-plan-contribution-copy"><p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">{t("01 · 전체 저축액")}</p><h2 id={`${amountId}-title`} className="mt-1 text-lg font-semibold">{t("이번에 저축할 총금액은 얼마인가요?")}</h2><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("총 저축액만 바꾸면 기존 비율을 그대로 사용하며 새 Revision을 만들지 않습니다.")}</p></div>
      <div className="portfolio-plan-contribution-control">
        <div className="portfolio-plan-amount-control">
          <label htmlFor={amountId} className="sr-only">{t("전체 저축액")}</label>
          <input id={amountId} value={draft.contributionAmountInput} inputMode="decimal" onChange={(event) => { setDraft((current) => ({ ...current, contributionAmountInput: event.target.value })); onChange(); }} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} />
          <label htmlFor={currencyId} className="sr-only">{t("통화")}</label>
          <select id={currencyId} value={draft.contributionCurrency} onChange={(event) => { const currency = event.target.value as Currency; setDraft((current) => ({ ...current, contributionCurrency: currency })); onChange(); }}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select>
        </div>
        {error && <span id={errorId} className="mt-1 block text-xs text-red-700 dark:text-red-300">{t(error)}</span>}
        <p className="portfolio-plan-amount-help">{t("금액은 통화별 minor unit 정수로 저장됩니다. KRW와 JPY는 정수, 그 외 통화는 소수점 둘째 자리까지 입력할 수 있습니다.")}</p>
      </div>
    </div>
    {showSummary && <dl className="portfolio-plan-contribution-stats" aria-live="polite">
      <SummaryStat label={t("Group 배분")} value={invalidTotal ? "—" : `${formatBpsAny(totalBps)}%`} tone={!invalidTotal && totalBps === 10000 ? "good" : "warning"} />
      <SummaryStat label={t("Target 수")} value={String(targetCount)} />
      <SummaryStat label={t("Revision")} value={revisionLabel} />
    </dl>}
  </section>;
}

function AllocationPlanBridge({ policy, snapshot, suggestion }: {
  policy: PortfolioPlanState["balancePolicy"];
  snapshot: ReturnType<typeof buildPortfolioBalanceSnapshot>;
  suggestion: PortfolioContributionBalanceSuggestion | null;
}) {
  const { t, formatNumber } = useI18n();
  const currentByCategory = new Map(snapshot.categories.map((row) => [row.category, row.currentWeightBps]));
  const suggestionLabel = suggestion?.source === "balanced" ? t("현재 자산의 차이를 줄이도록 이번 저축 비율을 제안했습니다.")
    : suggestion?.source === "withinTolerance" ? t("허용 오차 안에 있어 저장된 기본 Plan 비율을 그대로 사용합니다.")
      : suggestion?.source === "unavailable" ? t("현재 자산 평가를 사용할 수 없어 저장된 기본 Plan 비율을 그대로 사용합니다.")
        : t("저장된 기본 Plan 비율을 사용합니다.");
  return <section aria-labelledby="allocation-connection-title" className="portfolio-plan-card p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0"><p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">{t("Allocation 연결")}</p><h2 id="allocation-connection-title" className="mt-1 text-lg font-semibold">{t("전체 자산 목표를 이번 저축 계산에 반영")}</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--muted)]">{t("Allocation에서 저장한 목표를 기준으로 이번 저축 비율을 계산합니다.")}</p></div>
      <Link href="/portfolio/allocation" className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 text-xs font-semibold">{t(policy ? "Allocation에서 수정" : "Allocation 설정")}<ArrowRight size={15} aria-hidden="true" /></Link>
    </div>
    {!policy ? <p className="mt-4 rounded-lg bg-[var(--surface-muted)] px-3 py-3 text-xs leading-5 text-[var(--muted)]">{t("Allocation이 설정되지 않아 저장된 Contribution Plan 비율을 사용합니다.")}</p> : <>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">{portfolioPlanCategories.map((category) => {
        const current = currentByCategory.get(category);
        return <div key={category} className="rounded-xl border bg-[var(--surface-muted)] p-3"><p className="text-xs font-semibold">{t(portfolioTargetAllocationCategoryName(category))}</p><dl className="mt-2 grid grid-cols-2 gap-2 text-[0.7rem]"><div><dt className="text-[var(--muted)]">{t("목표 비중")}</dt><dd className="mt-1 font-semibold tabular-nums">{formatBpsAny(policy.targetWeightsBps[category])}%</dd></div><div><dt className="text-[var(--muted)]">{t("현재 비중")}</dt><dd className="mt-1 font-semibold tabular-nums">{current === null || current === undefined ? "—" : `${formatNumber(current / 100, { maximumFractionDigits: 2 })}%`}</dd></div></dl></div>;
      })}</div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-xs leading-5 text-[var(--accent)]"><span>{suggestionLabel}</span><div className="flex items-center gap-2"><b>{t(policy.mode === "balanceAssist" ? "균형 맞추기" : "고정 비율")}</b>{policy.stockTargets?.length ? <span>{t("주식 세부 목표 {count}개", { count: policy.stockTargets.length })}</span> : null}</div></div>
    </>}
  </section>;
}

function TargetEditor({ group, target, update, remove, activeStocks, activeAccounts, validation, calculation, currency }: { group: PortfolioPlanEditorGroup; target: PortfolioPlanEditorTarget; update: (groupId: string, targetId: string, update: (target: PortfolioPlanEditorTarget) => PortfolioPlanEditorTarget) => void; remove: (groupId: string, target: PortfolioPlanEditorTarget) => void; activeStocks: Stock[]; activeAccounts: InvestmentAccount[]; validation: Record<string, string>; calculation: ContributionPlanCalculation | null; currency: Currency }) {
  const { t, localeTag } = useI18n();
  const path = `groups.${group.id}.targets.${target.id}`;
  const amount = calculation?.targets.find((item) => item.targetId === target.id)?.amountMinor;
  const groupBps = parsePercentageToBps(group.weightInput);
  const targetBps = parsePercentageToBps(target.weightInput);
  return <div className="portfolio-plan-target-row">
    <div className="col-start-1 row-start-1 min-w-0 lg:col-auto lg:row-auto"><span className="mb-1 block text-xs font-medium text-[var(--muted)] lg:sr-only">{t("Target")}</span>{target.targetType === "stock" ? <><RegisteredStockPicker stocks={activeStocks} value={target.stockId} onChange={(stockId) => update(group.id, target.id, (current) => ({ ...current, stockId }))} ariaLabel={t(group.category === "bonds" ? "채권 종목" : "주식 종목")} required />{validation[`${path}.stock`] && <FieldError message={validation[`${path}.stock`]} />}</> : <div className="flex h-10 items-center rounded-lg bg-[var(--surface-muted)] px-3 text-sm font-medium">{t("적금 계좌")}</div>}</div>
    <div className="col-start-2 row-start-1 min-w-0 lg:col-auto lg:row-auto"><AccountSelect label={`${t(group.category === "savings" ? "은행 / 계좌" : "투자 계좌")} · ${t("선택 사항")}`} accounts={activeAccounts} value={target.accountId} onChange={(accountId) => update(group.id, target.id, (current) => ({ ...current, accountId }))} error={validation[`${path}.account`]} compact /></div>
    <div className="col-span-2 col-start-1 row-start-2 lg:col-auto lg:row-auto"><PercentageInput label={t("Within Group")} value={target.weightInput} onChange={(value) => update(group.id, target.id, (current) => ({ ...current, weightInput: value }))} error={validation[`${path}.weight`]} compact /></div>
    <div className="hidden lg:block"><TargetMetric label={t("유효 배분")} value={groupBps === null || targetBps === null ? "—" : formatEffectiveAllocation(groupBps, targetBps)} /></div>
    <div className="col-span-2 col-start-1 row-start-3 lg:col-auto lg:row-auto"><TargetMetric label={t("Contribution 금액")} value={amount === undefined ? "—" : formatCurrency(minorUnitsToMajor(amount, currency), currency, localeTag)} prominent /></div>
    <div className="col-start-3 row-start-1 flex justify-end lg:col-auto lg:row-auto lg:items-center"><button type="button" aria-label={t("이 Target 삭제")} onClick={() => remove(group.id, target)} className="grid size-10 place-items-center rounded-lg text-red-700 hover:bg-red-50 dark:text-red-300"><Trash2 size={17} aria-hidden="true" /></button></div>
  </div>;
}

function ContributionExecutionSummary({ draft, calculation, stocks, accounts, validationMessages, executionValid, saveValid, saving, changeKind, reset, saveLabel, balanceAssist }: {
  draft: PortfolioPlanEditorDraft;
  calculation: ContributionPlanCalculation | null;
  stocks: readonly Stock[];
  accounts: readonly InvestmentAccount[];
  validationMessages: string[];
  executionValid: boolean;
  saveValid: boolean;
  saving: boolean;
  changeKind: ReturnType<typeof classifyPortfolioPlanChanges>;
  reset: () => void;
  saveLabel: string;
  balanceAssist: boolean;
}) {
  const { t, localeTag } = useI18n();
  const stockById = new Map(stocks.map((stock) => [stock.id, stock]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const groupById = new Map(draft.groups.map((group) => [group.id, group]));
  const targetById = new Map(draft.groups.flatMap((group) => group.targets).map((target) => [target.id, target]));
  const amountMinor = parseMajorAmountToMinor(draft.contributionAmountInput, draft.contributionCurrency);
  const formattedAmount = amountMinor === null ? "—" : formatCurrency(minorUnitsToMajor(amountMinor, draft.contributionCurrency), draft.contributionCurrency, localeTag);
  const formattedTotal = calculation ? formatCurrency(minorUnitsToMajor(calculation.contributionAmountMinor, calculation.contributionCurrency), calculation.contributionCurrency, localeTag) : "—";
  return <aside aria-labelledby="this-contribution-title" className="portfolio-plan-summary">
    <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[var(--accent)]">{t("03 · 계산 결과")}</p>
    <h2 id="this-contribution-title" className="mt-1 text-lg font-semibold">{t("이번 저축 실행표")}</h2>
    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("계산된 금액을 은행 또는 증권 계좌에서 직접 실행하세요.")}</p>
    {balanceAssist && <p className="mt-3 rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-[0.7rem] leading-5 text-[var(--accent)]">{t("균형 맞추기 Draft · 수정값은 이번 계산에만 적용됩니다.")}</p>}
    <div className="portfolio-plan-summary-amount">
      <span className="text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{t("전체 저축액")}</span>
      <strong className="mt-1 block text-2xl font-semibold tracking-tight tabular-nums">{formattedAmount}</strong>
    </div>
    {!calculation ? <p className="mt-4 rounded-lg border border-dashed px-3 py-6 text-center text-xs leading-5 text-[var(--muted)]">{t("유효한 Plan을 입력하면 정확한 실행 금액을 표시합니다.")}</p> : <div className="portfolio-plan-summary-rows" aria-live="polite">{calculation.targets.map((row) => {
      const target = targetById.get(row.targetId);
      const stock = row.stockId ? stockById.get(row.stockId) : null;
      const group = groupById.get(row.groupId);
      const groupBps = parsePercentageToBps(group?.weightInput ?? "");
      const targetBps = parsePercentageToBps(target?.weightInput ?? "");
      const allocation = groupBps === null || targetBps === null ? "—" : formatEffectiveAllocation(groupBps, targetBps);
      const account = row.accountId ? accountById.get(row.accountId) : undefined;
      const targetName = row.targetType === "cash" ? accountLabel(account, t("적금 계좌")) : stock ? `${stock.ticker} · ${stock.name}` : t("알 수 없는 종목");
      const groupName = group ? t(portfolioPlanCategoryName(group.category)) : "—";
      return <div key={row.targetId} className="portfolio-plan-summary-row"><div className="min-w-0"><b className="block truncate font-medium" title={targetName}>{targetName}</b><span className="mt-1 block truncate text-[0.7rem] text-[var(--muted)]" title={`${groupName} · ${accountLabel(account, "—")} · ${allocation}`}>{groupName} · {accountLabel(account, "—")} · {allocation}</span></div><strong>{formatCurrency(minorUnitsToMajor(row.amountMinor, draft.contributionCurrency), draft.contributionCurrency, localeTag)}</strong></div>;
    })}</div>}
    <div aria-label={t("합계")} className="portfolio-plan-summary-total"><span>{t("합계")}</span><strong>{formattedTotal}</strong></div>
    {!executionValid && <ValidationSummary messages={validationMessages} compact />}
    <div className="portfolio-plan-summary-actions"><button type="button" onClick={reset} disabled={saving || changeKind === "none"}><RotateCcw size={16} aria-hidden="true" />{t("Reset")}</button><button type="submit" disabled={saving || !saveValid || changeKind === "none"}><Save size={16} aria-hidden="true" />{saveLabel}</button></div>
    <div className="portfolio-plan-summary-notice"><Info size={15} aria-hidden="true" /><p>{t("Rationale은 주문을 실행하지 않습니다. 계산된 금액을 사용해 관련 은행 또는 증권 계좌에서 직접 매수하세요.")}</p></div>
    {executionValid && calculation && <p className="portfolio-plan-validity"><i aria-hidden="true" />{t("Allocation 유효 · minor-unit 합계 일치")}</p>}
  </aside>;
}

function GroupStatusPill({ groupWeight, inputs, count }: { groupWeight: string; inputs: string[]; count: number }) {
  const { t, formatNumber } = useI18n();
  const groupBps = parsePercentageToBps(groupWeight);
  const values = inputs.map(parsePercentageToBps);
  const invalid = values.some((value) => value === null);
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (groupBps === 0 && count === 0) return <span className="portfolio-plan-group-status is-muted">{t("사용 안 함 · 0%")}</span>;
  if ((groupBps ?? 0) > 0 && count === 0) return <span className="portfolio-plan-group-status is-warning">{t("세부 항목 필요")}</span>;
  const key = count === 1 ? "Target {count}개 · {value}%" : "Targets {count}개 · {value}%";
  return <span className={`portfolio-plan-group-status ${invalid || total !== 10000 ? "is-warning" : "is-valid"}`}>{t(key, { count: formatNumber(count), value: invalid ? "—" : formatBpsAny(total) })}</span>;
}

function ValidationSummary({ messages, compact = false }: { messages: string[]; compact?: boolean }) {
  const { t } = useI18n();
  const unique = [...new Set(messages)];
  const titleId = useId();
  return <section role="alert" aria-labelledby={titleId} className={`${compact ? "mt-4 p-3 text-xs" : "mt-6 p-4 text-sm"} rounded-xl border border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100`}><h2 id={titleId} className="font-semibold">{t("저장하기 전에 확인해 주세요.")}</h2><ul className="mt-2 list-disc space-y-1 pl-5">{unique.map((message) => <li key={message}>{t(message)}</li>)}</ul></section>;
}

function PercentageInput({ label, value, onChange, error, compact = false }: { label: string; value: string; onChange: (value: string) => void; error?: string; compact?: boolean }) {
  const { t } = useI18n();
  const id = useMemo(() => draftId("percentage"), []);
  const errorId = `${id}-error`;
  return <label htmlFor={id} className="block min-w-0"><span className={compact ? "mb-1 block text-xs font-medium text-[var(--muted)] lg:sr-only" : "mb-1 block text-xs font-medium text-[var(--muted)]"}>{label}</span><span className={`flex h-10 min-w-0 items-center overflow-hidden rounded-lg border bg-[var(--surface)] ${error ? "border-red-600 dark:border-red-400" : ""}`}><input id={id} value={value} inputMode="decimal" onChange={(event) => onChange(event.target.value)} aria-label={`${label} (%)`} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} className="h-full min-w-0 flex-1 border-0 bg-transparent pl-2 pr-1 text-right text-sm tabular-nums outline-none" /><span aria-hidden="true" className="pr-2 text-xs text-[var(--muted)]">%</span></span>{error && <span id={errorId} className="mt-1 block text-xs font-normal text-red-700 dark:text-red-300">{t(error)}</span>}</label>;
}
function AccountSelect({ label, accounts, value, onChange, error, compact = false }: { label: string; accounts: readonly InvestmentAccount[]; value: string; onChange: (value: string) => void; error?: string; compact?: boolean }) {
  const { t } = useI18n();
  return <label className="block min-w-0"><span className={compact ? "mb-1 block text-xs font-medium text-[var(--muted)] lg:sr-only" : "block text-sm font-medium"}>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} className={`${compact ? "" : "mt-1"} h-10 w-full min-w-0 rounded-lg border bg-[var(--surface)] px-3 text-sm font-normal`}><option value="">{t("계좌 미지정")}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account, account.name)} · {account.baseCurrency}</option>)}</select>{error && <span className="mt-1 block text-xs font-normal text-red-700 dark:text-red-300">{t(error)}</span>}</label>;
}
function ReadOnlyMetric({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) { return <div className="min-w-0"><p className="text-xs font-medium text-[var(--muted)]">{label}</p><p className={`${compact ? "bg-transparent px-0 font-semibold" : "rounded-lg bg-[var(--surface-muted)] px-3"} mt-1 min-h-10 truncate py-2.5 text-sm tabular-nums`} title={value}>{value}</p></div>; }
function SummaryStat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warning" }) { return <div className="min-w-0 border-r px-3 py-3 last:border-r-0 sm:px-4"><dt className="truncate text-[0.65rem] font-medium uppercase tracking-[0.06em] text-[var(--muted)]">{label}</dt><dd className={`mt-1 truncate text-sm font-semibold tabular-nums ${tone === "good" ? "text-emerald-700 dark:text-emerald-300" : tone === "warning" ? "text-amber-700 dark:text-amber-300" : ""}`} title={value}>{value}</dd></div>; }
function TargetMetric({ label, value, prominent = false }: { label: string; value: string; prominent?: boolean }) { return <div className="min-w-0"><span className="mb-1 block text-xs font-medium text-[var(--muted)] lg:sr-only">{label}</span><span className={`block truncate text-sm tabular-nums lg:text-right ${prominent ? "font-semibold text-[var(--accent)] lg:text-[var(--foreground)]" : "text-[var(--muted)]"}`} title={value}>{value}</span></div>; }
function FieldError({ message }: { message: string }) { const { t } = useI18n(); return <p className="mt-2 text-xs text-red-700 dark:text-red-300">{t(message)}</p>; }
function PlanLoading() { const { t } = useI18n(); return <p className="py-20 text-center text-sm text-[var(--muted)]">{t("Contribution Plan을 불러오는 중입니다.")}</p>; }
function PlanLoadError({ message }: { message: string }) { const { t } = useI18n(); return <section role="alert" className="rounded-xl border border-red-300 bg-red-50 p-6 text-center text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100"><h1 className="font-semibold">{t("Contribution Plan을 불러오지 못했습니다.")}</h1><p className="mt-2">{message}</p></section>; }

function initialGroupExpansion(draft: PortfolioPlanEditorDraft) {
  return Object.fromEntries(draft.groups.map((group) => [group.id, group.category === "stocks"]));
}
function suggestionInputs(suggestion: PortfolioContributionBalanceSuggestion | null, draft: PortfolioPlanEditorDraft) {
  const fallback = portfolioPlanCategoryWeights(draft) ?? { savings: 3000, stocks: 6000, bonds: 1000 };
  const weights = suggestion?.weightsBps ?? fallback;
  return Object.fromEntries(portfolioPlanCategories.map((category) => [category, formatBpsInput(weights[category])])) as Record<(typeof portfolioPlanCategories)[number], string>;
}
function applyActivation(stores: PlanStores, activation: { states: PortfolioPlanState[]; revisions: PortfolioPlanRevision[]; groups: PortfolioAllocationGroup[]; targets: PortfolioAllocationTarget[] }) { stores.stateStore.applyCommitted(activation.states); stores.revisionStore.applyCommitted(activation.revisions); stores.groupStore.applyCommitted(activation.groups); stores.targetStore.applyCommitted(activation.targets); }
function formatBpsAny(bps: number) { const whole = Math.floor(bps / 100); const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/, ""); return fraction ? `${whole}.${fraction}` : String(whole); }
function reindex<T extends { sortOrder: number }>(values: T[]) { return values.map((value, index) => ({ ...value, sortOrder: index })); }
function byOrder(left: { sortOrder: number; id: string }, right: { sortOrder: number; id: string }) { return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id); }
function accountLabel(account: InvestmentAccount | undefined, fallback: string) { return account ? [account.institution.trim(), account.name.trim()].filter(Boolean).join(" · ") || fallback : fallback; }
function groupAccentColor(category: PortfolioPlanEditorGroup["category"]) { return category === "savings" ? "#c9953f" : category === "stocks" ? "#238769" : "#5d85b2"; }
function draftId(prefix: string) { return `${prefix}:${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`; }
