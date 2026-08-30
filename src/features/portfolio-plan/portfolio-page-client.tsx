"use client";

import { ArrowRight, CheckCircle2, CircleDollarSign, Info, Scale, Target } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { minorUnitsToMajor } from "@/domain/currency";
import { buildPortfolioBalanceSnapshot, portfolioBalanceCategories, suggestContributionBalance, type PortfolioBalanceUnavailableReason } from "@/domain/portfolio-balance";
import { formatCurrency } from "@/domain/money";
import { buildPortfolioStockAllocationSnapshot } from "@/domain/portfolio-stock-allocation";
import { useStockStore } from "@/features/stocks/use-stock-store";
import { useI18n } from "@/i18n/i18n-provider";
import { useExchangeRates } from "@/lib/use-exchange-rates";
import { useLocalCollection } from "@/lib/use-local-collection";
import { calculatePortfolioPlanDraft, portfolioPlanCategoryName, portfolioPlanCategoryWeights, portfolioPlanDraftFromActive, portfolioTargetAllocationCategoryName, withPortfolioPlanCategoryWeights, withPortfolioStockTargetWeights } from "./portfolio-plan-draft";
import { buildPortfolioPlanRepairActivation, isLegacyPortfolioPlanV6Data, migratePortfolioPlanV6, persistPortfolioPlanRepairActivation, persistPortfolioPlanV6Migration } from "./portfolio-plan-migration";
import type {
  LegacyPortfolioAllocationTargetV6,
  LegacyPortfolioPlanRevisionV6,
  LegacyPortfolioPlanStateV6,
  PortfolioAllocationGroup,
  PortfolioAllocationTarget,
  PortfolioPlanRevision,
  PortfolioPlanState,
} from "./types";

