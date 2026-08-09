"use client";

import Link from "next/link";
import { ArrowLeft, CalendarClock, CalendarDays, Edit3, Lightbulb, MessageSquareText, Pencil, Plus, Target, Trash2, TrendingUp, WalletCards } from "lucide-react";
import { useState } from "react";
import { ObservationForm } from "@/features/observations/observations-page-client";
import type { Observation } from "@/features/observations/types";
import { ReviewForm } from "@/features/reviews/reviews-page-client";
import type { Review } from "@/features/reviews/types";
import type { Trade } from "@/features/trades/types";
import { buildTradingLedger, tradeAmount } from "@/domain/trading-ledger";
import { TradeForm } from "@/features/trades/trade-form";
import { buildSoftDeletedTrades, commitTradeMutation } from "@/features/trades/trade-mutations";
import { translateTradeText } from "@/features/trades/trade-i18n";
import type { BuyPlan } from "@/features/plans/types";
import type { InvestmentRule } from "@/features/rules/types";
import { useI18n } from "@/i18n/i18n-provider";
import { useLocalCollection } from "@/lib/use-local-collection";
import { StockForm } from "./stock-form";
import { useStockStore } from "./use-stock-store";
import { withComputed } from "./types";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { StockAccountHolding } from "./stock-account-holdings";

type TradeContext = { trade?: Trade; initialType: Trade["tradeType"]; initialAccountId?: string; lockedAccountId?: string };

