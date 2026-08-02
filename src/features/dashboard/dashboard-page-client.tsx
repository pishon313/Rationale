"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { AlertTriangle, BarChart3, ChartPie as CirclePie, ArrowUpRight, CalendarClock, CalendarDays, ClipboardCheck, Eye, Plus, StickyNote, Trash2, Wallet } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { buildAnalytics } from "@/domain/analytics";
import { currencies, fromKrw, toKrw as convertToKrw, type Currency } from "@/domain/currency";
import { formatCurrency } from "@/domain/money";
import { useLocalCollection } from "@/lib/use-local-collection";
import { sampleObservations } from "@/features/observations/sample-data";
import type { Observation } from "@/features/observations/types";
import { samplePlans } from "@/features/plans/sample-data";
import type { BuyPlan } from "@/features/plans/types";
import { sampleReviews } from "@/features/reviews/sample-data";
import type { Review } from "@/features/reviews/types";
import { sampleStocks } from "@/features/stocks/sample-data";
import { withComputed, type Stock, type StockComputed } from "@/features/stocks/types";
import { sampleTrades } from "@/features/trades/sample-data";
import type { Trade } from "@/features/trades/types";
import { buildTradingLedger, cashBalanceKrw } from "@/domain/trading-ledger";
import { migrateTrades, projectStocksFromTrades } from "@/features/trades/migrate-trades";
import { useCurrencyPreference, useExchangeRates } from "@/lib/use-exchange-rates";

