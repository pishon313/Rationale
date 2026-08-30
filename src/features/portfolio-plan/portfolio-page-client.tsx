"use client";

import { ArrowRight, CheckCircle2, CircleDollarSign, Scale } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { minorUnitsToMajor } from "@/domain/currency";
import { buildPortfolioBalanceSnapshot, portfolioBalanceCategories, suggestContributionBalance, type PortfolioBalanceUnavailableReason } from "@/domain/portfolio-balance";
import { formatCurrency } from "@/domain/money";
import { useStockStore } from "@/features/stocks/use-stock-store";
import { useI18n } from "@/i18n/i18n-provider";
import { useExchangeRates } from "@/lib/use-exchange-rates";
import { useLocalCollection } from "@/lib/use-local-collection";
import { calculatePortfolioPlanDraft, portfolioPlanCategoryName, portfolioPlanCategoryWeights, portfolioPlanDraftFromActive, portfolioTargetAllocationCategoryName, withPortfolioPlanCategoryWeights } from "./portfolio-plan-draft";
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
  const suggestion = useMemo(() => state && baseWeights ? suggestContributionBalance({ snapshot: balanceSnapshot, policy: state.balancePolicy, baseWeightsBps: baseWeights, contributionAmountMinor: state.contributionAmountMinor, contributionCurrency: state.contributionCurrency, ratesToKrw: exchangeRates.snapshot.ratesToKrw }) : null, [balanceSnapshot, baseWeights, exchangeRates.snapshot.ratesToKrw, state]);
  const executionDraft = useMemo(() => suggestion && state?.balancePolicy?.mode === "balanceAssist" ? withPortfolioPlanCategoryWeights(draft, suggestion.weightsBps) : draft, [draft, state?.balancePolicy?.mode, suggestion]);
  const calculation = useMemo(() => activeRevision ? calculatePortfolioPlanDraft(executionDraft) : null, [activeRevision, executionDraft]);
  const holdingCount = stockStore.ledger.positions.filter((position) => position.quantity > 1e-8).length + stockStore.ledger.cashBalances.filter((cash) => Math.abs(cash.balance) > 1e-8).length;

  if (!ready || (legacy || repairState) && !migrationError) return <p className="py-20 text-center text-sm text-[var(--muted)]">{t("포트폴리오 계획을 불러오는 중입니다.")}</p>;
  if (migrationError) return <p role="alert" className="py-20 text-center text-sm text-red-700 dark:text-red-200">{migrationError}</p>;

  const contributionValue = state ? formatCurrency(minorUnitsToMajor(state.contributionAmountMinor, state.contributionCurrency), state.contributionCurrency, localeTag) : "—";
  const portfolioValue = balanceSnapshot.totalValueKrw === null ? "—" : formatCurrency(balanceSnapshot.totalValueKrw, "KRW", localeTag);
  const currentByCategory = new Map(balanceSnapshot.categories.map((row) => [row.category, row]));
  return <div className="portfolio-overview">
    <header className="portfolio-plan-heading">
      <div><p>{t("Portfolio Overview")}</p><h1>{t("현재 자산과 다음 저축 계획을 한눈에 보세요.")}</h1><span>{t("실제 보유 자산과 Contribution Plan은 서로 다른 기준으로 분리해 보여줍니다.")}</span></div>
      <div className="portfolio-plan-heading-badges">{state?.balancePolicy && <span className="portfolio-plan-mode-badge"><Scale size={14} aria-hidden="true" />{t(state.balancePolicy.mode === "balanceAssist" ? "균형 맞추기" : "전체 목표 등록됨")}</span>}{activeRevision && <span className="portfolio-plan-dirty-badge">{t("리비전 {number} · 현재 활성", { number: formatNumber(activeRevision.revisionNumber) })}</span>}</div>
    </header>

    <section aria-label={t("포트폴리오 요약")} className="portfolio-overview-kpis">
      <OverviewMetric label={t("현재 포트폴리오")} value={portfolioValue} help={balanceSnapshot.available ? t("현금과 보유 포지션의 평가 금액") : t("현재 평가 불가")} />
      <OverviewMetric label={t("보유 항목")} value={formatNumber(holdingCount)} help={t("포지션과 현금 잔액 포함")} />
      <OverviewMetric label={t("다음 전체 저축액")} value={contributionValue} help={activeRevision ? t("저장된 Contribution Plan 기준") : t("Plan을 만들면 계산됩니다.")} />
      <OverviewMetric label={t("계산 방식")} value={state?.balancePolicy?.mode === "balanceAssist" ? t("균형 맞추기") : t("고정 비율")} help={state?.balancePolicy ? t("전체 목표와 함께 사용") : t("Contribution Plan만 사용")} />
    </section>

    <div className="portfolio-overview-grid">
      <section aria-labelledby="current-allocation-title" className="portfolio-overview-card">
        <div className="portfolio-overview-card-header"><div><p>{t("CURRENT ASSETS")}</p><h2 id="current-allocation-title">{t("현재 자산 배분")}</h2><span>{t("실제 거래와 현금 기록으로 계산합니다.")}</span></div>{state?.balancePolicy ? <span>{t("목표 대비")}</span> : <span>{t("전체 목표 없음")}</span>}</div>
        {!balanceSnapshot.available ? <OverviewUnavailable reason={balanceSnapshot.unavailableReason} /> : balanceSnapshot.totalValueKrw === 0 ? <OverviewEmpty icon={<CircleDollarSign size={22} aria-hidden="true" />} title={t("아직 평가할 자산이 없습니다.")} description={t("계좌나 매매 기록이 없어도 Contribution Plan은 독립적으로 사용할 수 있습니다.")} /> : <div className="portfolio-overview-allocation-list">
          {portfolioBalanceCategories.map((category) => {
            const current = currentByCategory.get(category);
            const target = state?.balancePolicy?.targetWeightsBps[category] ?? null;
            const drift = target === null || current?.currentWeightBps === null || current?.currentWeightBps === undefined ? null : current.currentWeightBps - target;
            return <article key={category} className="portfolio-overview-allocation-row" style={{ "--portfolio-group-accent": overviewAccent(category) } as React.CSSProperties}>
              <div><i aria-hidden="true" /><span><b>{t(portfolioTargetAllocationCategoryName(category))}</b><small>{current?.currentValueKrw === null || current?.currentValueKrw === undefined ? "—" : formatCurrency(current.currentValueKrw, "KRW", localeTag)}</small></span></div>
              <div><span>{t("현재 비중")}</span><strong>{current?.currentWeightBps === null || current?.currentWeightBps === undefined ? "—" : `${formatNumber(current.currentWeightBps / 100, { maximumFractionDigits: 2 })}%`}</strong></div>
              {target !== null && <><div><span>{t("목표 비중")}</span><strong>{formatBps(target, formatNumber)}%</strong></div><div><span>{t("차이")}</span><strong className={drift !== null && Math.abs(drift) > state!.balancePolicy!.toleranceBps ? "is-drift" : ""}>{drift === null ? "—" : `${drift > 0 ? "+" : ""}${formatNumber(drift / 100, { maximumFractionDigits: 2 })}%p`}</strong></div></>}
            </article>;
          })}
        </div>}
        {!state?.balancePolicy && <p className="portfolio-overview-card-note">{t("전체 목표를 등록하면 현재 비중과 목표의 차이를 함께 보여줍니다.")}</p>}
      </section>

      <section aria-labelledby="next-contribution-title" className="portfolio-overview-card">
        <div className="portfolio-overview-card-header"><div><p>{t("NEXT CONTRIBUTION")}</p><h2 id="next-contribution-title">{t("다음 저축 계획")}</h2><span>{t("저장된 Plan으로 계산한 다음 실행안입니다.")}</span></div>{suggestion && <span>{t(suggestion.source === "balanced" ? "균형 맞추기 제안" : suggestion.source === "withinTolerance" ? "기본 Plan 유지" : suggestion.source === "unavailable" ? "평가 불가 · 기본 Plan" : "고정 비율")}</span>}</div>
        {!activeRevision || !calculation ? <OverviewEmpty icon={<CheckCircle2 size={22} aria-hidden="true" />} title={t("아직 Contribution Plan이 없습니다.")} description={t("계좌 등록 여부와 관계없이 월 저축 비율과 세부 항목을 먼저 만들 수 있습니다.")} action={<Link href="/portfolio/plan">{t("Plan 만들기")}<ArrowRight size={15} aria-hidden="true" /></Link>} /> : <>
          <div className="portfolio-overview-contribution-total"><span>{t("다음 전체 저축액")}</span><strong>{contributionValue}</strong></div>
          <div className="portfolio-overview-contribution-list">{calculation.groups.map((group) => {
            const editorGroup = executionDraft.groups.find((item) => item.id === group.groupId);
            return <article key={group.groupId}><div><i aria-hidden="true" style={{ background: overviewAccent(editorGroup?.category ?? "stocks") }} /><span><b>{t(editorGroup ? portfolioPlanCategoryName(editorGroup.category) : group.name)}</b><small>{formatBps(group.targetWeightBps, formatNumber)}%</small></span></div><strong>{formatCurrency(minorUnitsToMajor(group.amountMinor, calculation.contributionCurrency), calculation.contributionCurrency, localeTag)}</strong></article>;
          })}</div>
          <Link href="/portfolio/plan" className="portfolio-overview-plan-link">{t("Plan에서 금액과 비율 수정")}<ArrowRight size={15} aria-hidden="true" /></Link>
        </>}
      </section>
    </div>

    <section className="portfolio-overview-disclaimer"><CheckCircle2 size={17} aria-hidden="true" /><p>{t("균형 맞추기는 매도를 제안하지 않으며, 저장된 기본 Plan을 자동으로 변경하지 않습니다. 모든 계산은 사용자가 직접 검토하고 수정할 수 있습니다.")}</p></section>
  </div>;
}

