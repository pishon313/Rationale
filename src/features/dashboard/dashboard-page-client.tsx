"use client";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { AlertTriangle, BarChart3, ChartPie as CirclePie, ArrowUpRight, CalendarClock, CalendarDays, ClipboardCheck, Eye, Plus, StickyNote, Trash2, Wallet } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { buildAnalytics } from "@/domain/analytics";
import { currencies, fromKrw, toKrw as convertToKrw, type Currency, type RatesToKrw } from "@/domain/currency";
import { formatCurrency } from "@/domain/money";
import { useLocalCollection } from "@/lib/use-local-collection";
import type { Observation } from "@/features/observations/types";
import type { BuyPlan } from "@/features/plans/types";
import type { Review } from "@/features/reviews/types";
import { withComputed, type Stock, type StockComputed } from "@/features/stocks/types";
import { marketSectorLabel } from "@/features/stocks/market-sectors";
import type { Trade } from "@/features/trades/types";
import { buildTradingLedger, cashBalanceKrw } from "@/domain/trading-ledger";
import { migrateTrades, projectStocksFromTrades } from "@/features/trades/migrate-trades";
import { useCurrencyPreference, useExchangeRates } from "@/lib/use-exchange-rates";
import { useI18n } from "@/i18n/i18n-provider";
import { emptyDashboardNote, type DashboardNote } from "./dashboard-note";
import { PortfolioSummary } from "./portfolio-summary";
import type { InvestmentAccount } from "@/features/accounts/types";
import { SampleOnboarding } from "@/features/sample-data/sample-onboarding";
import {
  buildAssetAllocationGroups,
  colorForAssetGroup,
  formatAllocationShare,
  type AssetAllocationGroup,
} from "./asset-allocation";
import {
  getAssetGroupingServerSnapshot,
  getAssetGroupingSnapshot,
  setAssetGrouping,
  subscribeAssetGrouping,
} from "./asset-grouping-preference";

const VIEW_KEY = "tradejournal.dashboard.asset-view";
const VIEW_EVENT = "tradejournal:asset-view";
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

  return <><div className="dashboard-heading"><div className="dashboard-heading-actions"><label><span>{t("표시 통화")}</span><select aria-label={t("대시보드 표시 통화")} value={displayCurrency} onChange={(event) => void currencyPreference.setDisplayCurrency(event.target.value as Currency)}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label><Link href="/observations" className="primary-action"><Plus size={17} />{t("관찰 기록")}</Link></div></div>{ledgerWarningCount > 0 && <Link href="/trades" className="ledger-warning"><AlertTriangle size={18} /><span><b>{t("원장 확인이 필요한 기록 {count}건", { count: formatNumber(ledgerWarningCount) })}</b><small>{t("계산할 수 없는 기록은 현재 요약에서 제외했습니다. 매매 원장에서 확인해 주세요.")}</small></span><ArrowUpRight size={17} /></Link>}<PortfolioSummary invested={invested} marketValue={marketValue} cash={cash} realizedProfit={ledger.totalRealizedKrw} unrealizedProfit={unrealizedProfit} plannedTradeCount={analytics.plannedTradeCount} tradeCount={analytics.tradeCount} plannedTradeRate={analytics.plannedTradeRate} display={display} priceNote={t("저장된 현재가 · 환율 {date}", { date: rateDate })} /><div className="mt-4 space-y-4"><AssetAllocation holdings={holdings} total={marketValue} /><div className="grid gap-4 lg:grid-cols-2"><ScheduleCard title={t("다가오는 검토일")} icon={<CalendarDays size={19} />} stocks={reviewsDue} dateKey="nextReviewDate" empty={t("예정된 검토일이 없습니다.")} /><EarningsScheduleCard stocks={stocks.items} /></div></div><section className="dashboard-quick"><Quick href="/plans" icon={<ClipboardCheck size={18} />} label={t("진행 중 계획")} value={t("{count}개", { count: formatNumber(activePlans.length) })} /><Quick href="/observations" icon={<Eye size={18} />} label={t("관찰 기록")} value={t("{count}개", { count: formatNumber(observations.items.length) })} /><Quick href="/reviews" icon={<ArrowUpRight size={18} />} label={t("회고")} value={t("{count}개", { count: formatNumber(reviews.items.length) })} /></section><DashboardMemo /></>;
}

