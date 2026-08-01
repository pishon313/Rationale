"use client";
import { BarChart3, Brain, ClipboardCheck, ListChecks } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildAnalytics } from "@/domain/analytics";
import { useLocalCollection } from "@/lib/use-local-collection";
import { sampleReviews } from "@/features/reviews/sample-data";
import type { Review } from "@/features/reviews/types";
import { sampleTrades } from "@/features/trades/sample-data";
import type { Trade } from "@/features/trades/types";

export function AnalyticsPageClient() {
  const trades = useLocalCollection<Trade>("trades", sampleTrades);
  const reviews = useLocalCollection<Review>("reviews", sampleReviews);
  const summary = buildAnalytics(trades.items, reviews.items);
  const cards = [
    ["매매 횟수", `${summary.tradeCount}회`, ListChecks],
    ["계획 매매율", `${summary.plannedTradeRate.toFixed(0)}%`, ClipboardCheck],
    ["평균 원칙 점수", `${summary.averageRuleScore.toFixed(1)} / 5`, BarChart3],
    ["평균 과정 점수", `${summary.averageProcessScore.toFixed(1)} / 5`, Brain],
  ] as const;
  return <><div><p className="text-sm text-[var(--muted)]">기록을 행동 패턴으로 바꾸는 곳</p><h1 className="mt-1 text-2xl font-semibold">분석</h1></div><section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, Icon]) => <article key={label} className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center justify-between"><p className="text-sm text-[var(--muted)]">{label}</p><Icon size={18} className="text-[var(--accent)]" /></div><p className="mt-4 text-2xl font-semibold tabular-nums">{value}</p></article>)}</section><div className="mt-4 grid gap-4 lg:grid-cols-2"><ChartCard title="월별 매매 횟수" empty={!summary.monthlyTrades.length}><ResponsiveContainer width="100%" height={250}><BarChart data={summary.monthlyTrades}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" name="매매" fill="var(--accent)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard><ChartCard title="감정별 매매 횟수" empty={!summary.emotions.length}><ResponsiveContainer width="100%" height={250}><BarChart data={summary.emotions} layout="vertical"><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="emotion" width={72} /><Tooltip /><Bar dataKey="count" name="매매" fill="#7c6ee6" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></ChartCard></div><section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><h2 className="font-semibold">감정과 원칙 준수</h2><p className="mt-1 text-sm text-[var(--muted)]">매매 당시 감정별 평균 원칙 준수 점수입니다.</p><div className="mt-4 space-y-3">{summary.emotions.map((row) => <div key={row.emotion} className="grid grid-cols-[80px_1fr_60px] items-center gap-3 text-sm"><span>{row.emotion}</span><div className="h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${row.averageRuleScore / 5 * 100}%` }} /></div><span className="text-right tabular-nums">{row.averageRuleScore.toFixed(1)} / 5</span></div>)}</div></section>{summary.tradeCount < 10 && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">기록이 10건 이상 쌓이면 패턴의 신뢰도가 높아집니다. 현재 수치는 참고용으로 봐주세요.</p>}</>;
}

function ChartCard({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) { return <section className="rounded-xl border bg-[var(--surface)] p-5"><h2 className="font-semibold">{title}</h2><div className="mt-5 h-[250px]">{empty ? <div className="grid h-full place-items-center text-sm text-[var(--muted)]">표시할 기록이 없습니다.</div> : children}</div></section>; }
