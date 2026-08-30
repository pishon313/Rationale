"use client";

import { ChevronDown, CircleDollarSign, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { calculateContributionPlan, type ContributionPlanCalculation } from "@/domain/portfolio-contribution";
import { currencies, minorUnitsToMajor, type Currency } from "@/domain/currency";
import { formatCurrency } from "@/domain/money";
import type { InvestmentAccount } from "@/features/accounts/types";
import { RegisteredStockPicker } from "@/features/stocks/registered-stock-picker";
import type { Stock } from "@/features/stocks/types";
import { useStockStore } from "@/features/stocks/use-stock-store";
import { useI18n } from "@/i18n/i18n-provider";
import { useLocalCollection } from "@/lib/use-local-collection";
import { usePortfolioShell } from "@/features/portfolio-shell/portfolio-shell";
import {
  classifyPortfolioPlanChanges,
  emptyPortfolioPlanDraft,
  formatBpsInput,
  formatEffectiveAllocation,
  formatMinorAmountInput,
  parseMajorAmountToMinor,
  parsePercentageToBps,
  portfolioPlanDraftFromActive,
  portfolioPlanRepairAccountMap,
  validatePortfolioPlanEditorDraft,
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
  const stateStore = useLocalCollection<PortfolioPlanState | LegacyPortfolioPlanStateV6>("portfolio-plan-state", []);
  const revisionStore = useLocalCollection<PortfolioPlanRevision | LegacyPortfolioPlanRevisionV6>("portfolio-plan-revisions", []);
  const groupStore = useLocalCollection<PortfolioAllocationGroup>("portfolio-allocation-groups", []);
  const targetStore = useLocalCollection<PortfolioAllocationTarget | LegacyPortfolioAllocationTargetV6>("portfolio-allocation-targets", []);
  const [migrationError, setMigrationError] = useState("");
  const [notice, setNotice] = useState("");
  const migrationStarted = useRef(false);
  const legacy = isLegacyPortfolioPlanV6Data({ states: stateStore.allItems, revisions: revisionStore.allItems, targets: targetStore.allItems });
  const ready = stockStore.ready && stateStore.ready && revisionStore.ready && groupStore.ready && targetStore.ready;

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

  const loadError = migrationError || stockStore.loadError || stateStore.loadError || revisionStore.loadError || groupStore.loadError || targetStore.loadError;
  if (!ready || legacy && !loadError) return <PlanLoading />;
  if (loadError) return <PlanLoadError message={loadError} />;

  const states = stateStore.allItems as PortfolioPlanState[];
  const revisions = revisionStore.allItems as PortfolioPlanRevision[];
  const targets = targetStore.allItems as PortfolioAllocationTarget[];
  const state = states[0] ?? null;
  const activeRevision = revisions.find((revision) => revision.id === state?.activeRevisionId) ?? null;
  const stores = { stateStore, revisionStore, groupStore, targetStore };
  return <>{notice && <p role="status" className="mb-5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">{notice}</p>}{state?.repairDraft
    ? <PortfolioRepairEditor key={`repair:${state.updatedAt}`} state={state} stocks={stockStore.allStocks} accounts={stockStore.accounts} stores={stores} onSaved={(message) => setNotice(message)} onChange={() => setNotice("")} />
    : <PortfolioPlanEditor key={`plan:${state?.updatedAt ?? "empty"}:${activeRevision?.id ?? "none"}`} state={state} activeRevision={activeRevision} revisions={revisions} groups={groupStore.allItems} targets={targets} stocks={stockStore.allStocks} accounts={stockStore.accounts} stores={stores} onSaved={(message) => setNotice(message)} onChange={() => setNotice("")} />}</>;
}

type PlanStores = {
  stateStore: ReturnType<typeof useLocalCollection<PortfolioPlanState | LegacyPortfolioPlanStateV6>>;
  revisionStore: ReturnType<typeof useLocalCollection<PortfolioPlanRevision | LegacyPortfolioPlanRevisionV6>>;
  groupStore: ReturnType<typeof useLocalCollection<PortfolioAllocationGroup>>;
  targetStore: ReturnType<typeof useLocalCollection<PortfolioAllocationTarget | LegacyPortfolioAllocationTargetV6>>;
};

function PortfolioPlanEditor({ state, activeRevision, revisions, groups, targets, stocks, accounts, stores, onSaved, onChange }: {
  state: PortfolioPlanState | null;
  activeRevision: PortfolioPlanRevision | null;
  revisions: PortfolioPlanRevision[];
  groups: PortfolioAllocationGroup[];
  targets: PortfolioAllocationTarget[];
  stocks: Stock[];
  accounts: InvestmentAccount[];
  stores: PlanStores;
  onSaved: (message: string) => void;
  onChange: () => void;
}) {
  const { t, localeTag } = useI18n();
  const { snapshot } = usePortfolioShell();
  const fallbackCurrency = snapshot.status === "ready" ? snapshot.portfolio.baseCurrency : "KRW";
  const savedDraft = useMemo(() => portfolioPlanDraftFromActive({ state, revision: activeRevision, groups, targets, fallbackCurrency }), [activeRevision, fallbackCurrency, groups, state, targets]);
  const [draft, setDraft] = useState<PortfolioPlanEditorDraft>(savedDraft);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => Object.fromEntries(savedDraft.groups.map((group) => [group.id, true])));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const validation = useMemo(() => validatePortfolioPlanEditorDraft(draft, stocks, accounts), [accounts, draft, stocks]);
  const changeKind = useMemo(() => classifyPortfolioPlanChanges({ draft, saved: savedDraft, hasActiveRevision: Boolean(activeRevision) }), [activeRevision, draft, savedDraft]);
  const calculation = useMemo(() => validation.parsed ? calculationFromDraft(draft, validation.parsed.contributionAmountMinor) : null, [draft, validation.parsed]);
  const activeAccounts = accounts.filter((account) => !account.archivedAt);
  const activeStocks = stocks.filter((stock) => !stock.deletedAt);

  function updateGroup(groupId: string, update: (group: PortfolioPlanEditorGroup) => PortfolioPlanEditorGroup) {
    setDraft((current) => ({ ...current, groups: current.groups.map((group) => group.id === groupId ? update(group) : group) }));
    clearFeedback();
  }
  function updateTarget(groupId: string, targetId: string, update: (target: PortfolioPlanEditorTarget) => PortfolioPlanEditorTarget) {
    updateGroup(groupId, (group) => ({ ...group, targets: group.targets.map((target) => target.id === targetId ? update(target) : target) }));
  }
  function addGroup() {
    const id = draftId("group");
    const currentTotal = draft.groups.reduce((sum, group) => sum + (parsePercentageToBps(group.weightInput) ?? 0), 0);
    const group: PortfolioPlanEditorGroup = { id, name: "", weightInput: formatBpsInput(Math.max(0, 10000 - currentTotal)), sortOrder: draft.groups.length, targets: [] };
    setDraft((current) => ({ ...current, groups: [...current.groups, group] }));
    setExpanded((current) => ({ ...current, [id]: true }));
    clearFeedback();
  }
  function addTarget(groupId: string, targetType: "stock" | "cash") {
    updateGroup(groupId, (group) => {
      const currentTotal = group.targets.reduce((sum, target) => sum + (parsePercentageToBps(target.weightInput) ?? 0), 0);
      return { ...group, targets: [...group.targets, { id: draftId("target"), targetType, stockId: null, accountId: "", weightInput: formatBpsInput(Math.max(0, 10000 - currentTotal)), sortOrder: group.targets.length }] };
    });
  }
  function deleteGroup(group: PortfolioPlanEditorGroup) {
    if (!window.confirm(t("{name} Group을 삭제할까요?", { name: group.name || t("이름 없는") }))) return;
    setDraft((current) => ({ ...current, groups: reindex(current.groups.filter((item) => item.id !== group.id)) }));
    clearFeedback();
  }
  function deleteTarget(groupId: string, target: PortfolioPlanEditorTarget) {
    if (!window.confirm(t("이 Target을 삭제할까요?"))) return;
    updateGroup(groupId, (group) => ({ ...group, targets: reindex(group.targets.filter((item) => item.id !== target.id)) }));
  }
  function reset() {
    setDraft(savedDraft);
    setExpanded(Object.fromEntries(savedDraft.groups.map((group) => [group.id, true])));
    setSaveError("");
    onChange();
  }
  function clearFeedback() { setSaveError(""); onChange(); }

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

  return <form onSubmit={savePlan} noValidate>
    <PlanHeader activeRevision={activeRevision} dirty={changeKind !== "none"} />
    {saveError && <p role="alert" className="mt-5 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">{saveError}</p>}
    <ContributionAmountEditor draft={draft} setDraft={setDraft} error={validation.fields.contributionAmount} onChange={clearFeedback} />

    <section className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h2 className="text-lg font-semibold">{t("Allocation Groups")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("Contribution을 나눌 Group과 실행 Target을 설정합니다.")}</p></div>
        <button type="button" onClick={addGroup} className="inline-flex min-h-10 items-center gap-2 rounded-lg border bg-[var(--surface)] px-3 text-sm font-medium"><Plus size={16} aria-hidden="true" />{t("Group 추가")}</button>
      </div>
      <WeightStatus inputs={draft.groups.map((group) => group.weightInput)} label={t("Group 합계")} className="mt-3" />
      {validation.fields.groups && <FieldError message={validation.fields.groups} />}
      {!draft.groups.length ? <div className="mt-4 rounded-2xl border border-dashed bg-[var(--surface)] px-6 py-12 text-center"><CircleDollarSign className="mx-auto text-[var(--muted)]" aria-hidden="true" /><h3 className="mt-4 font-medium">{t("첫 Allocation Group을 추가해 주세요.")}</h3><p className="mt-1 text-sm text-[var(--muted)]">{t("Group 안에 등록 종목 또는 Cash Target을 추가할 수 있습니다.")}</p><button type="button" onClick={addGroup} className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--ink)] px-4 text-sm font-medium text-[var(--paper)]"><Plus size={16} />{t("Group 추가")}</button></div>
        : <div className="mt-4 space-y-4">{draft.groups.slice().sort(byOrder).map((group) => {
          const groupErrorPath = `groups.${group.id}`;
          const groupAmount = calculation?.groups.find((item) => item.groupId === group.id)?.amountMinor;
          return <article key={group.id} className="overflow-visible rounded-2xl border bg-[var(--surface)] shadow-sm">
            <div className="grid gap-3 p-4 md:grid-cols-[minmax(12rem,1fr)_9rem_10rem_auto] md:items-end">
              <LabeledInput label={t("Group 이름")} value={group.name} onChange={(value) => updateGroup(group.id, (current) => ({ ...current, name: value }))} error={validation.fields[`${groupErrorPath}.name`]} />
              <LabeledInput label={t("Group 비중") + " (%)"} value={group.weightInput} inputMode="decimal" onChange={(value) => updateGroup(group.id, (current) => ({ ...current, weightInput: value }))} error={validation.fields[`${groupErrorPath}.weight`]} />
              <ReadOnlyMetric label={t("Contribution 금액")} value={groupAmount === undefined ? "—" : formatCurrency(minorUnitsToMajor(groupAmount, draft.contributionCurrency), draft.contributionCurrency, localeTag)} />
              <div className="flex justify-end gap-1"><button type="button" aria-expanded={Boolean(expanded[group.id])} aria-label={t("{name} Group 펼치기", { name: group.name || t("이름 없는") })} onClick={() => setExpanded((current) => ({ ...current, [group.id]: !current[group.id] }))} className="grid size-10 place-items-center rounded-lg border"><ChevronDown size={18} className={`transition-transform ${expanded[group.id] ? "rotate-180" : ""}`} /></button><button type="button" aria-label={t("{name} Group 삭제", { name: group.name || t("이름 없는") })} onClick={() => deleteGroup(group)} className="grid size-10 place-items-center rounded-lg text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"><Trash2 size={17} /></button></div>
            </div>
            {expanded[group.id] && <div className="border-t bg-[var(--surface-muted)]/45 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3"><WeightStatus inputs={group.targets.map((target) => target.weightInput)} label={t("Group 내부 합계")} /><div className="flex gap-2"><button type="button" onClick={() => addTarget(group.id, "stock")} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border bg-[var(--surface)] px-3 text-xs font-medium"><Plus size={14} />{t("Stock 추가")}</button><button type="button" onClick={() => addTarget(group.id, "cash")} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border bg-[var(--surface)] px-3 text-xs font-medium"><Plus size={14} />{t("Cash 추가")}</button></div></div>
              {validation.fields[`${groupErrorPath}.targets`] && <FieldError message={validation.fields[`${groupErrorPath}.targets`]} />}
              {validation.fields[`${groupErrorPath}.targetTotal`] && <FieldError message={validation.fields[`${groupErrorPath}.targetTotal`]} />}
              <div className="mt-3 space-y-3">{group.targets.slice().sort(byOrder).map((target) => <TargetEditor key={target.id} group={group} target={target} update={updateTarget} remove={deleteTarget} activeStocks={activeStocks} activeAccounts={activeAccounts} validation={validation.fields} calculation={calculation} currency={draft.contributionCurrency} />)}</div>
            </div>}
          </article>;
        })}</div>}
    </section>

    <ExecutionTable draft={draft} calculation={calculation} stocks={stocks} accounts={accounts} />
    <details className="mt-6 rounded-2xl border bg-[var(--surface)] p-4">
      <summary className="cursor-pointer font-medium">{t("Thesis와 리비전 메모")}</summary>
      <div className="mt-4 grid gap-4"><label className="text-sm font-medium">{t("투자 근거 (선택)")}<textarea value={draft.thesis} onChange={(event) => { setDraft((current) => ({ ...current, thesis: event.target.value })); clearFeedback(); }} rows={3} className="mt-1 w-full rounded-lg border bg-[var(--surface)] p-3 font-normal" /></label>{activeRevision && changeKind === "revision" && <label className="text-sm font-medium">{t("변경 이유 (선택)")}<textarea value={draft.changeNote} onChange={(event) => setDraft((current) => ({ ...current, changeNote: event.target.value }))} rows={2} className="mt-1 w-full rounded-lg border bg-[var(--surface)] p-3 font-normal" /></label>}</div>
    </details>

    {!validation.valid && <ValidationSummary messages={validation.summary} />}
    <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t pt-5"><button type="button" onClick={reset} disabled={saving || changeKind === "none"} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 text-sm font-medium disabled:opacity-50"><RotateCcw size={16} />{t("저장된 상태로 재설정")}</button><button type="submit" disabled={saving || !validation.valid || changeKind === "none"} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--ink)] px-5 text-sm font-semibold text-[var(--paper)] disabled:cursor-not-allowed disabled:opacity-50"><Save size={16} />{saving ? t("저장 중...") : changeKind === "initial" ? t("Plan 활성화") : changeKind === "revision" ? t("새 리비전 저장") : changeKind === "contribution" ? t("Contribution 저장") : t("변경사항 저장")}</button></div>
  </form>;
}

