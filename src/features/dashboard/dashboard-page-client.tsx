"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { AlertTriangle, BarChart3, ChartPie as CirclePie, ArrowUpRight, CalendarClock, CalendarDays, CheckCircle2, ClipboardCheck, Eye, Plus, StickyNote, Trash2, Wallet } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { buildAnalytics } from "@/domain/analytics";
import { currencies, fromKrw, toKrw as convertToKrw, type Currency } from "@/domain/currency";
import { formatCurrency } from "@/domain/money";
import { useLocalCollection } from "@/lib/use-local-collection";
import type { Observation } from "@/features/observations/types";
import type { BuyPlan } from "@/features/plans/types";
import type { Review } from "@/features/reviews/types";
import { withComputed, type Stock, type StockComputed } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { buildTradingLedger, cashBalanceKrw } from "@/domain/trading-ledger";
import { migrateTrades, projectStocksFromTrades } from "@/features/trades/migrate-trades";
import { useCurrencyPreference, useExchangeRates } from "@/lib/use-exchange-rates";
import { useI18n } from "@/i18n/i18n-provider";
import { emptyDashboardNote, type DashboardNote } from "./dashboard-note";
import { PortfolioSummary } from "./portfolio-summary";
import type { InvestmentAccount } from "@/features/accounts/types";

const VIEW_KEY = "tradejournal.dashboard.asset-view";
const VIEW_EVENT = "tradejournal:asset-view";
const COLORS = ["#5f57d9", "#9087ee", "#45a99a", "#e0a144", "#d96b76", "#5d8cc9", "#a477bd", "#7c8b57"];
export function DashboardPageClient() {
  const { t, localeTag, formatDate, formatNumber } = useI18n();
  const exchangeRates = useExchangeRates();
  const currencyPreference = useCurrencyPreference();
  const rates = exchangeRates.snapshot.ratesToKrw;
  const displayCurrency = currencyPreference.displayCurrency;
  const display = (valueKrw: number) => formatCurrency(fromKrw(valueKrw, displayCurrency, rates), displayCurrency, localeTag);
  const stocks = useLocalCollection<Stock>("stocks", []);
  const plans = useLocalCollection<BuyPlan>("plans", []);
  const trades = useLocalCollection<Trade>("trades", []);
  const accounts = useLocalCollection<InvestmentAccount>("accounts", []);
  const observations = useLocalCollection<Observation>("observations", []);
  const reviews = useLocalCollection<Review>("reviews", []);
  const migration = migrateTrades(stocks.allItems, trades.allItems);
  const migratedTrades = migration.trades;
  const ledger = buildTradingLedger(migratedTrades, accounts.items);
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
  const rateDate = exchangeRates.snapshot.rateDate
    ? formatDate(`${exchangeRates.snapshot.rateDate}T00:00:00`, { dateStyle: "medium" })
    : t("기본값");
  const cash = cashBalanceKrw(ledger, rates);
  const unrealizedProfit = marketValue - invested;

  return <><div className="dashboard-heading"><div><p>{t("장기투자 의사결정 워크스페이스")}</p><h1>{t("오늘 판단할 일을 먼저 봅니다.")}</h1></div><div className="dashboard-heading-actions"><label><span>{t("표시 통화")}</span><select aria-label={t("대시보드 표시 통화")} value={displayCurrency} onChange={(event) => void currencyPreference.setDisplayCurrency(event.target.value as Currency)}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label><Link href="/observations" className="primary-action"><Plus size={17} />{t("관찰 기록")}</Link></div></div><DecisionQueue stocks={reviewsDue} plans={activePlans} />{ledgerWarningCount > 0 && <Link href="/trades" className="ledger-warning"><AlertTriangle size={18} /><span><b>{t("원장 확인이 필요한 기록 {count}건", { count: formatNumber(ledgerWarningCount) })}</b><small>{t("계산할 수 없는 기록은 현재 요약에서 제외했습니다. 매매 원장에서 확인해 주세요.")}</small></span><ArrowUpRight size={17} /></Link>}<PortfolioSummary invested={invested} marketValue={marketValue} cash={cash} realizedProfit={ledger.totalRealizedKrw} unrealizedProfit={unrealizedProfit} plannedTradeCount={analytics.plannedTradeCount} tradeCount={analytics.tradeCount} plannedTradeRate={analytics.plannedTradeRate} display={display} priceNote={t("저장된 현재가 · 환율 {date}", { date: rateDate })} /><div className="mt-4 grid gap-4 lg:grid-cols-3"><AssetAllocation holdings={holdings} total={marketValue} /><ScheduleCard title={t("다가오는 검토일")} icon={<CalendarDays size={19} />} stocks={reviewsDue} dateKey="nextReviewDate" empty={t("예정된 검토일이 없습니다.")} /><EarningsScheduleCard stocks={stocks.items} /></div><section className="dashboard-quick"><Quick href="/plans" icon={<ClipboardCheck size={18} />} label={t("진행 중 계획")} value={t("{count}개", { count: formatNumber(activePlans.length) })} /><Quick href="/observations" icon={<Eye size={18} />} label={t("관찰 기록")} value={t("{count}개", { count: formatNumber(observations.items.length) })} /><Quick href="/reviews" icon={<ArrowUpRight size={18} />} label={t("회고")} value={t("{count}개", { count: formatNumber(reviews.items.length) })} /></section><DashboardMemo /></>;
}