function DashboardMemo() {
  const { t } = useI18n();
  const notes = useLocalCollection<DashboardNote>("dashboard-notes", [emptyDashboardNote]);
  const accounts = useLocalCollection<InvestmentAccount>("accounts", []);
  const stocks = useLocalCollection<Stock>("stocks", []);
  const trades = useLocalCollection<Trade>("trades", []);
  const note = notes.items[0] ?? emptyDashboardNote;
  if (accounts.ready && stocks.ready && trades.ready && !accounts.allItems.length && !stocks.allItems.length && !trades.allItems.length) return <SampleOnboarding />;
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
  const grouping = useSyncExternalStore(subscribeAssetGrouping, getAssetGroupingSnapshot, getAssetGroupingServerSnapshot);
  const data = buildAssetAllocationData(holdings, total, rates);
  const groups = buildAssetAllocationGroups(data, {
    mode: grouping,
    unspecifiedLabel: t(grouping === "portfolio-category" ? "내 분류 미지정" : "시장 섹터 미지정"),
    marketSectorLabel: (id) => marketSectorLabel(id, t),
  });
  const displayShare = (share: number) => formatAllocationShare(share, formatNumber);
  const allUnspecified = groups.length === 1 && groups[0].isUnspecified;
  const groupingHelp = grouping === "portfolio-category" ? t("내가 정한 대표 포트폴리오 그룹") : t("표준 산업 분류");
  const guidance = grouping === "portfolio-category" ? t("종목에서 내 분류 설정") : t("종목에서 시장 섹터 설정");
  return <section className="rounded-xl border bg-[var(--surface)] p-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-2"><Wallet size={19} className="text-[var(--muted)]" /><h2 className="font-semibold">{t("보유 자산")}</h2></div>
      <div className="flex flex-wrap items-start justify-end gap-3">
        <div>
          <span className="mb-1 block text-xs text-[var(--muted)]">{t("자산 그룹 기준")}</span>
          <div className="flex rounded-lg bg-[var(--surface-muted)] p-0.5" role="group" aria-label={t("자산 그룹 기준")}>
            <GroupingButton active={grouping === "portfolio-category"} label={t("내 분류")} onClick={() => setAssetGrouping("portfolio-category")} />
            <GroupingButton active={grouping === "market-sector"} label={t("시장 섹터")} onClick={() => setAssetGrouping("market-sector")} />
          </div>
          <p className="mt-1 text-right text-xs text-[var(--muted)]">{groupingHelp}</p>
        </div>
        <div>
          <span className="mb-1 block text-xs text-[var(--muted)]">{t("차트")}</span>
          <div className="flex rounded-lg bg-[var(--surface-muted)] p-0.5" role="group" aria-label={t("자산 차트 보기")}><ViewButton active={view === "bar"} label={t("막대형")} onClick={() => setView("bar")}><BarChart3 size={15} /></ViewButton><ViewButton active={view === "donut"} label={t("도넛형")} onClick={() => setView("donut")}><CirclePie size={15} /></ViewButton></div>
        </div>
      </div>
    </div>
    {!holdings.length ? <Empty text={t("보유 종목이 없습니다.")} /> : <>
      {allUnspecified && <div className="mt-4 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--muted)]"><span>{groups[0].name}</span><span aria-hidden="true"> · </span><Link href="/stocks" className="font-medium text-[var(--accent)] underline-offset-2 hover:underline">{guidance}</Link></div>}
      {view === "bar" ? <BarAllocation groups={groups} displayShare={displayShare} /> : <DonutAllocation groups={groups} displayShare={displayShare} formatValue={(value) => formatCurrency(fromKrw(value, displayCurrency, rates), displayCurrency, localeTag)} accessibleLabel={t("자산 배분 도넛 차트: {count}개 그룹", { count: formatNumber(groups.length) })} />}
    </>}
  </section>;
}

export function buildAssetAllocationData(holdings: StockComputed[], total: number, rates: RatesToKrw) {
  return holdings.map((stock) => {
    const value = convertToKrw(stock.marketValue, stock.currency, rates);
    return { id: stock.id, name: stock.name, value, share: total ? value / total * 100 : 0, portfolioCategory: stock.sector, marketSector: stock.marketSector ?? null };
  });
}

function BarAllocation({ groups, displayShare }: { groups: AssetAllocationGroup[]; displayShare: (share: number) => string }) {
  return <div className="mt-4 space-y-5" data-testid="asset-allocation-bar">{groups.map((group) => {
    const color = colorForAssetGroup(group.id);
    return <section key={group.id} data-group-id={group.id} data-group-color={color} data-group-share={group.share}><div className="mb-3 flex items-center gap-2 border-b pb-2 text-sm"><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} /><h3 className="min-w-0 truncate font-semibold" title={group.name}>{group.name}</h3><span className="ml-auto shrink-0 tabular-nums text-[var(--muted)]">{displayShare(group.share)}</span></div><div className="space-y-3 border-l pl-4" style={{ borderColor: color }}>{group.holdings.map((item) => <div key={item.id} data-holding-share={item.share} title={`${item.name}: ${displayShare(item.share)}`}><div className="mb-1.5 flex justify-between gap-3 text-sm"><span className="min-w-0 truncate" title={item.name}>{item.name}</span><span className="shrink-0 tabular-nums">{displayShare(item.share)}</span></div><div className="h-2 rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full" style={{ width: item.share > 0 ? `max(2px, ${Math.min(item.share, 100)}%)` : "0%", backgroundColor: color }} /></div></div>)}</div></section>;
  })}</div>;
}