function PortfolioRepairEditor({ state, stocks, accounts, stores, onSaved, onChange }: { state: PortfolioPlanState; stocks: Stock[]; accounts: InvestmentAccount[]; stores: PlanStores; onSaved: (message: string) => void; onChange: () => void }) {
  const { t, formatNumber } = useI18n();
  const repair = state.repairDraft!;
  const activeRevision = repair.legacyRevisions.find((revision) => revision.id === repair.legacyState?.activeRevisionId) ?? null;
  const [amountInput, setAmountInput] = useState(() => formatMinorAmountInput(state.contributionAmountMinor, state.contributionCurrency));
  const [currency, setCurrency] = useState<Currency>(state.contributionCurrency);
  const initialMap = useMemo(() => portfolioPlanRepairAccountMap(repair), [repair]);
  const [accountMap, setAccountMap] = useState<Record<string, string>>(initialMap);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const activeAccounts = accounts.filter((account) => !account.archivedAt);
  const activeTargets = repair.legacyTargets.filter((target) => target.revisionId === activeRevision?.id).slice().sort(byOrder);
  const historicalTargets = repair.legacyTargets.filter((target) => target.revisionId !== activeRevision?.id && !accountMap[target.id]).slice().sort(byOrder);
  const amountMinor = parseMajorAmountToMinor(amountInput, currency);
  const everyMapped = repair.legacyTargets.every((target) => Boolean(accountMap[target.id] && accounts.some((account) => account.id === accountMap[target.id])));
  const activeMappingsValid = activeTargets.every((target) => activeAccounts.some((account) => account.id === accountMap[target.id]));
  const dirty = amountInput !== formatMinorAmountInput(state.contributionAmountMinor, state.contributionCurrency) || currency !== state.contributionCurrency || JSON.stringify(accountMap) !== JSON.stringify(initialMap);
  const calculation = amountMinor === null || !activeRevision || !activeTargets.length || !activeTargets.every((target) => accountMap[target.id]) ? null : calculateContributionPlan({
    contributionAmountMinor: amountMinor,
    contributionCurrency: currency,
    revisionId: activeRevision.id,
    groups: [{ id: `legacy-allocation:${activeRevision.id}`, revisionId: activeRevision.id, name: "Legacy Allocation", targetWeightBps: 10000, sortOrder: 0, updatedAt: activeRevision.updatedAt }],
    targets: activeTargets.map((target) => ({ id: target.id, revisionId: target.revisionId, groupId: `legacy-allocation:${target.revisionId}`, accountId: accountMap[target.id], targetType: target.targetType, stockId: target.stockId, weightWithinGroupBps: target.targetWeightBps, sortOrder: target.sortOrder, updatedAt: target.updatedAt } as PortfolioAllocationTarget)),
  });

  function choose(targetId: string, accountId: string) { setAccountMap((current) => ({ ...current, [targetId]: accountId })); setError(""); onChange(); }
  function reset() { setAmountInput(formatMinorAmountInput(state.contributionAmountMinor, state.contributionCurrency)); setCurrency(state.contributionCurrency); setAccountMap(initialMap); setError(""); onChange(); }
  async function activate(event: FormEvent) {
    event.preventDefault();
    if (saving || amountMinor === null || !everyMapped || !activeMappingsValid) return;
    setSaving(true); setError("");
    try {
      const activation = buildPortfolioPlanRepairActivation({ state, accountIdsByTargetId: accountMap, stocks, accounts, contributionAmountMinor: amountMinor, contributionCurrency: currency });
      await persistPortfolioPlanRepairActivation(activation);
      applyActivation(stores, activation);
      onSaved(t("Contribution Plan을 저장하고 활성화했습니다."));
    } catch { setError(t("포트폴리오 계획을 저장하지 못했습니다. 다시 시도해 주세요.")); }
    finally { setSaving(false); }
  }
  return <form onSubmit={activate} noValidate>
    <PlanHeader activeRevision={activeRevision ? { ...activeRevision } : null} dirty={dirty || !everyMapped} repair />
    <section className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><h2 className="font-semibold">{t("이전 Plan의 Account 연결을 완료해 주세요.")}</h2><p className="mt-1 text-sm leading-6">{t("확실하게 복구된 연결은 미리 채웠습니다. 비어 있는 Target만 선택하면 전체 V6 리비전 기록을 그대로 V7으로 활성화합니다.")}</p></section>
    {error && <p role="alert" className="mt-4 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100">{error}</p>}
    <ContributionAmountEditor draft={{ ...emptyPortfolioPlanDraft(currency), contributionAmountInput: amountInput, contributionCurrency: currency }} setDraft={(next) => { const value = typeof next === "function" ? next({ ...emptyPortfolioPlanDraft(currency), contributionAmountInput: amountInput, contributionCurrency: currency }) : next; setAmountInput(value.contributionAmountInput); setCurrency(value.contributionCurrency); setError(""); onChange(); }} error={amountMinor === null ? t("Contribution Amount 형식이 올바르지 않습니다.") : undefined} onChange={() => { setError(""); onChange(); }} />
    <section className="mt-6 rounded-2xl border bg-[var(--surface)] p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Legacy Allocation</h2><p className="mt-1 text-sm text-[var(--muted)]">{activeRevision ? t("리비전 {number}의 Target 비중과 순서를 유지합니다.", { number: formatNumber(activeRevision.revisionNumber) }) : ""}</p></div><WeightStatus inputs={activeTargets.map((target) => formatBpsInput(target.targetWeightBps))} label={t("Group 내부 합계")} /></div><div className="mt-4 space-y-3">{activeTargets.map((target) => <RepairTargetRow key={target.id} target={target} accountId={accountMap[target.id] ?? ""} choose={choose} accounts={activeAccounts} stocks={stocks} amountMinor={calculation?.targets.find((item) => item.targetId === target.id)?.amountMinor} currency={currency} />)}</div></section>
    {historicalTargets.length > 0 && <section className="mt-4 rounded-2xl border bg-[var(--surface)] p-5"><h2 className="font-semibold">{t("과거 리비전 Account 연결")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("과거 기록을 빠짐없이 보존하려면 아래 Target도 Account가 필요합니다.")}</p><div className="mt-4 space-y-3">{historicalTargets.map((target) => <RepairTargetRow key={target.id} target={target} accountId={accountMap[target.id] ?? ""} choose={choose} accounts={activeAccounts} stocks={stocks} currency={currency} />)}</div></section>}
    <ExecutionTable draft={repairExecutionDraft(activeRevision, activeTargets, accountMap, amountInput, currency)} calculation={calculation} stocks={stocks} accounts={accounts} />
    <details className="mt-6 rounded-2xl border bg-[var(--surface)] p-4"><summary className="cursor-pointer font-medium">{t("보존되는 Thesis")}</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">{activeRevision?.thesis || t("입력된 Thesis가 없습니다.")}</p></details>
    {(!everyMapped || !activeMappingsValid || amountMinor === null) && <ValidationSummary messages={[...(amountMinor === null ? [t("Contribution Amount 형식이 올바르지 않습니다.")] : []), ...(!everyMapped ? [t("모든 Legacy Target에 Account를 선택해 주세요.")] : []), ...(!activeMappingsValid ? [t("현재 활성 Target에는 보관되지 않은 Account가 필요합니다.")] : [])]} />}
    <div className="mt-6 flex justify-end gap-3 border-t pt-5"><button type="button" onClick={reset} disabled={!dirty || saving} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 text-sm font-medium disabled:opacity-50"><RotateCcw size={16} />{t("저장된 상태로 재설정")}</button><button type="submit" disabled={saving || amountMinor === null || !everyMapped || !activeMappingsValid} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[var(--ink)] px-5 text-sm font-semibold text-[var(--paper)] disabled:opacity-50"><Save size={16} />{saving ? t("저장 중...") : t("복구된 Plan 활성화")}</button></div>
  </form>;
}