function DecisionQueue({ stocks, plans }: { stocks: Stock[]; plans: BuyPlan[] }) {
  const { t, formatDate, formatNumber } = useI18n();
  const items = stocks.slice(0, 3);
  const planItems = plans.slice(0, Math.max(0, 3 - items.length));
  return <section className="decision-queue" aria-labelledby="decision-queue-title"><div className="decision-queue-head"><div><span className="decision-mark"><CheckCircle2 size={17} /></span><div><h2 id="decision-queue-title">{t("현재 판단할 항목")}</h2><p>{t("가격보다 먼저, 기록해 둔 근거와 조건을 확인하세요.")}</p></div></div><span>{t("{count}개", { count: formatNumber(items.length + planItems.length) })}</span></div><div className="decision-list">{items.map((stock) => <Link key={stock.id} href={`/stocks/detail?id=${stock.id}`}><div><span>{t("검토 예정")}</span><b>{stock.name}</b><small>{stock.reviewNote || t("보유 근거와 무효화 조건을 다시 확인합니다.")}</small></div><time>{stock.nextReviewDate ? formatDate(`${stock.nextReviewDate}T00:00:00`, { dateStyle: "medium" }) : ""}</time><ArrowUpRight size={17} /></Link>)}{planItems.map((plan) => <Link key={plan.id} href="/plans"><div><span>{t("매수 계획")}</span><b>{plan.stockName}</b><small>{plan.title}</small></div><time>{t(plan.status)}</time><ArrowUpRight size={17} /></Link>)}{!items.length && !planItems.length && <div className="decision-empty"><CheckCircle2 size={20} /><div><b>{t("지금 확인할 판단이 없습니다.")}</b><p>{t("새로운 관찰을 남기거나 다음 검토일을 정해 보세요.")}</p></div><Link href="/observations">{t("관찰 기록")}</Link></div>}</div></section>;
}

function DashboardMemo() {
  const { t } = useI18n();
  const notes = useLocalCollection<DashboardNote>("dashboard-notes", [emptyDashboardNote]);
  const note = notes.items[0] ?? emptyDashboardNote;
  return <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><StickyNote size={19} className="text-[var(--accent)]" /><h2 className="font-semibold">{t("자유 메모")}</h2></div><span className="text-xs text-[var(--muted)]">{t(note.updatedAt ? "자동 저장됨" : "이 Mac에 자동 저장")}</span></div>{notes.ready ? <MemoEditor key={note.updatedAt} note={note} onSave={(content) => notes.update({ ...note, content, updatedAt: new Date().toISOString() })} /> : <textarea aria-label={t("대시보드 자유 메모")} disabled className="mt-4 min-h-36 w-full rounded-lg border bg-[var(--surface-muted)] p-4 opacity-60" placeholder={t("메모를 불러오는 중입니다.")} />}</section>;
}

