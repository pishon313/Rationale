"use client";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fromKrw } from "@/domain/currency";
import { formatCurrency } from "@/domain/money";
import { buildPerformanceAnalytics, type PerformanceGroup } from "@/domain/performance-analytics";
import type { TradingLedger } from "@/domain/trading-ledger";
import type { BuyPlan } from "@/features/plans/types";
import type { Trade } from "@/features/trades/types";
import { useI18n } from "@/i18n/i18n-provider";
import { localMonthValue } from "@/lib/local-date";
import { useCurrencyPreference, useExchangeRates } from "@/lib/use-exchange-rates";

export function PerformanceSections({ trades, plans, ledger }: { trades: Trade[]; plans: BuyPlan[]; ledger: TradingLedger }) {
  const { t, formatDate, formatNumber } = useI18n();
  const money = useDisplayMoney();
  const data = buildPerformanceAnalytics(trades, plans, ledger);
  const cards = [
    [t("완결 매매"), t("{count}회", { count: formatNumber(data.closedCycleCount) }), t("전량 매도한 포지션 기준")],
    [t("승률"), formatNumber(data.winRate / 100, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }), t("손익이 0보다 큰 완결 매매")],
    [t("평균 수익"), money.full(data.averageProfitKrw), t("수익 매매 평균")],
    [t("평균 손실"), money.full(data.averageLossKrw), t("손실 매매 평균")],
    [t("손익비"), data.payoffRatio === null ? "—" : `1 : ${formatNumber(data.payoffRatio, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, t("평균 손실 대비 평균 수익")],
    ["Profit Factor", data.profitFactor === null ? "—" : formatNumber(data.profitFactor, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), t("총이익 ÷ 총손실")],
  ];
  return <>
    <section className="mt-4"><div className="mb-3"><h2 className="font-semibold">{t("성과 분석")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("매수부터 전량 매도까지 하나의 완결 매매로 계산합니다.")}</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value, note]) => <article key={label} className="rounded-xl border bg-[var(--surface)] p-5"><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p><small className="mt-2 block text-[var(--muted)]">{note}</small></article>)}</div></section>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <ChartCard title={t("누적 성과 곡선")} note={t("매도 시점별 누적 실현손익")} empty={!data.equityCurve.length}><ResponsiveContainer width="100%" height={260}><LineChart data={data.equityCurve}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => formatDate(`${value}T00:00:00`, { month: "numeric", day: "numeric" })} /><YAxis tickFormatter={(value) => money.compact(Number(value))} width={84} /><Tooltip formatter={(value) => money.full(Number(value))} labelFormatter={(label) => formatDate(`${String(label)}T00:00:00`)} /><Line type="monotone" dataKey="cumulativeProfitKrw" name={t("누적 실현손익")} stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Drawdown" note={t("고점 대비 최대 하락 {amount}", { amount: money.full(data.maxDrawdownKrw) })} empty={!data.equityCurve.length}><ResponsiveContainer width="100%" height={260}><AreaChart data={data.equityCurve}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => formatDate(`${value}T00:00:00`, { month: "numeric", day: "numeric" })} /><YAxis tickFormatter={(value) => money.compact(Number(value))} width={84} /><Tooltip formatter={(value) => money.full(Number(value))} labelFormatter={(label) => formatDate(`${String(label)}T00:00:00`)} /><Area type="monotone" dataKey="drawdownKrw" name="Drawdown" stroke="#dc6464" fill="#dc646433" /></AreaChart></ResponsiveContainer></ChartCard>
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-3"><GroupTable title={t("종목별 성과")} rows={data.byStock} money={money} translateLabels={false} /><GroupTable title={t("전략별 성과")} rows={data.byStrategy} money={money} translateLabels /><GroupTable title={t("진입 감정별 성과")} rows={data.byEmotion} money={money} translateLabels /></div>
    <ReturnCalendar rows={data.calendar} money={money} />
  </>;
}

function GroupTable({ title, rows, money, translateLabels }: { title: string; rows: PerformanceGroup[]; money: DisplayMoney; translateLabels: boolean }) {
  const { t, formatNumber } = useI18n();
  return <section className="overflow-hidden rounded-xl border bg-[var(--surface)]"><h2 className="p-5 font-semibold">{title}</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-[var(--surface-muted)] text-xs text-[var(--muted)]"><tr><th className="px-4 py-3 text-left">{t("구분")}</th><th className="px-4 py-3 text-right">{t("완결")}</th><th className="px-4 py-3 text-right">{t("승률")}</th><th className="px-4 py-3 text-right">{t("손익")}</th></tr></thead><tbody>{rows.map((row) => <tr key={row.label} className="border-t"><td className="px-4 py-3 font-medium">{translateLabels ? t(row.label) : row.label}</td><td className="px-4 text-right">{formatNumber(row.count)}</td><td className="px-4 text-right">{formatNumber(row.winRate / 100, { style: "percent", maximumFractionDigits: 0 })}</td><td className={`px-4 text-right tabular-nums ${row.profitKrw < 0 ? "text-red-600" : row.profitKrw > 0 ? "text-emerald-600" : ""}`}>{money.full(row.profitKrw)}</td></tr>)}</tbody></table>{!rows.length && <p className="p-6 text-center text-sm text-[var(--muted)]">{t("완결된 매매가 없습니다.")}</p>}</div></section>;
}

function ReturnCalendar({ rows, money }: { rows: Array<{ date: string; profitKrw: number; tradeCount: number }>; money: DisplayMoney }) {
  const { t, formatDate, localeTag, formatNumber } = useI18n();
  const months = useMemo(() => [...new Set(rows.map((row) => row.date.slice(0, 7)))].sort().reverse(), [rows]);
  const [selected, setSelected] = useState<string | null>(null);
  const month = selected && months.includes(selected) ? selected : months[0] ?? currentMonth();
  const daily = new Map(rows.filter((row) => row.date.startsWith(month)).map((row) => [row.date, row]));
  const [year, monthNumber] = month.split("-").map(Number);
  const leading = new Date(year, monthNumber - 1, 1).getDay();
  const days = new Date(year, monthNumber, 0).getDate();
  const cells = [...Array(leading).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(localeTag, { weekday: "short" }).format(new Date(2026, 7, 2 + index)));
  const monthLabel = (value: string) => formatDate(`${value}-01T00:00:00`, { year: "numeric", month: "long" });
  return <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">{t("수익 달력")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("매도일 기준 일별 실현손익입니다.")}</p></div><select aria-label={t("수익 달력 월")} className="h-9 rounded-lg border bg-[var(--surface)] px-3 text-sm" value={month} onChange={(event) => setSelected(event.target.value)}>{months.length ? months.map((item) => <option key={item} value={item}>{monthLabel(item)}</option>) : <option value={month}>{monthLabel(month)}</option>}</select></div><div className="mt-5 grid grid-cols-7 gap-1 text-center text-xs"><>{weekdays.map((day) => <div key={day} className="py-2 text-[var(--muted)]">{day}</div>)}</>{cells.map((day, index) => { if (!day) return <div key={`empty-${index}`} />; const date = `${month}-${String(day).padStart(2, "0")}`; const result = daily.get(date); return <div key={date} className={`min-h-20 rounded-lg border p-2 text-left ${result?.profitKrw && result.profitKrw > 0 ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20" : result?.profitKrw && result.profitKrw < 0 ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20" : "bg-[var(--surface-muted)]"}`}><span>{formatNumber(day)}</span>{result && <><b className={`mt-2 block text-xs ${result.profitKrw < 0 ? "text-red-600" : "text-emerald-600"}`}>{money.compact(result.profitKrw)}</b><small className="mt-1 block text-[var(--muted)]">{t("{count}건", { count: formatNumber(result.tradeCount) })}</small></>}</div>; })}</div></section>;
}

function ChartCard({ title, note, empty, children }: { title: string; note: string; empty: boolean; children: React.ReactNode }) { const { t } = useI18n(); return <section className="rounded-xl border bg-[var(--surface)] p-5"><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm text-[var(--muted)]">{note}</p><div className="mt-5 h-[260px]">{empty ? <div className="grid h-full place-items-center text-sm text-[var(--muted)]">{t("매도 기록이 없습니다.")}</div> : children}</div></section>; }

type DisplayMoney = { full: (value: number) => string; compact: (value: number) => string };

function useDisplayMoney(): DisplayMoney {
  const { displayCurrency } = useCurrencyPreference();
  const rates = useExchangeRates();
  const { localeTag } = useI18n();
  const converted = (value: number) => fromKrw(value, displayCurrency, rates.snapshot.ratesToKrw);
  return {
    full: (value: number) => formatCurrency(converted(value), displayCurrency, localeTag),
    compact: (value: number) => new Intl.NumberFormat(localeTag, { style: "currency", currency: displayCurrency, notation: "compact", maximumFractionDigits: 1, signDisplay: "exceptZero" }).format(converted(value)),
  };
}
function currentMonth() { return localMonthValue(); }
