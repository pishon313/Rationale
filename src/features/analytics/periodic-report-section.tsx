"use client";
import { BookOpenCheck, CalendarRange } from "lucide-react";
import { useMemo, useState } from "react";
import { fromKrw } from "@/domain/currency";
import { formatCurrency } from "@/domain/money";
import { buildPeriodicReport, listReportPeriods, periodKey, type ReportPeriod } from "@/domain/periodic-report";
import type { TradingLedger } from "@/domain/trading-ledger";
import type { Review } from "@/features/reviews/types";
import type { Trade } from "@/features/trades/types";
import { useI18n } from "@/i18n/i18n-provider";
import { useCurrencyPreference, useExchangeRates } from "@/lib/use-exchange-rates";

export function PeriodicReportSection({ trades, reviews, ledger }: { trades: Trade[]; reviews: Review[]; ledger: TradingLedger }) {
  const { t, formatDate, formatNumber, localeTag } = useI18n();
  const { displayCurrency } = useCurrencyPreference();
  const rates = useExchangeRates();
  const money = (valueKrw: number) => formatCurrency(fromKrw(valueKrw, displayCurrency, rates.snapshot.ratesToKrw), displayCurrency, localeTag);
  const [period, setPeriod] = useState<ReportPeriod>("week");
  const [selected, setSelected] = useState("");
  const periods = useMemo(() => listReportPeriods(period, trades, reviews), [period, reviews, trades]);
  const fallback = periodKey(period, new Date().toISOString());
  const key = periods.includes(selected) ? selected : periods[0] ?? fallback;
  const report = buildPeriodicReport(period, key, trades, reviews, ledger);
  const metrics = [
    [t("매매 기록"), t("{count}건", { count: formatNumber(report.tradeCount) })],
    [t("실현손익"), money(report.realizedProfitKrw)],
    [t("완결 승률"), report.closedCount ? formatNumber(report.winRate / 100, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—"],
    [t("계획 매매율"), report.recordedTradeCount ? formatNumber(report.plannedTradeRate / 100, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "—"],
    [t("검토 전 가져오기"), t("{count}건", { count: formatNumber(report.unreviewedTradeCount) })],
    [t("원칙 위반"), t("{count}건", { count: formatNumber(report.violationCount) })],
    [t("작성한 회고"), t("{count}건", { count: formatNumber(report.reviewCount) })],
  ];
  const formatPeriod = (item: string) => {
    if (period === "month") return formatDate(`${item}-01T00:00:00`, { year: "numeric", month: "long" });
    const start = new Date(`${item}T00:00:00`); const end = new Date(start); end.setDate(end.getDate() + 6);
    return `${formatDate(start, { year: "numeric", month: "short", day: "numeric" })} – ${formatDate(end, { year: "numeric", month: "short", day: "numeric" })}`;
  };
  function changePeriod(next: ReportPeriod) { setPeriod(next); setSelected(""); }
  return <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex gap-3"><span className="grid size-10 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]"><CalendarRange size={19} /></span><div><h2 className="font-semibold">{t("주간·월간 리포트")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("성과와 반복된 실수를 한 번에 돌아봅니다.")}</p></div></div><div className="flex flex-wrap gap-2"><div className="flex rounded-lg bg-[var(--surface-muted)] p-1">{(["week", "month"] as const).map((item) => <button key={item} type="button" onClick={() => changePeriod(item)} className={`rounded-md px-3 py-1.5 text-sm ${period === item ? "bg-[var(--surface)] font-medium shadow-sm" : "text-[var(--muted)]"}`}>{item === "week" ? t("주간") : t("월간")}</button>)}</div><select aria-label={t("리포트 기간")} value={key} onChange={(event) => setSelected(event.target.value)} className="h-10 rounded-lg border bg-[var(--surface)] px-3 text-sm">{periods.length ? periods.map((item) => <option key={item} value={item}>{formatPeriod(item)}</option>) : <option value={key}>{formatPeriod(key)}</option>}</select></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-7">{metrics.map(([label, value]) => <div key={label} className="rounded-lg bg-[var(--surface-muted)] p-4"><p className="text-xs text-[var(--muted)]">{label}</p><p className="mt-2 font-semibold tabular-nums">{value}</p></div>)}</div><div className="mt-4 grid gap-4 lg:grid-cols-3"><article className="rounded-lg border p-4"><p className="text-xs text-[var(--muted)]">{t("최고 성과 종목")}</p><p className="mt-2 font-semibold">{report.bestStock ?? t("기록 없음")}</p>{report.bestStock && <p className={`mt-1 text-sm ${report.bestStockProfitKrw < 0 ? "text-red-600" : "text-emerald-600"}`}>{money(report.bestStockProfitKrw)}</p>}</article><article className="rounded-lg border p-4"><p className="text-xs text-[var(--muted)]">{t("반복된 실수 태그")}</p><div className="mt-2 flex flex-wrap gap-2">{report.mistakeTags.slice(0, 5).map((item) => <span key={item.tag} className="rounded-full bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-200">{item.tag} {formatNumber(item.count)}</span>)}{!report.mistakeTags.length && <span className="text-sm text-[var(--muted)]">{t("기록 없음")}</span>}</div></article><article className="rounded-lg border p-4"><div className="flex items-center gap-2"><BookOpenCheck size={15} className="text-[var(--accent)]" /><p className="text-xs text-[var(--muted)]">{t("이번 기간 배운 점")}</p></div><ul className="mt-2 space-y-1 text-sm">{report.lessons.slice(0, 3).map((lesson) => <li key={lesson}>· {lesson}</li>)}{!report.lessons.length && <li className="text-[var(--muted)]">{t("작성된 회고가 없습니다.")}</li>}</ul></article></div></section>;
}