const VIEW_KEY = "tradejournal.dashboard.asset-view";
const VIEW_EVENT = "tradejournal:asset-view";
const COLORS = ["#5f57d9", "#9087ee", "#45a99a", "#e0a144", "#d96b76", "#5d8cc9", "#a477bd", "#7c8b57"];
export function DashboardPageClient() {
  const exchangeRates = useExchangeRates();
  const currencyPreference = useCurrencyPreference();
  const rates = exchangeRates.snapshot.ratesToKrw;
  const displayCurrency = currencyPreference.displayCurrency;
  const display = (valueKrw: number) => formatCurrency(fromKrw(valueKrw, displayCurrency, rates), displayCurrency);
  const stocks = useLocalCollection<Stock>("stocks", sampleStocks);
  const plans = useLocalCollection<BuyPlan>("plans", samplePlans);
  const trades = useLocalCollection<Trade>("trades", sampleTrades);
  const observations = useLocalCollection<Observation>("observations", sampleObservations);
  const reviews = useLocalCollection<Review>("reviews", sampleReviews);
  const migration = migrateTrades(stocks.allItems, trades.allItems);
  const migratedTrades = migration.trades;
  const ledger = buildTradingLedger(migratedTrades);
  const holdings = projectStocksFromTrades(stocks.allItems, migratedTrades).filter((stock) => stock.quantity > 0).map(withComputed);
  const unresolvedStockIds = new Set(migration.unresolvedStockIds);
  const investedFromLedger = ledger.positions.filter((position) => position.quantity > 0 && !unresolvedStockIds.has(position.stockId)).reduce((sum, position) => sum + position.investedAmountKrw, 0);
  const unresolvedInvested = holdings.filter((stock) => unresolvedStockIds.has(stock.id)).reduce((sum, stock) => sum + convertToKrw(stock.investedAmount, stock.currency, rates), 0);
  const invested = investedFromLedger + unresolvedInvested;
  const marketValue = holdings.reduce((sum, stock) => sum + convertToKrw(stock.marketValue, stock.currency, rates), 0);
  const analytics = buildAnalytics(trades.items, reviews.items);
  const activePlans = plans.items.filter((plan) => !["완료", "취소", "무효화"].includes(plan.status));
  const reviewsDue = byDate(stocks.items, "nextReviewDate");
  const ledgerWarningCount = migration.warnings.length + ledger.errors.length;
  const metrics = [["총 투자 원금", display(invested), `원장 평균단가 · ${displayCurrency} 표시`], ["현재 평가금액", display(marketValue), `저장된 현재가 · 환율 ${exchangeRates.snapshot.rateDate ?? "기본값"}`], ["기록 현금", display(cashBalanceKrw(ledger, rates)), !ledger.cashBalances.length ? "현금 기록 없음" : ledger.cashBalances.every((item) => item.isReconciled) ? "입금 기록 기준" : "기초 입금 등록 필요"], ["실현손익", `${ledger.totalRealizedKrw >= 0 ? "+" : ""}${display(ledger.totalRealizedKrw)}`, "거래 당시 환율 반영"], ["미실현손익", `${marketValue - invested >= 0 ? "+" : ""}${display(marketValue - invested)}`, `${holdings.length}개 보유 종목`], ["계획 매매율", `${analytics.plannedTradeRate.toFixed(0)}%`, `매매 ${analytics.tradeCount}건 기준`]];

  return <><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-[var(--muted)]">개인용 로컬 투자 기록</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">오늘의 판단을 기록해 보세요.</h1></div><div className="flex flex-wrap items-center gap-2"><label className="flex h-10 items-center gap-2 rounded-lg border bg-[var(--surface)] px-3 text-sm"><span className="text-[var(--muted)]">표시 통화</span><select aria-label="대시보드 표시 통화" value={displayCurrency} onChange={(event) => void currencyPreference.setDisplayCurrency(event.target.value as Currency)} className="bg-transparent font-medium outline-none">{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label><Link href="/observations" className="flex h-10 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-white"><Plus size={17} />새 관찰 기록</Link></div></div>{ledgerWarningCount > 0 && <Link href="/trades" className="mt-4 flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><AlertTriangle size={18} className="shrink-0" /><span><b>원장 확인이 필요한 기록 {ledgerWarningCount}건</b><span className="mt-1 block">현재 요약에는 계산할 수 없는 기록이 제외됐습니다. 매매 원장에서 확인해 주세요.</span></span></Link>}<section aria-label="포트폴리오 요약" className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([label, value, note]) => <article key={label} className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center justify-between"><p className="text-sm text-[var(--muted)]">{label}</p><ArrowUpRight size={17} className="text-[var(--accent)]" /></div><p className="mt-4 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-[var(--muted)]">{note}</p></article>)}</section><div className="mt-4 grid gap-4 lg:grid-cols-3"><AssetAllocation holdings={holdings} total={marketValue} /><ScheduleCard title="다가오는 검토일" icon={<CalendarDays size={19} />} stocks={reviewsDue} dateKey="nextReviewDate" empty="예정된 검토일이 없습니다." /><EarningsScheduleCard stocks={stocks.items} /></div><section className="mt-4 grid gap-3 sm:grid-cols-3"><Quick href="/plans" icon={<ClipboardCheck size={18} />} label="진행 중 계획" value={`${activePlans.length}개`} /><Quick href="/observations" icon={<Eye size={18} />} label="관찰 기록" value={`${observations.items.length}개`} /><Quick href="/reviews" icon={<ArrowUpRight size={18} />} label="회고" value={`${reviews.items.length}개`} /></section><DashboardMemo /></>;
}

type DashboardNote = { id: string; content: string; updatedAt: string };
const emptyDashboardNote: DashboardNote = { id: "dashboard-note", content: "", updatedAt: "" };

function DashboardMemo() {
  const notes = useLocalCollection<DashboardNote>("dashboard-notes", [emptyDashboardNote]);
  const note = notes.items[0] ?? emptyDashboardNote;
  return <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><StickyNote size={19} className="text-[var(--accent)]" /><h2 className="font-semibold">자유 메모</h2></div><span className="text-xs text-[var(--muted)]">{note.updatedAt ? "자동 저장됨" : "이 Mac에 자동 저장"}</span></div>{notes.ready ? <MemoEditor key={note.updatedAt} note={note} onSave={(content) => notes.update({ ...note, content, updatedAt: new Date().toISOString() })} /> : <textarea aria-label="대시보드 자유 메모" disabled className="mt-4 min-h-36 w-full rounded-lg border bg-[var(--surface-muted)] p-4 opacity-60" placeholder="메모를 불러오는 중입니다." />}</section>;
}