export function StockDetailClient({ stockId }: { stockId: string }) {
  const { t, formatDate, formatNumber } = useI18n();
  const { stocks, trades, storedTrades, accounts, ledger, accountHoldingsByStockId, ready, updateStock, correctStockCurrency, replaceTradesAsync } = useStockStore();
  const observations = useLocalCollection<Observation>("observations", []);
  const reviews = useLocalCollection<Review>("reviews", []);
  const plans = useLocalCollection<BuyPlan>("plans", []);
  const rules = useLocalCollection<InvestmentRule>("rules", []);
  const [editing, setEditing] = useState(false);
  const [observing, setObserving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [tradeContext, setTradeContext] = useState<TradeContext | null>(null);
  const [tradeMessage, setTradeMessage] = useState("");
  const [tradeError, setTradeError] = useState("");
  const stock = stocks.find((item) => item.id === stockId);

  if (!ready) return <div className="grid h-80 place-items-center text-sm text-[var(--muted)]">{t("종목 정보를 불러오는 중...")}</div>;
  if (!stock) return <div className="grid h-80 place-items-center text-center"><div><h1 className="text-xl font-semibold">{t("종목을 찾을 수 없습니다")}</h1><Link href="/stocks" className="mt-3 inline-block text-sm text-[var(--accent)] underline">{t("종목 목록으로 돌아가기")}</Link></div></div>;

  const computed = withComputed(stock);
  const price = (value: number) => formatNumber(value, {
    style: "currency",
    currency: stock.currency,
    minimumFractionDigits: stock.currency === "KRW" || stock.currency === "JPY" ? 0 : 2,
    maximumFractionDigits: stock.currency === "KRW" || stock.currency === "JPY" ? 0 : 2,
  });
  const date = (value: string | null | undefined) => value
    ? formatDate(value.length === 10 ? `${value}T00:00:00` : value, { year: "numeric", month: "short", day: "numeric" })
    : t("미설정");
  const metrics = [
    [t("현재가"), price(stock.currentPrice)],
    [t("평균단가"), stock.quantity ? price(stock.averagePrice) : "—"],
    [t("보유 수량"), formatNumber(stock.quantity, { maximumFractionDigits: 8 })],
    [t("평가금액"), price(computed.marketValue)],
    [t("미실현손익"), `${computed.unrealizedProfit >= 0 ? "+" : ""}${price(computed.unrealizedProfit)}`],
    [t("검토할 사항"), stock.reviewNote || t("미설정")],
  ];
  const stockObservations = observations.items.filter((observation) => observation.stockId === stock.id).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const stockReviews = reviews.items.filter((review) => review.stockId === stock.id).sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt));
  const activeTrades = trades.filter((trade) => !trade.deletedAt);
  const stockTrades = activeTrades.filter((trade) => trade.stockId === stock.id).sort((a, b) => b.tradedAt.localeCompare(a.tradedAt));
  const holdings = accountHoldingsByStockId.get(stock.id) ?? [];
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const activeAccounts = accounts.filter((account) => !account.archivedAt);
  const holdingAccountIds = [...new Set(holdings.map((holding) => holding.accountId))];
  const contextualAccountId = activeAccounts.find((account) => account.isDefault)?.id
    ?? (holdingAccountIds.length === 1 ? holdingAccountIds[0] : undefined)
    ?? activeAccounts[0]?.id;
  const editedTradeId = tradeContext?.trade?.id;
  const formLedger = editedTradeId ? buildTradingLedger(activeTrades.filter((trade) => trade.id !== editedTradeId), accounts) : ledger;

  function openTradeForm(initialType: Trade["tradeType"], lockedAccountId?: string, trade?: Trade) {
    setTradeMessage("");
    setTradeError("");
    if (!trade && activeAccounts.length === 0) {
      setTradeError("먼저 계좌를 추가해 주세요.");
      return;
    }
    setTradeContext({ trade, initialType, initialAccountId: trade?.accountId ?? lockedAccountId ?? contextualAccountId, lockedAccountId });
  }

  async function saveTrade(nextTrade: Trade) {
    const next = tradeContext?.trade
      ? trades.map((item) => item.id === nextTrade.id ? nextTrade : item)
      : [nextTrade, ...trades];
    const result = await commitTradeMutation({ currentTrades: trades, nextTrades: next, accounts, changedId: nextTrade.id, replaceTrades: replaceTradesAsync });
    if (!result.ok) { setTradeError(result.error); return; }
    setTradeContext(null);
    setTradeError("");
    setTradeMessage(tradeContext?.trade ? "매매 기록을 변경했습니다." : "매매 기록을 추가했습니다.");
  }

  async function deleteTrade(trade: Trade) {
    if (!window.confirm(t("{date} {subject} 기록을 삭제할까요? 이후 포지션과 손익이 다시 계산됩니다.", { date: date(trade.tradedAt), subject: `${trade.stockName} ${t(trade.tradeType)}` }))) return;
    const result = await commitTradeMutation({ currentTrades: trades, nextTrades: buildSoftDeletedTrades(trades, trade), accounts, changedId: trade.id, replaceTrades: replaceTradesAsync });
    if (!result.ok) { setTradeMessage(""); setTradeError(result.error); return; }
    setTradeError("");
    setTradeMessage("매매 기록을 삭제했습니다.");
  }

  return <>
    <Link href="/stocks" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)]"><ArrowLeft size={16} />{t("종목 목록")}</Link>
    <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-center gap-4"><div className="grid size-12 place-items-center rounded-xl bg-[var(--accent-soft)] font-bold text-[var(--accent)]">{stock.ticker.slice(0, 2)}</div><div><div className="flex items-center gap-2"><h1 className="text-2xl font-semibold">{stock.name}</h1><span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs text-[var(--accent)]">{t(stock.status)}</span></div><p className="mt-1 text-sm text-[var(--muted)]">{stock.ticker} · {t(stock.market)} · {stock.sector || t("섹터 미지정")}</p></div></div>
      <button onClick={() => setEditing(true)} className="flex items-center gap-2 rounded-lg border bg-[var(--surface)] px-4 py-2 text-sm"><Edit3 size={16} />{t("기본 정보 수정")}</button>
    </div>
    <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{metrics.map(([label, value]) => <article key={label} className="rounded-xl border bg-[var(--surface)] p-4"><p className="text-xs text-[var(--muted)]">{label}</p><p className="mt-2 text-lg font-semibold tabular-nums">{value}</p></article>)}</section>
    <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5">
      <div className="flex items-center gap-2"><Lightbulb size={19} className="text-[var(--accent)]" /><h2 className="font-semibold">{t("투자 아이디어")}</h2></div>
      <p className="mt-4 whitespace-pre-wrap text-sm leading-7">{stock.thesisSummary || t("아직 작성된 투자 아이디어가 없습니다.")}</p>
      <div className="mt-6 grid gap-5 border-t pt-5 sm:grid-cols-2 lg:grid-cols-3"><Info icon={<TrendingUp size={17} />} label={t("현재 판단")} value={t(stock.currentView)} /><Info icon={<Target size={17} />} label={t("목표 가격")} value={stock.targetPrice ? price(stock.targetPrice) : t("미설정")} /><Info icon={<CalendarDays size={17} />} label={t("다음 검토일")} value={date(stock.nextReviewDate)} /><Info icon={<CalendarClock size={17} />} label={t("다음 실적 발표일")} value={date(stock.nextEarningsDate)} /><Info icon={<MessageSquareText size={17} />} label={t("판단 메모")} value={stock.currentViewMemo || t("메모 없음")} /></div>
    </section>
    <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5">
      <div className="flex items-center gap-2"><WalletCards size={18} className="text-[var(--accent)]" /><h2 className="font-semibold">{t("보유 계좌")}</h2></div>
      {holdings.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{holdings.map((holding) => <article key={`${holding.accountId}:${holding.currency}`} className="rounded-lg bg-[var(--surface-muted)] p-4"><p className="font-medium">{holding.accountName}</p><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-[var(--muted)]">{t("보유 수량")}</dt><dd className="mt-1 tabular-nums">{formatNumber(holding.quantity, { maximumFractionDigits: 8 })}</dd></div><div><dt className="text-xs text-[var(--muted)]">{t("평균단가")}</dt><dd className="mt-1 tabular-nums">{formatHoldingAveragePrice(holding, formatNumber)}</dd></div></dl><div className="mt-4 flex gap-2 border-t pt-3"><button type="button" onClick={() => openTradeForm("매수", holding.accountId)} className="min-h-10 flex-1 rounded-lg border bg-[var(--surface)] px-3 text-xs font-medium">{t("추가 매수")}</button><button type="button" onClick={() => openTradeForm("매도", holding.accountId)} className="min-h-10 flex-1 rounded-lg border bg-[var(--surface)] px-3 text-xs font-medium">{t("매도")}</button></div></article>)}</div> : <p className="mt-4 text-sm text-[var(--muted)]">{t("현재 보유 계좌가 없습니다.")}</p>}
    </section>
    <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{t("이 종목의 관찰 기록")}</h2><div className="flex items-center gap-2"><button onClick={() => setObserving(true)} className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-xs text-white"><Plus size={14} />{t("새 관찰 기록")}</button><Link href="/observations" className="rounded-md px-2 py-2 text-xs text-[var(--accent)]">{t("전체 관찰 보기")}</Link></div></div>
      <div className="mt-3 space-y-2">{stockObservations.slice(0, 5).map((observation) => <article key={observation.id} className="rounded-lg bg-[var(--surface-muted)] p-3"><div className="flex justify-between gap-3 text-sm"><b>{observation.title}</b><span className="shrink-0 text-xs text-[var(--muted)]">{date(observation.observedAt)}</span></div><p className="mt-2 line-clamp-2 text-sm text-[var(--muted)]">{observation.content}</p><span className="mt-2 inline-block rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs">{t(observation.stockView)}</span></article>)}{!stockObservations.length && <p className="py-5 text-center text-sm text-[var(--muted)]">{t("아직 이 종목의 관찰 기록이 없습니다.")}</p>}</div>
    </section>
    <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{t("이 종목의 회고")}</h2><div className="flex items-center gap-2"><button onClick={() => setReviewing(true)} className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-xs text-white"><Plus size={14} />{t("이 종목 회고")}</button><Link href="/reviews" className="rounded-md px-2 py-2 text-xs text-[var(--accent)]">{t("전체 회고 보기")}</Link></div></div>
      <div className="mt-3 space-y-2">{stockReviews.slice(0, 5).map((review) => <article key={review.id} className="rounded-lg bg-[var(--surface-muted)] p-3"><div className="flex justify-between gap-3 text-sm"><b>{t(review.evaluation)}</b><span className="shrink-0 text-xs text-[var(--muted)]">{date(review.reviewedAt)}</span></div><p className="mt-2 line-clamp-2 text-sm text-[var(--muted)]">{review.lessons || review.result || t("작성된 요약이 없습니다.")}</p></article>)}{!stockReviews.length && <p className="py-5 text-center text-sm text-[var(--muted)]">{t("아직 이 종목에 연결된 회고가 없습니다.")}</p>}</div>
    </section>
    <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><h2 className="font-semibold">{t("태그")}</h2><div className="mt-3 flex flex-wrap gap-2">{stock.tags.length ? stock.tags.map((tag) => <span key={tag} className="rounded-md bg-[var(--surface-muted)] px-2.5 py-1 text-xs">#{tag}</span>) : <span className="text-sm text-[var(--muted)]">{t("태그 없음")}</span>}</div></section>
    <section className="mt-4 overflow-hidden rounded-xl border bg-[var(--surface)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div className="flex items-center gap-2"><WalletCards size={18} className="text-[var(--accent)]" /><h2 className="font-semibold">{stock.name} · {t("매매 기록")}</h2><span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs text-[var(--muted)]">{formatNumber(stockTrades.length)}</span></div><div className="flex items-center gap-2"><button type="button" onClick={() => openTradeForm("매수")} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-xs font-medium text-white"><Plus size={15} />{t("매매 추가")}</button><Link href="/trades" className="inline-flex min-h-10 items-center rounded-lg px-3 text-xs text-[var(--accent)]">{t("전체 원장")}</Link></div></div>
      {(tradeMessage || tradeError) && <div role={tradeError ? "alert" : "status"} className={`mx-5 mt-4 rounded-lg p-3 text-sm ${tradeError ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-200" : "bg-[var(--accent-soft)] text-[var(--accent)]"}`}><span>{translateTradeText(tradeError || tradeMessage, t, formatNumber)}</span>{tradeError === "먼저 계좌를 추가해 주세요." && <Link href="/accounts" className="ml-2 font-medium underline">{t("계좌 추가")}</Link>}</div>}
      {stockTrades.length ? <>
        <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[var(--surface-muted)] text-xs text-[var(--muted)]"><tr><th className="px-5 py-3 font-medium">{t("일시")}</th><th className="px-3 py-3 font-medium">{t("유형")}</th><th className="px-3 py-3 font-medium">{t("계좌")}</th><th className="px-3 py-3 text-right font-medium">{t("수량")}</th><th className="px-3 py-3 text-right font-medium">{t("가격/금액")}</th><th className="px-3 py-3 text-right font-medium">{t("실현손익")}</th><th className="w-20 px-3 py-3"><span className="sr-only">{t("작업")}</span></th></tr></thead><tbody>{stockTrades.map((trade) => <TradeHistoryRow key={trade.id} trade={trade} accountName={currentTradeAccountName(trade, accountsById)} realizedProfit={ledger.calculations[trade.id]?.realizedProfit ?? 0} formatDate={formatDate} formatNumber={formatNumber} t={t} onEdit={() => openTradeForm(trade.tradeType, undefined, trade)} onDelete={() => void deleteTrade(trade)} />)}</tbody></table></div>
        <div className="divide-y md:hidden">{stockTrades.map((trade) => <TradeHistoryCard key={trade.id} trade={trade} accountName={currentTradeAccountName(trade, accountsById)} realizedProfit={ledger.calculations[trade.id]?.realizedProfit ?? 0} formatDate={formatDate} formatNumber={formatNumber} t={t} onEdit={() => openTradeForm(trade.tradeType, undefined, trade)} onDelete={() => void deleteTrade(trade)} />)}</div>
      </> : <p className="px-5 py-10 text-center text-sm text-[var(--muted)]">{t("기록 없음")}</p>}
    </section>
    {editing && <StockForm stock={stock} holdings={holdings} trades={storedTrades.filter((trade) => trade.stockId === stock.id)} onCancel={() => setEditing(false)} onSave={async (next) => { if (stock.currency !== next.currency) await correctStockCurrency(next); else updateStock(next); setEditing(false); }} />}
    {tradeContext && <TradeForm trade={tradeContext.trade} initialType={tradeContext.initialType} lockedStockId={stock.id} initialAccountId={tradeContext.initialAccountId} lockedAccountId={tradeContext.lockedAccountId} allowedTypes={["매수", "매도", "배당"]} stocks={stocks} plans={plans.items} rules={rules.items} ledger={formLedger} accounts={accounts} formError={tradeError} onCancel={() => { setTradeContext(null); setTradeError(""); }} onSave={saveTrade} />}
    {observing && <ObservationForm stocks={stocks} initialStockId={stock.id} onCancel={() => setObserving(false)} onSave={(observation) => { observations.add(observation); setObserving(false); }} />}
    {reviewing && <ReviewForm stocks={stocks} initialStockId={stock.id} cancel={() => setReviewing(false)} save={(review) => { reviews.add(review); setReviewing(false); }} />}
  </>;
}

type TradeHistoryProps = {
  trade: Trade;
  accountName: string;
  realizedProfit: number;
  formatDate: ReturnType<typeof useI18n>["formatDate"];
  formatNumber: ReturnType<typeof useI18n>["formatNumber"];
  t: ReturnType<typeof useI18n>["t"];
  onEdit: () => void;
  onDelete: () => void;
};

function TradeHistoryRow({ trade, accountName, realizedProfit, formatDate, formatNumber, t, onEdit, onDelete }: TradeHistoryProps) {
  const money = (value: number) => formatNumber(value, { style: "currency", currency: trade.currency, maximumFractionDigits: trade.currency === "KRW" || trade.currency === "JPY" ? 0 : 2 });
  return <tr className="border-t first:border-t-0"><td className="whitespace-nowrap px-5 py-3 text-xs text-[var(--muted)]">{formatDate(trade.tradedAt, { year: "numeric", month: "short", day: "numeric" })}</td><td className="px-3 py-3"><TradeTypeBadge type={trade.tradeType} t={t} /></td><td className="px-3 py-3 text-[var(--muted)]">{accountName}</td><td className="px-3 py-3 text-right tabular-nums">{trade.tradeType === "매수" || trade.tradeType === "매도" ? formatNumber(trade.quantity, { maximumFractionDigits: 8 }) : "—"}</td><td className="px-3 py-3 text-right tabular-nums">{money(tradeAmount(trade))}</td><td className={`px-3 py-3 text-right tabular-nums ${realizedProfit > 0 ? "text-[var(--color-success)]" : realizedProfit < 0 ? "text-[var(--color-danger)]" : "text-[var(--muted)]"}`}>{trade.tradeType === "매도" ? money(realizedProfit) : "—"}</td><td className="px-3 py-2"><div className="flex justify-end"><button type="button" aria-label={t("{type} 기록 수정", { type: t(trade.tradeType) })} onClick={onEdit} className="grid size-10 place-items-center rounded-lg hover:bg-[var(--surface-muted)]"><Pencil size={15} /></button>{!trade.isOpeningPosition && <button type="button" aria-label={t("{type} 기록 삭제", { type: t(trade.tradeType) })} onClick={onDelete} className="grid size-10 place-items-center rounded-lg text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 size={15} /></button>}</div></td></tr>;
}

function TradeHistoryCard({ trade, accountName, realizedProfit, formatDate, formatNumber, t, onEdit, onDelete }: TradeHistoryProps) {
  const money = (value: number) => formatNumber(value, { style: "currency", currency: trade.currency, maximumFractionDigits: trade.currency === "KRW" || trade.currency === "JPY" ? 0 : 2 });
  return <article className="p-4"><div className="flex items-center justify-between gap-3"><TradeTypeBadge type={trade.tradeType} t={t} /><time className="text-xs text-[var(--muted)]">{formatDate(trade.tradedAt, { year: "numeric", month: "short", day: "numeric" })}</time></div><div className="mt-3 flex items-end justify-between gap-4"><div><p className="text-xs text-[var(--muted)]">{accountName}</p><p className="mt-1 text-xs text-[var(--muted)]">{trade.tradeType === "매수" || trade.tradeType === "매도" ? `${formatNumber(trade.quantity, { maximumFractionDigits: 8 })} · ${money(trade.price)}` : t("가격/금액")}</p></div><div className="text-right"><p className="font-semibold tabular-nums">{money(tradeAmount(trade))}</p>{trade.tradeType === "매도" && <p className={`mt-1 text-xs tabular-nums ${realizedProfit >= 0 ? "text-[var(--color-success)]" : "text-[var(--color-danger)]"}`}>{t("실현손익")} {money(realizedProfit)}</p>}</div></div>{trade.memo && <p className="mt-3 line-clamp-2 text-xs text-[var(--muted)]">{trade.memo}</p>}<div className="mt-3 flex justify-end gap-1 border-t pt-2"><button type="button" onClick={onEdit} className="min-h-11 rounded-lg px-3 text-xs font-medium">{t("수정")}</button>{!trade.isOpeningPosition && <button type="button" onClick={onDelete} className="min-h-11 rounded-lg px-3 text-xs font-medium text-red-600">{t("삭제")}</button>}</div></article>;
}

export function currentTradeAccountName(trade: Trade, accountsById: Map<string, InvestmentAccount>) {
  return (trade.accountId ? accountsById.get(trade.accountId)?.name : undefined) ?? trade.accountName;
}

export function formatHoldingAveragePrice(holding: Pick<StockAccountHolding, "averagePrice" | "currency">, formatNumber: ReturnType<typeof useI18n>["formatNumber"]) {
  const fractionDigits = holding.currency === "KRW" || holding.currency === "JPY" ? 0 : 2;
  return formatNumber(holding.averagePrice, { style: "currency", currency: holding.currency, minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

function TradeTypeBadge({ type, t }: { type: Trade["tradeType"]; t: ReturnType<typeof useI18n>["t"] }) {
  const tone = type === "매수" || type === "입금" ? "bg-[var(--accent-soft)] text-[var(--accent)]" : type === "매도" || type === "출금" ? "bg-[var(--surface-muted)] text-[var(--color-lilac)]" : "bg-[var(--surface-muted)] text-[var(--muted)]";
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>{t(type)}</span>;
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex gap-3"><span className="mt-0.5 text-[var(--muted)]">{icon}</span><div><p className="text-xs text-[var(--muted)]">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div></div>;
}