export function PortfolioPageClient() {
  const { t, localeTag, formatNumber } = useI18n();
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

  useEffect(() => {
    if (!ready || !legacy || migrationStarted.current) return;
    migrationStarted.current = true;
    void (async () => {
      try {
        const migration = migratePortfolioPlanV6({
          states: stateStore.allItems as LegacyPortfolioPlanStateV6[], revisions: revisionStore.allItems as LegacyPortfolioPlanRevisionV6[], targets: targetStore.allItems as LegacyPortfolioAllocationTargetV6[],
          stocks: stockStore.allStocks, accounts: stockStore.accounts, trades: stockStore.trades,
        });
        await persistPortfolioPlanV6Migration(migration);
        applyPortfolioCollections({ stateStore, revisionStore, groupStore, targetStore }, migration);
      } catch { setMigrationError(t("포트폴리오 계획을 저장하지 못했습니다. 다시 시도해 주세요.")); }
    })();
  }, [groupStore, legacy, ready, revisionStore, stateStore, stockStore.accounts, stockStore.allStocks, stockStore.trades, t, targetStore]);

  useEffect(() => {
    if (!ready || legacy || !repairState || repairUpgradeStarted.current) return;
    repairUpgradeStarted.current = true;
    void (async () => {
      try {
        const activation = buildPortfolioPlanRepairActivation({ state: repairState, accountIdsByTargetId: {}, stocks: stockStore.allStocks, accounts: stockStore.accounts, contributionAmountMinor: repairState.contributionAmountMinor, contributionCurrency: repairState.contributionCurrency });
        await persistPortfolioPlanRepairActivation(activation);
        applyPortfolioCollections({ stateStore, revisionStore, groupStore, targetStore }, activation);
      } catch { setMigrationError(t("포트폴리오 계획을 저장하지 못했습니다. 다시 시도해 주세요.")); }
    })();
  }, [groupStore, legacy, ready, repairState, revisionStore, stateStore, stockStore.accounts, stockStore.allStocks, t, targetStore]);

  const draft = useMemo(() => portfolioPlanDraftFromActive({ state, revision: activeRevision, groups: groupStore.allItems, targets, fallbackCurrency: "KRW" }), [activeRevision, groupStore.allItems, state, targets]);
  const baseWeights = useMemo(() => activeRevision ? portfolioPlanCategoryWeights(draft) : null, [activeRevision, draft]);
  const bondStockIds = useMemo(() => new Set(draft.groups.find((group) => group.category === "bonds")?.targets.flatMap((target) => target.stockId ? [target.stockId] : []) ?? []), [draft]);
  const balanceSnapshot = useMemo(() => buildPortfolioBalanceSnapshot({ ledger: stockStore.ledger, stocks: stockStore.allStocks, ratesToKrw: exchangeRates.snapshot.ratesToKrw, bondStockIds }), [bondStockIds, exchangeRates.snapshot.ratesToKrw, stockStore.allStocks, stockStore.ledger]);
  const stockSnapshot = useMemo(() => buildPortfolioStockAllocationSnapshot({ ledger: stockStore.ledger, stocks: stockStore.allStocks, ratesToKrw: exchangeRates.snapshot.ratesToKrw, bondStockIds }), [bondStockIds, exchangeRates.snapshot.ratesToKrw, stockStore.allStocks, stockStore.ledger]);
  const suggestion = useMemo(() => state && baseWeights ? suggestContributionBalance({ snapshot: balanceSnapshot, policy: state.balancePolicy, baseWeightsBps: baseWeights, contributionAmountMinor: state.contributionAmountMinor, contributionCurrency: state.contributionCurrency, ratesToKrw: exchangeRates.snapshot.ratesToKrw }) : null, [balanceSnapshot, baseWeights, exchangeRates.snapshot.ratesToKrw, state]);
  const categoryExecutionDraft = useMemo(() => suggestion && state?.balancePolicy?.mode === "balanceAssist" ? withPortfolioPlanCategoryWeights(draft, suggestion.weightsBps) : draft, [draft, state?.balancePolicy?.mode, suggestion]);
  const executionDraft = useMemo(() => withPortfolioStockTargetWeights(categoryExecutionDraft, state?.balancePolicy?.stockTargets), [categoryExecutionDraft, state?.balancePolicy?.stockTargets]);
  const calculation = useMemo(() => activeRevision ? calculatePortfolioPlanDraft(executionDraft) : null, [activeRevision, executionDraft]);

  if (!ready || (legacy || repairState) && !migrationError) return <p className="py-20 text-center text-sm text-[var(--muted)]">{t("포트폴리오 계획을 불러오는 중입니다.")}</p>;
  if (migrationError) return <p role="alert" className="py-20 text-center text-sm text-red-700 dark:text-red-200">{migrationError}</p>;

  const contributionValue = state ? formatCurrency(minorUnitsToMajor(state.contributionAmountMinor, state.contributionCurrency), state.contributionCurrency, localeTag) : "—";
  const portfolioValue = balanceSnapshot.totalValueKrw === null ? "—" : formatCurrency(balanceSnapshot.totalValueKrw, "KRW", localeTag);
  const currentByCategory = new Map(balanceSnapshot.categories.map((row) => [row.category, row]));
  const allocationRows = portfolioBalanceCategories.map((category) => {
    const current = currentByCategory.get(category)?.currentWeightBps ?? null;
    const target = state?.balancePolicy?.targetWeightsBps[category] ?? null;
    const drift = current === null || target === null ? null : current - target;
    return { category, current, target, drift, outside: drift !== null && Math.abs(drift) > (state?.balancePolicy?.toleranceBps ?? 10000) };
  });
  const comparableAllocationRows = allocationRows.filter((row): row is typeof row & { drift: number } => row.drift !== null);
  const priorityRow = comparableAllocationRows.slice().sort((left, right) => left.drift - right.drift)[0] ?? null;
  const outsideAllocation = comparableAllocationRows.some((row) => row.outside);
  const allocationStatus = !state?.balancePolicy ? t("목표 없음") : !comparableAllocationRows.length ? t("비교 대기") : outsideAllocation ? t("조정 필요") : t("안정");
  const allocationStatusHelp = !state?.balancePolicy ? t("Allocation에서 전체 목표를 설정할 수 있습니다.") : !comparableAllocationRows.length ? t("현재 자산 평가 후 목표와 비교합니다.") : outsideAllocation ? t("허용 범위를 벗어난 자산군이 있습니다.") : t("모든 자산군이 허용 범위 안에 있습니다.");
  const priorityValue = priorityRow ? priorityRow.drift < 0 ? t(portfolioTargetAllocationCategoryName(priorityRow.category)) : t("균형") : "—";
  const priorityHelp = priorityRow ? priorityRow.drift < 0 ? t("목표보다 {value}%p 부족", { value: formatNumber(Math.abs(priorityRow.drift) / 100, { maximumFractionDigits: 2 }) }) : t("현재 비중이 목표와 일치합니다.") : t("현재 자산 평가 후 표시됩니다.");
  const currentWeights = Object.fromEntries(allocationRows.map((row) => [row.category, row.current ?? 0])) as Record<(typeof portfolioBalanceCategories)[number], number>;
  const stockById = new Map(stockStore.allStocks.map((stock) => [stock.id, stock]));
  const stockCurrentById = new Map(stockSnapshot.rows.map((row) => [row.stockId, row.currentWeightBps]));
  const stockDetailTargets = state?.balancePolicy?.stockTargets ?? [];
  const executionAmountByStockId = new Map<string, number>();
  for (const target of calculation?.targets ?? []) if (target.stockId) executionAmountByStockId.set(target.stockId, (executionAmountByStockId.get(target.stockId) ?? 0) + target.amountMinor);
  return <div className="portfolio-overview">
    <header className="portfolio-plan-heading">
      <div><p>{t("Portfolio Overview")}</p><h1>{t("현재 자산과 다음 저축 계획을 한눈에 보세요.")}</h1><span>{t("실제 보유 자산과 Contribution Plan은 서로 다른 기준으로 분리해 보여줍니다.")}</span></div>
      <div className="portfolio-plan-heading-badges">{state?.balancePolicy && <span className="portfolio-plan-mode-badge"><Scale size={14} aria-hidden="true" />{t(state.balancePolicy.mode === "balanceAssist" ? "균형 맞추기" : "전체 목표 등록됨")}</span>}{activeRevision && <span className="portfolio-plan-dirty-badge">{t("리비전 {number} · 현재 활성", { number: formatNumber(activeRevision.revisionNumber) })}</span>}</div>
    </header>

    <section aria-label={t("포트폴리오 요약")} className="portfolio-overview-kpis">
      <OverviewMetric label={t("현재 포트폴리오")} value={portfolioValue} help={balanceSnapshot.available ? t("현금과 보유 포지션의 평가 금액") : t("현재 평가 불가")} />
      <OverviewMetric label={t("다음 전체 저축액")} value={contributionValue} help={activeRevision ? t("저장된 Contribution Plan 기준") : t("Plan을 만들면 계산됩니다.")} />
      <OverviewMetric label={t("Allocation 상태")} value={allocationStatus} help={allocationStatusHelp} tone={outsideAllocation ? "warning" : state?.balancePolicy && comparableAllocationRows.length ? "positive" : "neutral"} />
      <OverviewMetric label={t("가장 부족한 자산군")} value={priorityValue} help={priorityHelp} tone={priorityRow && priorityRow.drift < 0 ? "warning" : "neutral"} />
    </section>

    <div className="portfolio-overview-grid">
      <section aria-labelledby="current-allocation-title" className="portfolio-overview-card">
        <div className="portfolio-overview-card-header"><div><p>{t("CURRENT ASSETS")}</p><h2 id="current-allocation-title">{t("현재 자산 배분")}</h2><span>{t("실제 거래와 현금 기록으로 계산합니다.")}</span></div><Link href="/portfolio/allocation">{state?.balancePolicy ? t("Allocation에서 수정") : t("Allocation 설정")}<ArrowRight size={14} aria-hidden="true" /></Link></div>
        {!balanceSnapshot.available ? <OverviewUnavailable reason={balanceSnapshot.unavailableReason} /> : balanceSnapshot.totalValueKrw === 0 && !state?.balancePolicy ? <OverviewEmpty icon={<CircleDollarSign size={22} aria-hidden="true" />} title={t("아직 평가할 자산이 없습니다.")} description={t("계좌나 매매 기록이 없어도 Contribution Plan은 독립적으로 사용할 수 있습니다.")} /> : <>
          {balanceSnapshot.totalValueKrw === 0 && <p className="portfolio-overview-neutral-note"><Info size={15} aria-hidden="true" />{t("현재 자산은 없지만 저장된 Allocation 목표는 확인할 수 있습니다.")}</p>}
          <div className="portfolio-overview-allocation-dashboard">
            <OverviewDonut weights={currentWeights} empty={!comparableAllocationRows.length} value={portfolioValue} />
            <div className="portfolio-overview-allocation-table">
              <div className="portfolio-overview-allocation-head"><span>{t("자산군")}</span><span>{t("현재와 허용 범위")}</span><span>{t("현재 / 목표")}</span><span>{t("차이")}</span></div>
              {allocationRows.map((row) => <article key={row.category} style={{ "--portfolio-group-accent": overviewAccent(row.category) } as CSSProperties}>
                <div className="portfolio-overview-asset-name"><i aria-hidden="true" /><span><b>{t(portfolioTargetAllocationCategoryName(row.category))}</b><small>{currentByCategory.get(row.category)?.currentValueKrw === null || currentByCategory.get(row.category)?.currentValueKrw === undefined ? "—" : formatCurrency(currentByCategory.get(row.category)!.currentValueKrw!, "KRW", localeTag)}</small></span></div>
                <OverviewRangeBar currentBps={row.current} targetBps={row.target} toleranceBps={state?.balancePolicy?.toleranceBps ?? null} />
                <strong>{row.current === null ? "—" : `${formatBps(row.current, formatNumber)}%`}<small>/ {row.target === null ? "—" : `${formatBps(row.target, formatNumber)}%`}</small></strong>
                <span className={row.outside ? "is-drift" : ""}>{row.drift === null ? "—" : signedBps(row.drift, formatNumber)}</span>
              </article>)}
            </div>
          </div>
        </>}
        {!state?.balancePolicy && <p className="portfolio-overview-card-note">{t("전체 목표를 등록하면 현재 비중과 목표의 차이를 함께 보여줍니다.")}</p>}
      </section>

      <section aria-labelledby="next-contribution-title" className="portfolio-overview-card">
        <div className="portfolio-overview-card-header"><div><p>{t("NEXT CONTRIBUTION")}</p><h2 id="next-contribution-title">{t("다음 저축 계획")}</h2><span>{t("저장된 Plan으로 계산한 다음 실행안입니다.")}</span></div>{suggestion && <span>{t(suggestion.source === "balanced" ? "균형 맞추기 제안" : suggestion.source === "withinTolerance" ? "기본 Plan 유지" : suggestion.source === "unavailable" ? "평가 불가 · 기본 Plan" : "고정 비율")}</span>}</div>
        {!activeRevision || !calculation ? <OverviewEmpty icon={<CheckCircle2 size={22} aria-hidden="true" />} title={t("아직 Contribution Plan이 없습니다.")} description={t("계좌 등록 여부와 관계없이 월 저축 비율과 세부 항목을 먼저 만들 수 있습니다.")} action={<Link href="/portfolio/plan">{t("Plan 만들기")}<ArrowRight size={15} aria-hidden="true" /></Link>} /> : <>
          <div className="portfolio-overview-contribution-total"><span>{t("다음 전체 저축액")}</span><strong>{contributionValue}</strong></div>
          {suggestion && <div className={`portfolio-overview-suggestion is-${suggestion.source}`}><span>{suggestion.source === "balanced" ? <Target size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}</span><p><b>{t(suggestion.source === "balanced" ? "부족한 자산군을 우선합니다." : suggestion.source === "withinTolerance" ? "기본 Plan 비율을 유지합니다." : suggestion.source === "unavailable" ? "현재 평가 없이 기본 Plan을 사용합니다." : "저장된 Plan 비율을 사용합니다.")}</b><small>{t("Plan에서 금액과 비율을 직접 확인하고 수정할 수 있습니다.")}</small></p></div>}
          <div className="portfolio-overview-contribution-list">{calculation.groups.map((group) => {
            const editorGroup = executionDraft.groups.find((item) => item.id === group.groupId);
            return <article key={group.groupId}><div><i aria-hidden="true" style={{ background: overviewAccent(editorGroup?.category ?? "stocks") }} /><span><b>{t(editorGroup ? portfolioPlanCategoryName(editorGroup.category) : group.name)}</b><small>{formatBps(group.targetWeightBps, formatNumber)}%</small></span></div><strong>{formatCurrency(minorUnitsToMajor(group.amountMinor, calculation.contributionCurrency), calculation.contributionCurrency, localeTag)}</strong></article>;
          })}</div>
          <Link href="/portfolio/plan" className="portfolio-overview-plan-link">{t("Plan에서 금액과 비율 수정")}<ArrowRight size={15} aria-hidden="true" /></Link>
        </>}
      </section>
    </div>

    {stockDetailTargets.length > 0 && <section className="portfolio-overview-card portfolio-overview-stock-plan" aria-labelledby="stock-plan-title">
      <div className="portfolio-overview-card-header"><div><p>{t("OPTIONAL STOCK DETAIL")}</p><h2 id="stock-plan-title">{t("종목별 다음 투자 계획")}</h2><span>{t("Allocation의 주식 세부 목표와 현재 보유 비중을 비교합니다.")}</span></div><div className="portfolio-overview-card-actions"><Link href="/portfolio/allocation">{t("비율 수정")}</Link><Link href="/portfolio/plan">{t("Plan 확인")}<ArrowRight size={14} aria-hidden="true" /></Link></div></div>
      <div className="portfolio-overview-stock-table">
        <div className="portfolio-overview-stock-head"><span>{t("종목")}</span><span>{t("현재와 허용 범위")}</span><span>{t("현재 / 목표")}</span><span>{t("다음 투자 금액")}</span></div>
        {stockDetailTargets.map((target) => {
          const stock = stockById.get(target.stockId);
          const current = stockCurrentById.get(target.stockId) ?? (stockSnapshot.available ? 0 : null);
          const drift = current === null ? null : current - target.targetWeightBps;
          const amountMinor = executionAmountByStockId.get(target.stockId);
          return <article key={target.stockId}>
            <div><i aria-hidden="true" /><span><b>{stock?.ticker ?? target.stockId}</b><small>{stock?.name ?? t("알 수 없는 종목")}</small></span></div>
            <OverviewRangeBar currentBps={current} targetBps={target.targetWeightBps} toleranceBps={state?.balancePolicy?.stockToleranceBps ?? null} />
            <strong>{current === null ? "—" : `${formatBps(current, formatNumber)}%`}<small>/ {formatBps(target.targetWeightBps, formatNumber)}%</small></strong>
            <span className={drift !== null && Math.abs(drift) > (state?.balancePolicy?.stockToleranceBps ?? 10000) ? "is-drift" : ""}>{amountMinor === undefined || !calculation ? "—" : formatCurrency(minorUnitsToMajor(amountMinor, calculation.contributionCurrency), calculation.contributionCurrency, localeTag)}</span>
          </article>;
        })}
      </div>
      <footer><Info size={15} aria-hidden="true" /><p>{t("주식 세부 허용 오차 {value}% · 설정하지 않으면 이 영역은 표시되지 않습니다.", { value: formatBps(state?.balancePolicy?.stockToleranceBps ?? 0, formatNumber) })}</p></footer>
    </section>}

    {!activeRevision && !state?.balancePolicy && <section className="portfolio-overview-start"><div><b>{t("처음 시작하시나요?")}</b><p>{t("Plan으로 월 저축액을 만들고, 필요할 때 Allocation에서 전체 자산 목표를 추가하세요.")}</p></div><div><Link href="/portfolio/plan">{t("Plan 만들기")}</Link><Link href="/portfolio/allocation">{t("Allocation 설정")}</Link></div></section>}

    <section className="portfolio-overview-disclaimer"><CheckCircle2 size={17} aria-hidden="true" /><p>{t("균형 맞추기는 매도를 제안하지 않으며, 저장된 기본 Plan을 자동으로 변경하지 않습니다. 모든 계산은 사용자가 직접 검토하고 수정할 수 있습니다.")}</p></section>
  </div>;
}