function MemoEditor({ note, onSave }: { note: DashboardNote; onSave: (content: string) => void }) {
  const [content, setContent] = useState(note.content);
  return <textarea aria-label="대시보드 자유 메모" value={content} onChange={(event) => setContent(event.target.value)} onBlur={() => { if (content !== note.content) onSave(content); }} className="mt-4 min-h-36 w-full resize-y rounded-lg border bg-[var(--surface-muted)] p-4 text-sm leading-6 outline-none transition focus:border-[var(--accent)]" placeholder="이번 주 일정, 확인할 종목, 투자 아이디어 등을 자유롭게 적어보세요." />;
}

function AssetAllocation({ holdings, total }: { holdings: StockComputed[]; total: number }) {
  const exchangeRates = useExchangeRates();
  const currencyPreference = useCurrencyPreference();
  const rates = exchangeRates.snapshot.ratesToKrw;
  const displayCurrency = currencyPreference.displayCurrency;
  const view = useSyncExternalStore(subscribeView, getView, () => "bar");
  const data = holdings.map((stock) => {
    const value = convertToKrw(stock.marketValue, stock.currency, rates);
    return { name: stock.name, value, share: total ? value / total * 100 : 0 };
  });
  return <section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Wallet size={19} className="text-[var(--muted)]" /><h2 className="font-semibold">보유 자산</h2></div><div className="flex rounded-lg bg-[var(--surface-muted)] p-0.5" aria-label="자산 차트 보기"><ViewButton active={view === "bar"} label="막대형" onClick={() => setView("bar")}><BarChart3 size={15} /></ViewButton><ViewButton active={view === "donut"} label="도넛형" onClick={() => setView("donut")}><CirclePie size={15} /></ViewButton></div></div>{!holdings.length ? <Empty text="보유 종목이 없습니다." /> : view === "bar" ? <div className="mt-4 space-y-3">{data.map((item, index) => <div key={item.name}><div className="mb-1.5 flex justify-between text-sm"><span>{item.name}</span><span>{item.share.toFixed(1)}%</span></div><div className="h-2 rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full" style={{ width: `${item.share}%`, backgroundColor: COLORS[index % COLORS.length] }} /></div></div>)}</div> : <div className="mt-3"><div className="h-44"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72} paddingAngle={2}>{data.map((item, index) => <Cell key={item.name} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip formatter={(value) => formatCurrency(fromKrw(Number(value), displayCurrency, rates), displayCurrency)} /></PieChart></ResponsiveContainer></div><div className="grid grid-cols-2 gap-x-3 gap-y-2">{data.map((item, index) => <div key={item.name} className="flex min-w-0 items-center gap-2 text-xs"><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} /><span className="truncate">{item.name}</span><span className="ml-auto tabular-nums text-[var(--muted)]">{item.share.toFixed(1)}%</span></div>)}</div></div>}</section>;
}

function ViewButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) { return <button type="button" aria-label={label} aria-pressed={active} title={label} onClick={onClick} className={`grid size-7 place-items-center rounded-md ${active ? "bg-[var(--surface)] text-[var(--accent)] shadow-sm" : "text-[var(--muted)]"}`}>{children}</button>; }
function subscribeView(callback: () => void) { window.addEventListener(VIEW_EVENT, callback); return () => window.removeEventListener(VIEW_EVENT, callback); }
function getView(): "bar" | "donut" { return localStorage.getItem(VIEW_KEY) === "donut" ? "donut" : "bar"; }
function setView(view: "bar" | "donut") { localStorage.setItem(VIEW_KEY, view); window.dispatchEvent(new Event(VIEW_EVENT)); }
type DateKey = "nextReviewDate" | "nextEarningsDate";
function byDate(stocks: Stock[], key: DateKey) { return stocks.filter((stock) => stock[key]).sort((a, b) => (a[key] ?? "").localeCompare(b[key] ?? "")).slice(0, 4); }
function ScheduleCard({ title, icon, stocks, dateKey, empty }: { title: string; icon: React.ReactNode; stocks: Stock[]; dateKey: DateKey; empty: string }) { return <section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center gap-2 text-[var(--accent)]">{icon}<h2 className="font-semibold text-[var(--foreground)]">{title}</h2></div><div className="mt-4 space-y-1">{stocks.map((stock) => <Link key={stock.id} href={`/stocks/detail?id=${stock.id}`} className="block rounded-lg px-2 py-2.5 text-sm hover:bg-[var(--surface-muted)]"><span className="flex items-center justify-between"><span>{stock.name}</span><span className="text-[var(--muted)]">{stock[dateKey]}</span></span>{dateKey === "nextReviewDate" && stock.reviewNote && <span className="mt-1 block truncate text-xs text-[var(--muted)]">{stock.reviewNote}</span>}</Link>)}{!stocks.length && <Empty text={empty} />}</div></section>; }

type EarningsEvent = { id: string; name: string; ticker: string; date: string; updatedAt: string; deletedAt: string | null };

function EarningsScheduleCard({ stocks }: { stocks: Stock[] }) {
  const events = useLocalCollection<EarningsEvent>("earnings-events", []);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [date, setDate] = useState("");
  const stockItems = stocks.filter((stock) => stock.nextEarningsDate).map((stock) => ({ id: `stock:${stock.id}`, name: stock.name, ticker: stock.ticker, date: stock.nextEarningsDate as string, stockId: stock.id, customId: "" }));
  const customItems = events.items.map((event) => ({ id: `custom:${event.id}`, name: event.name, ticker: event.ticker, date: event.date, stockId: "", customId: event.id }));
  const items = [...stockItems, ...customItems].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || !date) return;
    events.add({ id: crypto.randomUUID(), name: name.trim(), ticker: ticker.trim().toUpperCase(), date, updatedAt: new Date().toISOString(), deletedAt: null });
    setName(""); setTicker(""); setDate(""); setAdding(false);
  }
  return <section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-[var(--accent)]"><CalendarClock size={19} /><h2 className="font-semibold text-[var(--foreground)]">다가오는 실적 발표</h2></div><button type="button" onClick={() => setAdding((value) => !value)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--accent-soft)]"><Plus size={14} />직접 추가</button></div>{adding && <form onSubmit={submit} className="mt-3 space-y-2 rounded-lg bg-[var(--surface-muted)] p-3"><input required aria-label="실적 발표 기업명" value={name} onChange={(event) => setName(event.target.value)} className="h-9 w-full rounded-md border bg-[var(--surface)] px-2 text-sm" placeholder="기업명" /><div className="grid grid-cols-2 gap-2"><input aria-label="실적 발표 티커" value={ticker} onChange={(event) => setTicker(event.target.value)} className="h-9 min-w-0 rounded-md border bg-[var(--surface)] px-2 text-sm" placeholder="티커 (선택)" /><input required aria-label="실적 발표 날짜" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-9 min-w-0 rounded-md border bg-[var(--surface)] px-2 text-sm" /></div><div className="flex justify-end gap-2"><button type="button" onClick={() => setAdding(false)} className="rounded-md px-2 py-1 text-xs text-[var(--muted)]">취소</button><button className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs text-white">추가</button></div></form>}<div className="mt-3 space-y-1">{items.map((item) => item.stockId ? <Link key={item.id} href={`/stocks/detail?id=${item.stockId}`} className="flex items-center justify-between rounded-lg px-2 py-2.5 text-sm hover:bg-[var(--surface-muted)]"><span className="min-w-0 truncate">{item.name}{item.ticker && <span className="ml-1 text-xs text-[var(--muted)]">{item.ticker}</span>}</span><span className="ml-2 shrink-0 text-[var(--muted)]">{item.date}</span></Link> : <div key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-[var(--surface-muted)]"><span className="min-w-0 flex-1 truncate">{item.name}{item.ticker && <span className="ml-1 text-xs text-[var(--muted)]">{item.ticker}</span>}</span><span className="shrink-0 text-[var(--muted)]">{item.date}</span><button type="button" aria-label={`${item.name} 실적 일정 삭제`} onClick={() => events.remove(item.customId)} className="text-[var(--muted)] hover:text-red-500"><Trash2 size={14} /></button></div>)}{!items.length && !adding && <Empty text="등록된 실적 발표일이 없습니다." />}</div></section>;
}
function Empty({ text }: { text: string }) { return <p className="py-8 text-center text-sm text-[var(--muted)]">{text}</p>; }
function Quick({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: string }) { return <Link href={href} className="flex items-center justify-between rounded-xl border bg-[var(--surface)] p-4 hover:border-[var(--accent)]"><span className="flex items-center gap-2 text-sm text-[var(--muted)]">{icon}{label}</span><b>{value}</b></Link>; }
