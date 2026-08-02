"use client";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildPerformanceAnalytics, type PerformanceGroup } from "@/domain/performance-analytics";
import type { TradingLedger } from "@/domain/trading-ledger";
import type { BuyPlan } from "@/features/plans/types";
import type { Trade } from "@/features/trades/types";

export function PerformanceSections({ trades, plans, ledger }: { trades: Trade[]; plans: BuyPlan[]; ledger: TradingLedger }) {
  const data = buildPerformanceAnalytics(trades, plans, ledger);
  const cards = [
    ["완결 매매", `${data.closedCycleCount}회`, "전량 매도한 포지션 기준"],
    ["승률", `${data.winRate.toFixed(1)}%`, "손익이 0보다 큰 완결 매매"],
    ["평균 수익", won(data.averageProfitKrw), "수익 매매 평균"],
    ["평균 손실", won(data.averageLossKrw), "손실 매매 평균"],
    ["손익비", data.payoffRatio === null ? "—" : `1 : ${data.payoffRatio.toFixed(2)}`, "평균 손실 대비 평균 수익"],
    ["Profit Factor", data.profitFactor === null ? "—" : data.profitFactor.toFixed(2), "총이익 ÷ 총손실"],
  ];
  return <>
    <section className="mt-4"><div className="mb-3"><h2 className="font-semibold">성과 분석</h2><p className="mt-1 text-sm text-[var(--muted)]">매수부터 전량 매도까지 하나의 완결 매매로 계산합니다.</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards.map(([label, value, note]) => <article key={label} className="rounded-xl border bg-[var(--surface)] p-5"><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p><small className="mt-2 block text-[var(--muted)]">{note}</small></article>)}</div></section>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <ChartCard title="누적 성과 곡선" note="매도 시점별 누적 실현손익" empty={!data.equityCurve.length}><ResponsiveContainer width="100%" height={260}><LineChart data={data.equityCurve}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={shortDate} /><YAxis tickFormatter={compactWon} width={72} /><Tooltip formatter={(value) => won(Number(value))} labelFormatter={(label) => String(label)} /><Line type="monotone" dataKey="cumulativeProfitKrw" name="누적 실현손익" stroke="var(--accent)" strokeWidth={2.5} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></ChartCard>
      <ChartCard title="Drawdown" note={`고점 대비 최대 하락 ${won(data.maxDrawdownKrw)}`} empty={!data.equityCurve.length}><ResponsiveContainer width="100%" height={260}><AreaChart data={data.equityCurve}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="date" tickFormatter={shortDate} /><YAxis tickFormatter={compactWon} width={72} /><Tooltip formatter={(value) => won(Number(value))} /><Area type="monotone" dataKey="drawdownKrw" name="Drawdown" stroke="#dc6464" fill="#dc646433" /></AreaChart></ResponsiveContainer></ChartCard>
    </div>
    <div className="mt-4 grid gap-4 xl:grid-cols-3"><GroupTable title="종목별 성과" rows={data.byStock} /><GroupTable title="전략별 성과" rows={data.byStrategy} /><GroupTable title="진입 감정별 성과" rows={data.byEmotion} /></div>
    <ReturnCalendar rows={data.calendar} />
  </>;
}

function GroupTable({ title, rows }: { title: string; rows: PerformanceGroup[] }) {
  return <section className="overflow-hidden rounded-xl border bg-[var(--surface)]"><h2 className="p-5 font-semibold">{title}</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-[var(--surface-muted)] text-xs text-[var(--muted)]"><tr><th className="px-4 py-3 text-left">구분</th><th className="px-4 py-3 text-right">완결</th><th className="px-4 py-3 text-right">승률</th><th className="px-4 py-3 text-right">손익</th></tr></thead><tbody>{rows.map((row) => <tr key={row.label} className="border-t"><td className="px-4 py-3 font-medium">{row.label}</td><td className="px-4 text-right">{row.count}</td><td className="px-4 text-right">{row.winRate.toFixed(0)}%</td><td className={`px-4 text-right tabular-nums ${row.profitKrw < 0 ? "text-red-600" : row.profitKrw > 0 ? "text-emerald-600" : ""}`}>{won(row.profitKrw)}</td></tr>)}</tbody></table>{!rows.length && <p className="p-6 text-center text-sm text-[var(--muted)]">완결된 매매가 없습니다.</p>}</div></section>;
}

function ReturnCalendar({ rows }: { rows: Array<{ date: string; profitKrw: number; tradeCount: number }> }) {
  const months = useMemo(() => [...new Set(rows.map((row) => row.date.slice(0, 7)))].sort().reverse(), [rows]);
  const [selected, setSelected] = useState<string | null>(null);
  const month = selected && months.includes(selected) ? selected : months[0] ?? currentMonth();
  const daily = new Map(rows.filter((row) => row.date.startsWith(month)).map((row) => [row.date, row]));
  const [year, monthNumber] = month.split("-").map(Number);
  const leading = new Date(year, monthNumber - 1, 1).getDay();
  const days = new Date(year, monthNumber, 0).getDate();
  const cells = [...Array(leading).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)];
  return <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">수익 달력</h2><p className="mt-1 text-sm text-[var(--muted)]">매도일 기준 일별 실현손익입니다.</p></div><select aria-label="수익 달력 월" className="h-9 rounded-lg border bg-[var(--surface)] px-3 text-sm" value={month} onChange={(event) => setSelected(event.target.value)}>{months.length ? months.map((item) => <option key={item} value={item}>{item.replace("-", "년 ")}월</option>) : <option value={month}>{month.replace("-", "년 ")}월</option>}</select></div><div className="mt-5 grid grid-cols-7 gap-1 text-center text-xs"><>{["일", "월", "화", "수", "목", "금", "토"].map((day) => <div key={day} className="py-2 text-[var(--muted)]">{day}</div>)}</>{cells.map((day, index) => { if (!day) return <div key={`empty-${index}`} />; const date = `${month}-${String(day).padStart(2, "0")}`; const result = daily.get(date); return <div key={date} className={`min-h-20 rounded-lg border p-2 text-left ${result?.profitKrw && result.profitKrw > 0 ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20" : result?.profitKrw && result.profitKrw < 0 ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20" : "bg-[var(--surface-muted)]"}`}><span>{day}</span>{result && <><b className={`mt-2 block text-xs ${result.profitKrw < 0 ? "text-red-600" : "text-emerald-600"}`}>{compactWon(result.profitKrw)}</b><small className="mt-1 block text-[var(--muted)]">{result.tradeCount}건</small></>}</div>; })}</div></section>;
}

function ChartCard({ title, note, empty, children }: { title: string; note: string; empty: boolean; children: React.ReactNode }) { return <section className="rounded-xl border bg-[var(--surface)] p-5"><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm text-[var(--muted)]">{note}</p><div className="mt-5 h-[260px]">{empty ? <div className="grid h-full place-items-center text-sm text-[var(--muted)]">매도 기록이 없습니다.</div> : children}</div></section>; }
function won(value: number) { return new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 }).format(value); }
function compactWon(value: number) { return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value)}원`; }
function shortDate(value: string) { return value.slice(5).replace("-", "/"); }
function currentMonth() { return new Date().toISOString().slice(0, 7); }
