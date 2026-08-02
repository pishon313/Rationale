"use client";
import { BarChart3, Brain, ClipboardCheck, ListChecks } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { buildAnalytics } from "@/domain/analytics";
import { buildPlanPerformance } from "@/domain/plan-performance";
import { buildTradingLedger } from "@/domain/trading-ledger";
import { samplePlans } from "@/features/plans/sample-data";
import type { BuyPlan } from "@/features/plans/types";
import { sampleReviews } from "@/features/reviews/sample-data";
import type { Review } from "@/features/reviews/types";
import { sampleTrades } from "@/features/trades/sample-data";
import type { Trade } from "@/features/trades/types";
import { useLocalCollection } from "@/lib/use-local-collection";
import { PerformanceSections } from "./performance-sections";
import { PeriodicReportSection } from "./periodic-report-section";

export function AnalyticsPageClient() {
  const trades = useLocalCollection<Trade>("trades", sampleTrades);
  const plans = useLocalCollection<BuyPlan>("plans", samplePlans);
  const reviews = useLocalCollection<Review>("reviews", sampleReviews);
  const summary = buildAnalytics(trades.items, reviews.items);
  const ledger = buildTradingLedger(trades.items);
  const performance = plans.items.map((plan) => buildPlanPerformance(plan, trades.items, ledger)).filter((item) => item.buyQuantity > 0);
  const violations = trades.items.flatMap((trade) => (trade.ruleViolations ?? []).map((violation) => ({ trade, violation })));
  const cards = [["매매 횟수", `${summary.tradeCount}회`, ListChecks], ["계획 매매율", `${summary.plannedTradeRate.toFixed(0)}%`, ClipboardCheck], ["평균 원칙 점수", `${summary.averageRuleScore.toFixed(1)} / 5`, BarChart3], ["평균 과정 점수", `${summary.averageProcessScore.toFixed(1)} / 5`, Brain]] as const;
  return <>
    <div><p className="text-sm text-[var(--muted)]">기록을 행동 패턴으로 바꾸는 곳</p><h1 className="mt-1 text-2xl font-semibold">분석</h1></div>
    <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, Icon]) => <article key={label} className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center justify-between"><p className="text-sm text-[var(--muted)]">{label}</p><Icon size={18} className="text-[var(--accent)]" /></div><p className="mt-4 text-2xl font-semibold tabular-nums">{value}</p></article>)}</section>
    <div className="mt-4 grid gap-4 lg:grid-cols-2"><ChartCard title="월별 매매 횟수" empty={!summary.monthlyTrades.length}><ResponsiveContainer width="100%" height={250}><BarChart data={summary.monthlyTrades}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="month" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" name="매매" fill="var(--accent)" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></ChartCard><ChartCard title="감정별 매매 횟수" empty={!summary.emotions.length}><ResponsiveContainer width="100%" height={250}><BarChart data={summary.emotions} layout="vertical"><CartesianGrid strokeDasharray="3 3" horizontal={false} /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="emotion" width={72} /><Tooltip /><Bar dataKey="count" name="매매" fill="#7c6ee6" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></ChartCard></div>
    <PerformanceSections trades={trades.items} plans={plans.items} ledger={ledger} />
    <PeriodicReportSection trades={trades.items} reviews={reviews.items} ledger={ledger} />
    <section className="mt-4 overflow-hidden rounded-xl border bg-[var(--surface)]"><div className="p-5"><h2 className="font-semibold">계획 대비 실제 결과</h2><p className="mt-1 text-sm text-[var(--muted)]">계획 가격·수량·금액과 실제 체결, 실현 R-Multiple을 비교합니다.</p></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-[var(--surface-muted)] text-xs text-[var(--muted)]"><tr>{["계획", "가격 편차", "수량 편차", "금액 편차", "계획 손익비", "실현손익", "R-Multiple"].map((item) => <th key={item} className="whitespace-nowrap px-4 py-3">{item}</th>)}</tr></thead><tbody>{performance.map((item) => <tr key={item.plan.id} className="border-t"><td className="px-4 py-3"><b>{item.plan.stockName}</b><small className="block text-[var(--muted)]">{item.plan.title}</small></td><Metric value={item.priceDeviationPercent} /><Metric value={item.quantityDeviationPercent} /><Metric value={item.amountDeviationPercent} /><td className="px-4 text-right">{item.rewardRiskRatio ? `1 : ${item.rewardRiskRatio.toFixed(2)}` : "—"}</td><td className="px-4 text-right tabular-nums">{item.soldQuantity ? signed(item.realizedProfit) : "—"}</td><td className="px-4 text-right font-medium">{item.rMultiple === null ? "—" : `${item.rMultiple.toFixed(2)}R`}</td></tr>)}</tbody></table>{!performance.length && <p className="p-6 text-center text-sm text-[var(--muted)]">계획에 연결된 매수 기록이 없습니다.</p>}</div></section>
    <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><h2 className="font-semibold">원칙 위반 기록</h2><p className="mt-1 text-sm text-[var(--muted)]">거래 저장 시점의 경고를 보존하므로 원칙을 나중에 수정해도 기록은 유지됩니다.</p><div className="mt-4 space-y-3">{violations.map(({ trade, violation }, index) => <article key={`${trade.id}-${violation.ruleId}-${index}`} className="rounded-lg bg-[var(--surface-muted)] p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><b>{violation.title}</b><span className="text-xs text-[var(--muted)]">{trade.stockName} · {new Date(trade.tradedAt).toLocaleDateString("ko-KR")} · {violation.severity}</span></div><p className="mt-2 text-[var(--muted)]">{violation.message}</p></article>)}{!violations.length && <p className="text-sm text-[var(--muted)]">저장된 원칙 위반 기록이 없습니다.</p>}</div></section>
    <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><h2 className="font-semibold">감정과 원칙 준수</h2><p className="mt-1 text-sm text-[var(--muted)]">매매 당시 감정별 평균 원칙 준수 점수입니다.</p><div className="mt-4 space-y-3">{summary.emotions.map((row) => <div key={row.emotion} className="grid grid-cols-[80px_1fr_60px] items-center gap-3 text-sm"><span>{row.emotion}</span><div className="h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${row.averageRuleScore / 5 * 100}%` }} /></div><span className="text-right tabular-nums">{row.averageRuleScore.toFixed(1)} / 5</span></div>)}</div></section>
    {summary.tradeCount < 10 && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">기록이 10건 이상 쌓이면 패턴의 신뢰도가 높아집니다. 현재 수치는 참고용으로 봐주세요.</p>}
  </>;
}

function Metric({ value }: { value: number | null }) { return <td className="px-4 text-right tabular-nums">{value === null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`}</td>; }
function signed(value: number) { return `${value > 0 ? "+" : ""}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }
function ChartCard({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) { return <section className="rounded-xl border bg-[var(--surface)] p-5"><h2 className="font-semibold">{title}</h2><div className="mt-5 h-[250px]">{empty ? <div className="grid h-full place-items-center text-sm text-[var(--muted)]">표시할 기록이 없습니다.</div> : children}</div></section>; }