function OverviewMetric({ label, value, help, tone = "neutral" }: { label: string; value: string; help: string; tone?: "neutral" | "positive" | "warning" }) {
  return <article className={`is-${tone}`}><span>{label}</span><strong title={value}>{value}</strong><small>{help}</small></article>;
}

function OverviewEmpty({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="portfolio-overview-empty"><span>{icon}</span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

function OverviewDonut({ weights, empty, value }: { weights: Record<(typeof portfolioBalanceCategories)[number], number>; empty: boolean; value: string }) {
  const { t } = useI18n();
  const savings = weights.savings / 100;
  const stocks = weights.stocks / 100;
  const background = empty ? "var(--color-surface-muted)" : `conic-gradient(${overviewAccent("savings")} 0 ${savings}%, ${overviewAccent("stocks")} ${savings}% ${savings + stocks}%, ${overviewAccent("bonds")} ${savings + stocks}% 100%)`;
  return <div className="portfolio-overview-donut-wrap"><div className="portfolio-overview-donut" style={{ background }}><div><b>{empty ? "—" : value}</b><span>{t("현재 평가 금액")}</span></div></div><p>{t("현금성 자산 · 주식 · 채권")}</p></div>;
}

function OverviewRangeBar({ currentBps, targetBps, toleranceBps }: { currentBps: number | null; targetBps: number | null; toleranceBps: number | null }) {
  const target = targetBps ?? 0;
  const tolerance = toleranceBps ?? 0;
  const start = clampBps(target - tolerance);
  const end = clampBps(target + tolerance);
  const style = { "--overview-current": `${clampBps(currentBps ?? 0) / 100}%`, "--overview-target": `${clampBps(target) / 100}%`, "--overview-range-start": `${start / 100}%`, "--overview-range-width": `${(end - start) / 100}%` } as CSSProperties;
  return <div className="portfolio-overview-range" style={style} aria-hidden="true"><i className="range" /><i className="current" /><i className="target" /></div>;
}

function OverviewUnavailable({ reason }: { reason: PortfolioBalanceUnavailableReason }) {
  const { t } = useI18n();
  const message = reason === "missingPrice" ? "하나 이상의 보유 종목에 유효한 현재가가 없습니다."
    : reason === "invalidFx" ? "필요한 환율이 없거나 올바르지 않습니다."
      : reason === "unreconciledCash" ? "조정되지 않은 현금 기록이 있어 전체 배분을 확정할 수 없습니다."
        : reason === "missingStock" ? "보유 포지션에 연결된 종목을 찾을 수 없습니다."
          : reason === "ledgerError" ? "매매 원장 오류가 있어 현재 포트폴리오를 확정할 수 없습니다."
            : "현재 포트폴리오 값을 안전하게 계산할 수 없습니다.";
  return <div className="portfolio-overview-unavailable" role="status"><strong>{t("현재 자산 평가를 사용할 수 없습니다.")}</strong><p>{t(message)}</p><small>{t("다음 저축 계획은 저장된 기본 Plan 비율로 계속 계산합니다.")}</small></div>;
}

function overviewAccent(category: (typeof portfolioBalanceCategories)[number]) { return category === "savings" ? "#c9953f" : category === "stocks" ? "#238769" : "#5d85b2"; }
function formatBps(value: number, formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string) { return formatNumber(value / 100, { maximumFractionDigits: 2 }); }
function signedBps(value: number, formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string) { return `${value > 0 ? "+" : ""}${formatNumber(value / 100, { maximumFractionDigits: 2 })}%p`; }
function clampBps(value: number) { return Math.max(0, Math.min(10000, value)); }
function applyPortfolioCollections(stores: {
  stateStore: ReturnType<typeof useLocalCollection<PortfolioPlanState | LegacyPortfolioPlanStateV6>>;
  revisionStore: ReturnType<typeof useLocalCollection<PortfolioPlanRevision | LegacyPortfolioPlanRevisionV6>>;
  groupStore: ReturnType<typeof useLocalCollection<PortfolioAllocationGroup>>;
  targetStore: ReturnType<typeof useLocalCollection<PortfolioAllocationTarget | LegacyPortfolioAllocationTargetV6>>;
}, values: { states: PortfolioPlanState[]; revisions: PortfolioPlanRevision[]; groups: PortfolioAllocationGroup[]; targets: PortfolioAllocationTarget[] }) {
  stores.stateStore.applyCommitted(values.states); stores.revisionStore.applyCommitted(values.revisions); stores.groupStore.applyCommitted(values.groups); stores.targetStore.applyCommitted(values.targets);
}