function DonutAllocation({ groups, displayShare, formatValue, accessibleLabel }: { groups: AssetAllocationGroup[]; displayShare: (share: number) => string; formatValue: (value: number) => string; accessibleLabel: string }) {
  return <div className="mt-4 grid items-start gap-5 sm:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]" data-testid="asset-allocation-donut"><div className="h-48 min-w-0" role="img" aria-label={accessibleLabel} data-testid="asset-allocation-donut-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={groups} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2}>{groups.map((group) => <Cell key={group.id} fill={colorForAssetGroup(group.id)} />)}</Pie><Tooltip formatter={(value, _name, item) => {
      const group = item.payload as AssetAllocationGroup;
      return [`${formatValue(Number(value))} · ${displayShare(group.share)}`, group.name];
    }} /></PieChart></ResponsiveContainer></div><div className="grid min-w-0 grid-cols-1 gap-y-4" data-testid="asset-allocation-donut-legend">{groups.map((group) => {
      const color = colorForAssetGroup(group.id);
      return <section key={group.id} data-group-id={group.id} data-group-color={color} data-group-share={group.share}><div className="flex min-w-0 items-center gap-2 text-sm"><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} /><h3 className="min-w-0 truncate font-semibold" title={group.name}>{group.name}</h3><span className="ml-auto shrink-0 tabular-nums text-[var(--muted)]">{displayShare(group.share)}</span></div><div className="ml-4 mt-1.5 space-y-1">{group.holdings.map((item) => <div key={item.id} data-holding-share={item.share} className="flex min-w-0 gap-2 text-xs text-[var(--muted)]" title={`${item.name}: ${displayShare(item.share)}`}><span className="min-w-0 truncate" title={item.name}>{item.name}</span><span className="ml-auto shrink-0 tabular-nums">{displayShare(item.share)}</span></div>)}</div></section>;
    })}</div></div>;
}

function GroupingButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) { return <button type="button" aria-pressed={active} title={label} onClick={onClick} className={`rounded-md px-3 py-1.5 text-xs font-medium ${active ? "bg-[var(--surface)] text-[var(--accent)] shadow-sm" : "text-[var(--muted)]"}`}>{label}</button>; }
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
  return <section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-[var(--accent)]"><CalendarClock size={19} /><h2 className="font-semibold text-[var(--foreground)]">{t("다가오는 실적 발표")}</h2></div><button type="button" onClick={() => setAdding((value) => !value)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[var(--accent)] hover:bg-[var(--accent-soft)]"><Plus size={14} />{t("직접 추가")}</button></div>{adding && <form onSubmit={submit} className="mt-3 space-y-2 rounded-lg bg-[var(--surface-muted)] p-3"><input required aria-label={t("실적 발표 기업명")} value={name} onChange={(event) => setName(event.target.value)} className="h-9 w-full rounded-md border bg-[var(--surface)] px-2 text-sm" placeholder={t("기업명")} /><div className="grid grid-cols-2 gap-2"><input aria-label={t("실적 발표 티커")} value={ticker} onChange={(event) => setTicker(event.target.value)} className="h-9 min-w-0 rounded-md border bg-[var(--surface)] px-2 text-sm" placeholder={t("티커 (선택)")} /><input required aria-label={t("실적 발표 날짜")} type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-9 min-w-0 rounded-md border bg-[var(--surface)] px-2 text-sm" /></div><div className="flex justify-end gap-2"><button type="button" onClick={() => setAdding(false)} className="rounded-md px-2 py-1 text-xs text-[var(--muted)]">{t("취소")}</button><button className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs text-white">{t("추가")}</button></div></form>}<div className="mt-3 space-y-1">{items.map((item) => item.stockId ? <Link key={item.id} href={`/stocks/detail?id=${item.stockId}`} className="flex items-center justify-between rounded-lg px-2 py-2.5 text-sm hover:bg-[var(--surface-muted)]"><span className="min-w-0 truncate">{item.name}{item.ticker && <span className="ml-1 text-xs text-[var(--muted)]">{item.ticker}</span>}</span><span className="ml-2 shrink-0 text-[var(--muted)]">{formatDate(`${item.date}T00:00:00`, { dateStyle: "medium" })}</span></Link> : <div key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm hover:bg-[var(--surface-muted)]"><span className="min-w-0 flex-1 truncate">{item.name}{item.ticker && <span className="ml-1 text-xs text-[var(--muted)]">{item.ticker}</span>}</span><span className="shrink-0 text-[var(--muted)]">{formatDate(`${item.date}T00:00:00`, { dateStyle: "medium" })}</span><button type="button" aria-label={t("{name} 실적 일정 삭제", { name: item.name })} onClick={() => events.remove(item.customId)} className="destructive-icon-action grid size-8 place-items-center rounded-md"><Trash2 size={14} /></button></div>)}{!items.length && !adding && <Empty text={t("등록된 실적 발표일이 없습니다.")} />}</div></section>;
}
function Empty({ text }: { text: string }) { return <p className="py-8 text-center text-sm text-[var(--muted)]">{text}</p>; }
function Quick({ href, icon, label, value }: { href: string; icon: React.ReactNode; label: string; value: string }) { return <Link href={href} className="flex items-center justify-between rounded-xl border bg-[var(--surface)] p-4 hover:border-[var(--accent)]"><span className="flex items-center gap-2 text-sm text-[var(--muted)]">{icon}{label}</span><b>{value}</b></Link>; }