function MemoEditor({ note, onSave }: { note: DashboardNote; onSave: (content: string) => void }) {
  const { t } = useI18n();
  const [content, setContent] = useState(note.content);
  return <textarea aria-label={t("대시보드 자유 메모")} value={content} onChange={(event) => setContent(event.target.value)} onBlur={() => { if (content !== note.content) onSave(content); }} className="mt-4 min-h-36 w-full resize-y rounded-lg border bg-[var(--surface-muted)] p-4 text-sm leading-6 outline-none transition focus:border-[var(--accent)]" placeholder={t("이번 주 일정, 확인할 종목, 투자 아이디어 등을 자유롭게 적어보세요.")} />;
}

function AssetAllocation({ holdings, total }: { holdings: StockComputed[]; total: number }) {
  const { t, localeTag, formatNumber } = useI18n();
  const exchangeRates = useExchangeRates();
  const currencyPreference = useCurrencyPreference();
  const rates = exchangeRates.snapshot.ratesToKrw;
  const displayCurrency = currencyPreference.displayCurrency;
  const view = useSyncExternalStore(subscribeView, getView, () => "bar");
  const data = holdings.map((stock) => {
    const value = convertToKrw(stock.marketValue, stock.currency, rates);
    return { name: stock.name, value, share: total ? value / total * 100 : 0 };
  });
  const displayShare = (share: number) => formatNumber(share / 100, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return <section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Wallet size={19} className="text-[var(--muted)]" /><h2 className="font-semibold">{t("보유 자산")}</h2></div><div className="flex rounded-lg bg-[var(--surface-muted)] p-0.5" aria-label={t("자산 차트 보기")}><ViewButton active={view === "bar"} label={t("막대형")} onClick={() => setView("bar")}><BarChart3 size={15} /></ViewButton><ViewButton active={view === "donut"} label={t("도넛형")} onClick={() => setView("donut")}><CirclePie size={15} /></ViewButton></div></div>{!holdings.length ? <Empty text={t("보유 종목이 없습니다.")} /> : view === "bar" ? <div className="mt-4 space-y-3">{data.map((item, index) => <div key={item.name}><div className="mb-1.5 flex justify-between text-sm"><span>{item.name}</span><span>{displayShare(item.share)}</span></div><div className="h-2 rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full" style={{ width: `${item.share}%`, backgroundColor: COLORS[index % COLORS.length] }} /></div></div>)}</div> : <div className="mt-3"><div className="h-44"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72} paddingAngle={2}>{data.map((item, index) => <Cell key={item.name} fill={COLORS[index % COLORS.length]} />)}</Pie><Tooltip formatter={(value) => formatCurrency(fromKrw(Number(value), displayCurrency, rates), displayCurrency, localeTag)} /></PieChart></ResponsiveContainer></div><div className="grid grid-cols-2 gap-x-3 gap-y-2">{data.map((item, index) => <div key={item.name} className="flex min-w-0 items-center gap-2 text-xs"><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length]} } /><span className="truncate">{item.name}</span><span className="ml-auto tabular-nums text-[var(--muted)]">{displayShare(item.share)}</span></div>)}</div></div>}</section>;
}

function ViewButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) { return <button type="button" aria-label={label} aria-pressed={active} title={label} onClick={onClick} className={`grid size-7 place-items-center rounded-md ${active ? "bg-[var(--surface)] text-[var(--accent)] shadow-sm" : "text-[var(--muted)]"}`}>{children}</button>; }
function subscribeView(callback: () => void) { window.addEventListener(VIEW_EVENT, callback); return () => window.removeEventListener(VIEW_EVENT, callback); }
function getView(): "bar" | "donut" { return localStorage.getItem(VIEW_KEY) === "donut" ? "donut" : "bar"; }
function setView(view: "bar" | "donut") { localStorage.setItem(VIEW_KEY, view); window.dispatchEvent(new Event(VIEW_EVENT)); }
type DateKey = "nextReviewDate" | "nextEarningsDate";
function byDate(stocks: Stock[], key: DateKey) { return stocks.filter((stock) => stock[key]).sort((a, b) => (a[key] ?? "").localeCompare(b[key] ?? "")).slice(0, 4); }
function ScheduleCard({ title, icon, stocks, dateKey, empty }: { title: string; icon: React.ReactNode; stocks: Stock[]; dateKey: DateKey; empty: string }) { const { formatDate } = useI18n(); return <section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center gap-2 text-[var(--accent)]">{icon}<h2 className="font-semibold text-[var(--foreground)]">{title}</h2></div><div className="mt-4 space-y-1">{stocks.map((stock) => <Link key={stock.id} href={`/stocks/detail?id=${stock.id}`} className="block rounded-lg px-2 py-2.5 text-sm hover:bg-[var(--surface-muted)]"><span className="flex items-center justify-between"><span>{stock.name}</span><span className="text-[var(--muted)]">{stock[dateKey] ? formatDate(`${stock[dateKey]}T00:00:00`, { dateStyle: "medium" }) : ""}</span></span>{dateKey === "nextReviewDate" && stock.reviewNote && <span className="mt-1 block truncate text-xs text-[var(--muted)]">{stock.reviewNote}</span>}</Link>)}{!stocks.length && <Empty text={empty} />}</div></section>; }

type EarningsEvent = { id: string; name: string; ticker: string; date: string; updatedAt: string; deletedAt: string | null };

function EarningsScheduleCard({ stocks }: { stocks: Stock[] }) {
  const { t, formatDate } = useI18n();
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
  return <section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-[var(--accent)]"><CalendarClock size={19} /><h2 className="font-semibold text-[var(--foreground)]">{t("다가오는 실적 발표")}</h2></div><button type="button" onClick={() => setAdding((value) => !value)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--accent-soft)]"><Plus size={14} />{t("직접 추가")}</button></div>{adding && <form onSubmit={submit} className="mt-3 space-y-2 rounded-lg bg-[var(--surface-muted)] p-3"><input required aria-label={t("실적 발표 기업명")} value={name} onChange={(event) => setName(event.target.value)} className="h-9 w-full rounded-md border bg-[var(--surface)] px-2 text-sm" placeholder={t("기업명")} /><div className="grid grid-cols-2 gap-2"><input aria-label={t("실적 발표 티커")} value={ticker} onChange={(event) => setTicker(event.target.value)} className="h-9 min-w-0 rounded-md border bg-[var(--surface)] px-2 text-sm" placeholder={t("티커 (선택)")} /><input required aria-label={t("실적 발표 날짜")} type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-9 min-w-0 rounded-md border bg-[var(--surface)] px-2 text-sm" /></div><div className="flex justify-end gap-2"><button type="button" onClick={() => setAdding(false)} className="rounded-md px-2 py-1 text-xs text-[var(--muted)]">{t("취소")}</button><button className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs text-white">{t("추가")}</button></div></form>}<div className="mt-3 space-y-1">{items.map((item) => item.stockId ? <Link key={item.id} href={`/stocks/detail?id=${item.stockId}`} className="flex items-center justify-between rounded-lg px-2 py-2.5 text-sm hover:bg-[var(--surface-muted)]"><span className="min-w-0 truncate">{item.name}{item.ticker && <span className="ml-1 text-xs text-[var(--muted)]">{item.ticker}</span>}</span><span className="ml-2 shrink-0 text-[var(--muted)]">{formatDate(`${item.date}T00:00:00`, { dateStyle: "medium" })}</span></Link> : <div key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-[var(--surface-muted)]"><span className="min-w-0 flex-1 truncate">{item.name}{item.ticker && <span className="ml-1 text-xs text-[var(--muted)]">{item.ticker}</span>}</span><span className="shrink-0 text-[var(--muted)]">{formatDate(`${item.date}T00:00:00`, { dateStyle: "medium" })}</span><button type="button" aria-label={t("{name} 실적 일정 삭제", { name: item.name })} onClick={() => events.remove(item.customId)} className="text-[var(--muted)] hover:text-red-500"><Trash2 size={14} /></button></div>)}{!items.length && !adding && <Empty text={t("등록된 실적 발표일이 없습니다.")} />}</div></section>;
}
function Empty({ text }: { text: string }) { return <p className="py-8 text-center text-sm text-[var(--muted)]">{text}</p>; }
function Quick({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: string }) { return <Link href={href} className="flex items-center justify-between rounded-xl border bg-[var(--surface)] p-4 hover:border-[var(--accent)]"><span className="flex items-center gap-2 text-sm text-[var(--muted)]">{icon}{label}</span><b>{value}</b></Link>; }