function OverviewMetric({ label, value, help }: { label: string; value: string; help: string }) {
  return <article><span>{label}</span><strong title={value}>{value}</strong><small>{help}</small></article>;
}

function OverviewEmpty({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }) {
  return <div className="portfolio-overview-empty"><span>{icon}</span><h3>{title}</h3><p>{description}</p>{action}</div>;
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
function applyPortfolioCollections(stores: {
  stateStore: ReturnType<typeof useLocalCollection<PortfolioPlanState | LegacyPortfolioPlanStateV6>>;
  revisionStore: ReturnType<typeof useLocalCollection<PortfolioPlanRevision | LegacyPortfolioPlanRevisionV6>>;
  groupStore: ReturnType<typeof useLocalCollection<PortfolioAllocationGroup>>;
  targetStore: ReturnType<typeof useLocalCollection<PortfolioAllocationTarget | LegacyPortfolioAllocationTargetV6>>;
}, values: { states: PortfolioPlanState[]; revisions: PortfolioPlanRevision[]; groups: PortfolioAllocationGroup[]; targets: PortfolioAllocationTarget[] }) {
  stores.stateStore.applyCommitted(values.states); stores.revisionStore.applyCommitted(values.revisions); stores.groupStore.applyCommitted(values.groups); stores.targetStore.applyCommitted(values.targets);
}
