"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { comparePortfolioPlanByGroup } from "@/domain/portfolio-overview";
import { minorUnitsToMajor } from "@/domain/currency";
import { formatCurrency } from "@/domain/money";
import { useStockStore } from "@/features/stocks/use-stock-store";
import { useI18n } from "@/i18n/i18n-provider";
import { useExchangeRates } from "@/lib/use-exchange-rates";
import { useLocalCollection } from "@/lib/use-local-collection";
import { isLegacyPortfolioPlanV6Data, migratePortfolioPlanV6, persistPortfolioPlanV6Migration } from "./portfolio-plan-migration";
import type {
  LegacyPortfolioAllocationTargetV6,
  LegacyPortfolioPlanRevisionV6,
  LegacyPortfolioPlanStateV6,
  PortfolioAllocationGroup,
  PortfolioAllocationTarget,
  PortfolioPlanRevision,
  PortfolioPlanState,
} from "./types";

/** Temporary compile adapter. The final two-screen Overview and Plan UI is a later vertical slice. */
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
  const legacy = isLegacyPortfolioPlanV6Data({ states: stateStore.allItems, revisions: revisionStore.allItems, targets: targetStore.allItems });
  const states = legacy ? [] : stateStore.allItems as PortfolioPlanState[];
  const revisions = legacy ? [] : revisionStore.allItems as PortfolioPlanRevision[];
  const targets = useMemo(() => legacy ? [] : targetStore.allItems as PortfolioAllocationTarget[], [legacy, targetStore.allItems]);
  const state = states[0] ?? null;
  const activeRevision = revisions.find((revision) => revision.id === state?.activeRevisionId) ?? null;
  const comparison = useMemo(() => comparePortfolioPlanByGroup({
    revision: activeRevision,
    groups: groupStore.allItems,
    targets,
    ledger: stockStore.ledger,
    stocks: stockStore.allStocks,
    ratesToKrw: exchangeRates.snapshot.ratesToKrw,
  }), [activeRevision, exchangeRates.snapshot.ratesToKrw, groupStore.allItems, stockStore.allStocks, stockStore.ledger, targets]);
  const ready = stockStore.ready && exchangeRates.ready && stateStore.ready && revisionStore.ready && groupStore.ready && targetStore.ready;

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

  if (!ready || legacy && !migrationError) return <p className="py-20 text-center text-sm text-[var(--muted)]">{t("포트폴리오 계획을 불러오는 중입니다.")}</p>;
  if (migrationError) return <p role="alert" className="py-20 text-center text-sm text-red-700 dark:text-red-200">{migrationError}</p>;
  return <>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm text-[var(--muted)]">{t("의도한 배분과 실제 보유를 비교")}</p><h1 className="mt-1 text-2xl font-semibold">{t("포트폴리오")}</h1></div>
      {activeRevision && <div className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-xs text-[var(--accent)]">{t("리비전 {number} · 현재 활성", { number: formatNumber(activeRevision.revisionNumber) })}</div>}
    </div>
    {state?.repairDraft && <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><div><b>{t("계정 선택이 필요한 이전 포트폴리오 계획이 있습니다.")}</b><p className="mt-1">{t("새 계획을 활성화하기 전에 각 대상의 실행 계정을 선택해야 합니다.")}</p></div><Link href="/portfolio/plan" className="inline-flex min-h-10 items-center rounded-lg bg-amber-950 px-4 font-semibold text-amber-50 dark:bg-amber-100 dark:text-amber-950">{t("Plan에서 Account 연결")}</Link></section>}
    <section className="mt-6 grid gap-3 sm:grid-cols-2">
      <Metric label={t("Contribution Amount")} value={state ? formatCurrency(minorUnitsToMajor(state.contributionAmountMinor, state.contributionCurrency), state.contributionCurrency, localeTag) : "—"} />
      <Metric label={t("현재 포트폴리오")} value={comparison.totalCurrentValueKrw === null ? "—" : formatCurrency(comparison.totalCurrentValueKrw, "KRW", localeTag)} />
    </section>
    {!activeRevision ? <section className="mt-4 rounded-xl border bg-[var(--surface)] p-10 text-center text-sm text-[var(--muted)]">{t("활성 포트폴리오 계획이 없습니다.")}</section> : <section className="mt-4 overflow-hidden rounded-xl border bg-[var(--surface)]">
      <div className="border-b p-5"><h2 className="font-semibold">{t("Allocation Groups")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("이 화면은 새 Domain foundation을 확인하기 위한 임시 어댑터입니다.")}</p></div>
      <div className="divide-y">{comparison.groups.map((group) => <article key={group.groupId ?? "outside"} className="p-5"><div className="flex items-center justify-between gap-3"><h3 className="font-medium">{group.name}</h3><span className="tabular-nums text-sm">{formatNumber(group.targetWeight, { maximumFractionDigits: 2 })}%</span></div><p className="mt-2 text-sm text-[var(--muted)]">{t("현재 비중")}: {group.currentWeight === null ? "—" : `${formatNumber(group.currentWeight, { maximumFractionDigits: 2 })}%`} · {t("차이")}: {group.driftPercentagePoints === null ? "—" : `${formatNumber(group.driftPercentagePoints, { maximumFractionDigits: 2 })}%p`}</p></article>)}</div>
    </section>}
    <section className="mt-4 rounded-xl border bg-[var(--surface)] p-4 text-xs leading-5 text-[var(--muted)]">{t("이 화면은 사용자가 작성한 목표와 현재 상태의 차이를 설명하며 매수·매도 또는 리밸런싱을 권고하지 않습니다.")}</section>
  </>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border bg-[var(--surface)] p-4"><p className="text-xs font-medium text-[var(--muted)]">{label}</p><strong className="mt-2 block truncate text-xl tabular-nums" title={value}>{value}</strong></div>;
}
