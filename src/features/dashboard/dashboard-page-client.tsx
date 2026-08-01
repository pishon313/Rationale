"use client";
import Link from "next/link";
import { ArrowUpRight, CalendarClock, CalendarDays, ClipboardCheck, Eye, Plus, Wallet } from "lucide-react";
import { buildAnalytics } from "@/domain/analytics";
import { useLocalCollection } from "@/lib/use-local-collection";
import { sampleObservations } from "@/features/observations/sample-data";
import type { Observation } from "@/features/observations/types";
import { samplePlans } from "@/features/plans/sample-data";
import type { BuyPlan } from "@/features/plans/types";
import { sampleReviews } from "@/features/reviews/sample-data";
import type { Review } from "@/features/reviews/types";
import { sampleStocks } from "@/features/stocks/sample-data";
import { withComputed, type Stock } from "@/features/stocks/types";
import { sampleTrades } from "@/features/trades/sample-data";
import type { Trade } from "@/features/trades/types";

const USD_KRW_ESTIMATE = 1380;
const won = new Intl.NumberFormat("ko-KR", { style: "currency", currency: "KRW", maximumFractionDigits: 0 });

export function DashboardPageClient() {
  const stocks = useLocalCollection<Stock>("stocks", sampleStocks);
  const plans = useLocalCollection<BuyPlan>("plans", samplePlans);
  const trades = useLocalCollection<Trade>("trades", sampleTrades);
  const observations = useLocalCollection<Observation>("observations", sampleObservations);
  const reviews = useLocalCollection<Review>("reviews", sampleReviews);
  const holdings = stocks.items.filter((stock) => stock.quantity > 0).map(withComputed);
  const toKrw = (value: number, currency: Stock["currency"]) => value * (currency === "USD" ? USD_KRW_ESTIMATE : 1);
  const invested = holdings.reduce((sum, stock) => sum + toKrw(stock.investedAmount, stock.currency), 0);
  const marketValue = holdings.reduce((sum, stock) => sum + toKrw(stock.marketValue, stock.currency), 0);
  const analytics = buildAnalytics(trades.items, reviews.items);
  const activePlans = plans.items.filter((plan) => !["완료", "취소", "무효화"].includes(plan.status));
  const reviewsDue = byDate(stocks.items, "nextReviewDate");
  const earningsDue = byDate(stocks.items, "nextEarningsDate");
  const metrics = [["총 투자 원금", won.format(invested), "USD는 1,380원 추정"], ["현재 평가금액", won.format(marketValue), "저장된 현재가 기준"], ["미실현손익", `${marketValue - invested >= 0 ? "+" : ""}${won.format(marketValue - invested)}`, `${holdings.length}개 보유 종목`], ["계획 매매율", `${analytics.plannedTradeRate.toFixed(0)}%`, `매매 ${analytics.tradeCount}건 기준`]];

  return <><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-[var(--muted)]">개인용 로컬 투자 기록</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">오늘의 판단을 기록해 보세요.</h1></div><Link href="/observations" className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white"><Plus size={17} />새 관찰 기록</Link></div><section aria-label="포트폴리오 요약" className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([label, value, note]) => <article key={label} className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center justify-between"><p className="text-sm text-[var(--muted)]">{label}</p><ArrowUpRight size={17} className="text-[var(--accent)]" /></div><p className="mt-4 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-[var(--muted)]">{note}</p></article>)}</section><div className="mt-4 grid gap-4 lg:grid-cols-3"><section className="rounded-xl border bg-[var(--surface)] p-5 lg:col-span-1"><div className="flex items-center justify-between"><h2 className="font-semibold">보유 자산</h2><Wallet size={19} className="text-[var(--muted)]" /></div><div className="mt-4 space-y-3">{holdings.map((stock) => { const share = marketValue ? toKrw(stock.marketValue, stock.currency) / marketValue * 100 : 0; return <div key={stock.id}><div className="mb-1.5 flex justify-between text-sm"><span>{stock.name}</span><span>{share.toFixed(1)}%</span></div><div className="h-2 rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${share}%` }} /></div></div>; })}{!holdings.length && <Empty text="보유 종목이 없습니다." />}</div></section><ScheduleCard title="다가오는 검토일" icon={<CalendarDays size={19} />} stocks={reviewsDue} dateKey="nextReviewDate" empty="예정된 검토일이 없습니다." /><ScheduleCard title="다가오는 실적 발표" icon={<CalendarClock size={19} />} stocks={earningsDue} dateKey="nextEarningsDate" empty="등록된 실적 발표일이 없습니다." /></div><section className="mt-4 grid gap-3 sm:grid-cols-3"><Quick href="/plans" icon={<ClipboardCheck size={18} />} label="진행 중 계획" value={`${activePlans.length}개`} /><Quick href="/observations" icon={<Eye size={18} />} label="관찰 기록" value={`${observations.items.length}개`} /><Quick href="/reviews" icon={<ArrowUpRight size={18} />} label="회고" value={`${reviews.items.length}개`} /></section></>;
}

type DateKey = "nextReviewDate" | "nextEarningsDate";
function byDate(stocks: Stock[], key: DateKey) { return stocks.filter((stock) => stock[key]).sort((a, b) => (a[key] ?? "").localeCompare(b[key] ?? "")).slice(0, 4); }
function ScheduleCard({ title, icon, stocks, dateKey, empty }: { title: string; icon: React.ReactNode; stocks: Stock[]; dateKey: DateKey; empty: string }) {
  return <section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center gap-2 text-[var(--accent)]">{icon}<h2 className="font-semibold text-[var(--foreground)]">{title}</h2></div><div className="mt-4 space-y-1">{stocks.map((stock) => <Link key={stock.id} href={`/stocks/detail?id=${stock.id}`} className="block rounded-lg px-2 py-2.5 text-sm hover:bg-[var(--surface-muted)]"><span className="flex items-center justify-between"><span>{stock.name}</span><span className="text-[var(--muted)]">{stock[dateKey]}</span></span>{dateKey === "nextReviewDate" && stock.reviewNote && <span className="mt-1 block truncate text-xs text-[var(--muted)]">{stock.reviewNote}</span>}</Link>)}{!stocks.length && <Empty text={empty} />}</div></section>;
}
function Empty({ text }: { text: string }) { return <p className="py-8 text-center text-sm text-[var(--muted)]">{text}</p>; }
function Quick({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: string }) { return <Link href={href} className="flex items-center justify-between rounded-xl border bg-[var(--surface)] p-4 hover:border-[var(--accent)]"><span className="flex items-center gap-2 text-sm text-[var(--muted)]">{icon}{label}</span><b>{value}</b></Link>; }