function PlanHeader({ activeRevision, dirty, repair = false }: { activeRevision: PortfolioPlanRevision | LegacyPortfolioPlanRevisionV6 | null; dirty: boolean; repair?: boolean }) {
  const { t, formatNumber } = useI18n();
  return <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-[var(--accent)]">{t("Portfolio Plan")}</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">{t("Contribution Plan")}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">{t("새 자금을 어디에 얼마나 배분할지 정하고, 실행 금액을 minor unit까지 정확히 확인합니다.")}</p></div><div className="flex flex-wrap justify-end gap-2">{activeRevision && <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent)]">{t("리비전 {number} · 현재 활성", { number: formatNumber(activeRevision.revisionNumber) })}</span>}{repair && <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100">{t("Account 복구 모드")}</span>}{dirty && <span className="rounded-full border px-3 py-1.5 text-xs font-medium">{t("저장되지 않은 변경")}</span>}</div></div>;
}

function ContributionAmountEditor({ draft, setDraft, error, onChange }: { draft: PortfolioPlanEditorDraft; setDraft: React.Dispatch<React.SetStateAction<PortfolioPlanEditorDraft>>; error?: string; onChange: () => void }) {
  const { t } = useI18n();
  return <section className="mt-6 rounded-2xl border bg-[var(--surface)] p-5"><div className="grid gap-4 md:grid-cols-[minmax(14rem,1fr)_9rem]"><LabeledInput label={t("Contribution Amount")} value={draft.contributionAmountInput} inputMode="decimal" onChange={(value) => { setDraft((current) => ({ ...current, contributionAmountInput: value })); onChange(); }} error={error} /><label className="text-sm font-medium">{t("통화")}<select value={draft.contributionCurrency} onChange={(event) => { const currency = event.target.value as Currency; setDraft((current) => ({ ...current, contributionCurrency: currency })); onChange(); }} className="mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 font-normal">{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label></div><p className="mt-3 text-xs leading-5 text-[var(--muted)]">{t("금액은 통화별 minor unit 정수로 저장됩니다. KRW와 JPY는 정수, 그 외 통화는 소수점 둘째 자리까지 입력할 수 있습니다.")}</p></section>;
}

function TargetEditor({ group, target, update, remove, activeStocks, activeAccounts, validation, calculation, currency }: { group: PortfolioPlanEditorGroup; target: PortfolioPlanEditorTarget; update: (groupId: string, targetId: string, update: (target: PortfolioPlanEditorTarget) => PortfolioPlanEditorTarget) => void; remove: (groupId: string, target: PortfolioPlanEditorTarget) => void; activeStocks: Stock[]; activeAccounts: InvestmentAccount[]; validation: Record<string, string>; calculation: ContributionPlanCalculation | null; currency: Currency }) {
  const { t, localeTag } = useI18n();
  const path = `groups.${group.id}.targets.${target.id}`;
  const amount = calculation?.targets.find((item) => item.targetId === target.id)?.amountMinor;
  const groupBps = parsePercentageToBps(group.weightInput);
  const targetBps = parsePercentageToBps(target.weightInput);
  return <div className="rounded-xl border bg-[var(--surface)] p-4"><div className="grid gap-3 lg:grid-cols-[minmax(12rem,1.25fr)_minmax(10rem,1fr)_8rem_8rem_9rem_auto] lg:items-end"><div>{target.targetType === "stock" ? <><RegisteredStockPicker stocks={activeStocks} value={target.stockId} onChange={(stockId) => update(group.id, target.id, (current) => ({ ...current, stockId }))} label={t("Stock")} required />{validation[`${path}.stock`] && <FieldError message={validation[`${path}.stock`]} />}</> : <ReadOnlyMetric label={t("Target")} value={t("Cash")} />}</div><AccountSelect label={t("실행 Account")} accounts={activeAccounts} value={target.accountId} onChange={(accountId) => update(group.id, target.id, (current) => ({ ...current, accountId }))} error={validation[`${path}.account`]} /><LabeledInput label={t("Group 내부 비중") + " (%)"} value={target.weightInput} inputMode="decimal" onChange={(value) => update(group.id, target.id, (current) => ({ ...current, weightInput: value }))} error={validation[`${path}.weight`]} /><ReadOnlyMetric label={t("유효 배분")} value={groupBps === null || targetBps === null ? "—" : formatEffectiveAllocation(groupBps, targetBps)} /><ReadOnlyMetric label={t("Contribution 금액")} value={amount === undefined ? "—" : formatCurrency(minorUnitsToMajor(amount, currency), currency, localeTag)} /><button type="button" aria-label={t("이 Target 삭제")} onClick={() => remove(group.id, target)} className="grid size-10 place-items-center rounded-lg text-red-700 hover:bg-red-50 dark:text-red-300"><Trash2 size={17} /></button></div></div>;
}

function RepairTargetRow({ target, accountId, choose, accounts, stocks, amountMinor, currency }: { target: LegacyPortfolioAllocationTargetV6; accountId: string; choose: (targetId: string, accountId: string) => void; accounts: InvestmentAccount[]; stocks: Stock[]; amountMinor?: number; currency: Currency }) {
  const { t, localeTag } = useI18n();
  const stock = target.targetType === "stock" ? stocks.find((item) => item.id === target.stockId) : null;
  return <div className="grid gap-3 rounded-xl border bg-[var(--surface)] p-4 md:grid-cols-[minmax(12rem,1fr)_minmax(11rem,1fr)_8rem_10rem] md:items-end"><ReadOnlyMetric label={t("Target")} value={target.targetType === "cash" ? t("Cash") : stock ? `${stock.ticker} · ${stock.name}` : t("알 수 없는 종목")} /><AccountSelect label={t("실행 Account")} accounts={accounts} value={accountId} onChange={(value) => choose(target.id, value)} error={!accountId ? t("활성 계좌를 선택해 주세요.") : undefined} /><ReadOnlyMetric label={t("Group 내부 비중")} value={`${formatBpsInput(target.targetWeightBps)}%`} /><ReadOnlyMetric label={t("Contribution 금액")} value={amountMinor === undefined ? "—" : formatCurrency(minorUnitsToMajor(amountMinor, currency), currency, localeTag)} /></div>;
}

function ExecutionTable({ draft, calculation, stocks, accounts }: { draft: PortfolioPlanEditorDraft; calculation: ContributionPlanCalculation | null; stocks: readonly Stock[]; accounts: readonly InvestmentAccount[] }) {
  const { t, localeTag } = useI18n();
  const stockById = new Map(stocks.map((stock) => [stock.id, stock]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const groupById = new Map(draft.groups.map((group) => [group.id, group]));
  const targetById = new Map(draft.groups.flatMap((group) => group.targets).map((target) => [target.id, target]));
  return <section className="mt-6"><div><h2 className="text-lg font-semibold">{t("This Contribution")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("현재 Contribution Amount를 Plan 비중대로 나눈 실행 표입니다.")}</p></div><div className="mt-3 overflow-hidden rounded-2xl border bg-[var(--surface)]"><div className="hidden grid-cols-[1fr_1.3fr_0.8fr_1fr_0.9fr] gap-3 border-b bg-[var(--surface-muted)] px-4 py-3 text-xs font-medium text-[var(--muted)] md:grid"><span>{t("Group")}</span><span>{t("Target")}</span><span>{t("Allocation")}</span><span>{t("Account")}</span><span className="text-right">{t("Amount")}</span></div>{!calculation ? <p className="px-5 py-10 text-center text-sm text-[var(--muted)]">{t("유효한 Plan을 입력하면 정확한 실행 금액을 표시합니다.")}</p> : <div className="divide-y">{calculation.targets.map((row) => {
    const target = targetById.get(row.targetId);
    const stock = row.stockId ? stockById.get(row.stockId) : null;
    return <div key={row.targetId} className="grid gap-2 p-4 text-sm md:grid-cols-[1fr_1.3fr_0.8fr_1fr_0.9fr] md:items-center md:gap-3"><Cell label={t("Group")} value={groupById.get(row.groupId)?.name || "—"} /><Cell label={t("Target")} value={row.targetType === "cash" ? t("Cash") : stock ? `${stock.ticker} · ${stock.name}` : t("알 수 없는 종목")} /><Cell label={t("Allocation")} value={target ? formatEffectiveAllocation(parsePercentageToBps(groupById.get(row.groupId)?.weightInput ?? "") ?? 0, parsePercentageToBps(target.weightInput) ?? 0) : "—"} /><Cell label={t("Account")} value={accountById.get(row.accountId)?.name ?? "—"} /><Cell label={t("Amount")} value={formatCurrency(minorUnitsToMajor(row.amountMinor, draft.contributionCurrency), draft.contributionCurrency, localeTag)} alignRight /></div>;
  })}<div className="flex items-center justify-between gap-4 bg-[var(--surface-muted)] px-4 py-3 text-sm font-semibold"><span>{t("합계")}</span><span className="tabular-nums">{formatCurrency(minorUnitsToMajor(calculation.contributionAmountMinor, calculation.contributionCurrency), calculation.contributionCurrency, localeTag)}</span></div></div>}</div></section>;
}

function WeightStatus({ inputs, label, className = "" }: { inputs: string[]; label: string; className?: string }) {
  const { t } = useI18n();
  const values = inputs.map(parsePercentageToBps);
  const invalid = values.some((value) => value === null);
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const status = invalid ? t("잘못된 비중") : total === 10000 ? t("완료") : total < 10000 ? t("{value}% 남음", { value: formatBpsAny(10000 - total) }) : t("{value}% 초과", { value: formatBpsAny(total - 10000) });
  return <p className={`${className} text-xs font-medium ${invalid || total !== 10000 ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>{label}: <span className="tabular-nums">{invalid ? "—" : `${formatBpsAny(total)}%`}</span> · {status}</p>;
}

function ValidationSummary({ messages }: { messages: string[] }) {
  const { t } = useI18n();
  const unique = [...new Set(messages)];
  return <section role="alert" aria-labelledby="plan-validation-title" className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><h2 id="plan-validation-title" className="font-semibold">{t("저장하기 전에 확인해 주세요.")}</h2><ul className="mt-2 list-disc space-y-1 pl-5">{unique.map((message) => <li key={message}>{t(message)}</li>)}</ul></section>;
}

function LabeledInput({ label, value, onChange, error, inputMode }: { label: string; value: string; onChange: (value: string) => void; error?: string; inputMode?: "decimal" }) {
  const { t } = useI18n();
  const id = useMemo(() => draftId("field"), []);
  const errorId = `${id}-error`;
  return <label htmlFor={id} className="text-sm font-medium">{label}<input id={id} value={value} inputMode={inputMode} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} className="mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 font-normal tabular-nums" />{error && <span id={errorId} className="mt-1 block text-xs font-normal text-red-700 dark:text-red-300">{t(error)}</span>}</label>;
}
function AccountSelect({ label, accounts, value, onChange, error }: { label: string; accounts: readonly InvestmentAccount[]; value: string; onChange: (value: string) => void; error?: string }) {
  const { t } = useI18n();
  return <label className="text-sm font-medium">{label}<select value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} className="mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 font-normal"><option value="">{t("Account 선택")}</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.baseCurrency}</option>)}</select>{error && <span className="mt-1 block text-xs font-normal text-red-700 dark:text-red-300">{t(error)}</span>}</label>;
}
function ReadOnlyMetric({ label, value }: { label: string; value: string }) { return <div><p className="text-xs font-medium text-[var(--muted)]">{label}</p><p className="mt-1 min-h-10 truncate rounded-lg bg-[var(--surface-muted)] px-3 py-2.5 text-sm tabular-nums" title={value}>{value}</p></div>; }
function FieldError({ message }: { message: string }) { const { t } = useI18n(); return <p className="mt-2 text-xs text-red-700 dark:text-red-300">{t(message)}</p>; }
function Cell({ label, value, alignRight = false }: { label: string; value: string; alignRight?: boolean }) { return <div className={alignRight ? "md:text-right" : ""}><span className="mr-2 text-xs font-medium text-[var(--muted)] md:hidden">{label}</span><span className="tabular-nums">{value}</span></div>; }
function PlanLoading() { const { t } = useI18n(); return <p className="py-20 text-center text-sm text-[var(--muted)]">{t("Contribution Plan을 불러오는 중입니다.")}</p>; }
function PlanLoadError({ message }: { message: string }) { const { t } = useI18n(); return <section role="alert" className="rounded-xl border border-red-300 bg-red-50 p-6 text-center text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100"><h1 className="font-semibold">{t("Contribution Plan을 불러오지 못했습니다.")}</h1><p className="mt-2">{message}</p></section>; }

function calculationFromDraft(draft: PortfolioPlanEditorDraft, amountMinor: number) {
  const revisionId = "draft";
  return calculateContributionPlan({ contributionAmountMinor: amountMinor, contributionCurrency: draft.contributionCurrency, revisionId,
    groups: draft.groups.map((group, index) => ({ id: group.id, revisionId, name: group.name.trim(), targetWeightBps: parsePercentageToBps(group.weightInput)!, sortOrder: index, updatedAt: new Date(0).toISOString() })),
    targets: draft.groups.flatMap((group) => group.targets.map((target, index) => ({ id: target.id, revisionId, groupId: group.id, accountId: target.accountId, targetType: target.targetType, stockId: target.stockId, weightWithinGroupBps: parsePercentageToBps(target.weightInput)!, sortOrder: index, updatedAt: new Date(0).toISOString() } as PortfolioAllocationTarget))),
  });
}
function repairExecutionDraft(revision: LegacyPortfolioPlanRevisionV6 | null, targets: LegacyPortfolioAllocationTargetV6[], accountMap: Record<string, string>, amountInput: string, currency: Currency): PortfolioPlanEditorDraft {
  return { contributionAmountInput: amountInput, contributionCurrency: currency, thesis: revision?.thesis ?? "", changeNote: "", groups: revision ? [{ id: `legacy-allocation:${revision.id}`, name: "Legacy Allocation", weightInput: "100", sortOrder: 0, targets: targets.map((target) => ({ id: target.id, targetType: target.targetType, stockId: target.stockId, accountId: accountMap[target.id] ?? "", weightInput: formatBpsInput(target.targetWeightBps), sortOrder: target.sortOrder })) }] : [] };
}
function applyActivation(stores: PlanStores, activation: { states: PortfolioPlanState[]; revisions: PortfolioPlanRevision[]; groups: PortfolioAllocationGroup[]; targets: PortfolioAllocationTarget[] }) { stores.stateStore.applyCommitted(activation.states); stores.revisionStore.applyCommitted(activation.revisions); stores.groupStore.applyCommitted(activation.groups); stores.targetStore.applyCommitted(activation.targets); }
function formatBpsAny(bps: number) { const whole = Math.floor(bps / 100); const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/, ""); return fraction ? `${whole}.${fraction}` : String(whole); }
function reindex<T extends { sortOrder: number }>(values: T[]) { return values.map((value, index) => ({ ...value, sortOrder: index })); }
function byOrder(left: { sortOrder: number; id: string }, right: { sortOrder: number; id: string }) { return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id); }
function draftId(prefix: string) { return `${prefix}:${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`; }
