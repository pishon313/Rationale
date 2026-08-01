"use client";
import Link from "next/link";
import { ArrowLeft, CalendarClock, CalendarDays, Edit3, Lightbulb, MessageSquareText, Target, TrendingUp } from "lucide-react";
import { useState } from "react";
import { formatCurrency } from "@/domain/money";
import { StockForm } from "./stock-form";
import { useStockStore } from "./use-stock-store";
import { withComputed } from "./types";

export function StockDetailClient({ stockId }: { stockId: string }) {
  const { stocks, ready, updateStock } = useStockStore();
  const [editing, setEditing] = useState(false);
  const stock = stocks.find((item) => item.id === stockId);
  if (!ready) return <div className="grid h-80 place-items-center text-sm text-[var(--muted)]">종목 정보를 불러오는 중...</div>;
  if (!stock) return <div className="grid h-80 place-items-center text-center"><div><h1 className="text-xl font-semibold">종목을 찾을 수 없습니다</h1><Link href="/stocks" className="mt-3 inline-block text-sm text-[var(--accent)] underline">종목 목록으로 돌아가기</Link></div></div>;
  const computed = withComputed(stock);
  const price = (value: number) => formatCurrency(value, stock.currency);
  const metrics = [["현재가", price(stock.currentPrice)], ["평균단가", stock.quantity ? price(stock.averagePrice) : "—"], ["보유 수량", stock.quantity.toLocaleString()], ["평가금액", price(computed.marketValue)], ["미실현손익", `${computed.unrealizedProfit >= 0 ? "+" : ""}${price(computed.unrealizedProfit)}`]];

  return <><Link href="/stocks" className="inline-flex items-center gap-1.5 text-sm text-[var(--muted)]"><ArrowLeft size={16} />종목 목록</Link><div className="mt-5 flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-4"><div className="grid size-12 place-items-center rounded-xl bg-[var(--accent-soft)] font-bold text-[var(--accent)]">{stock.ticker.slice(0, 2)}</div><div><div className="flex items-center gap-2"><h1 className="text-2xl font-semibold">{stock.name}</h1><span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs text-[var(--accent)]">{stock.status}</span></div><p className="mt-1 text-sm text-[var(--muted)]">{stock.ticker} · {stock.market} · {stock.sector || "섹터 미지정"}</p></div></div><button onClick={() => setEditing(true)} className="flex items-center gap-2 rounded-lg border bg-[var(--surface)] px-4 py-2 text-sm"><Edit3 size={16} />기본 정보 수정</button></div><section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{metrics.map(([label, value]) => <article key={label} className="rounded-xl border bg-[var(--surface)] p-4"><p className="text-xs text-[var(--muted)]">{label}</p><p className="mt-2 text-lg font-semibold tabular-nums">{value}</p></article>)}</section><section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center gap-2"><Lightbulb size={19} className="text-[var(--accent)]" /><h2 className="font-semibold">투자 아이디어</h2></div><p className="mt-4 whitespace-pre-wrap text-sm leading-7">{stock.thesisSummary || "아직 작성된 투자 아이디어가 없습니다."}</p><div className="mt-6 grid gap-5 border-t pt-5 sm:grid-cols-2 lg:grid-cols-3"><Info icon={<TrendingUp size={17} />} label="현재 판단" value={stock.currentView} /><Info icon={<Target size={17} />} label="목표 가격" value={stock.targetPrice ? price(stock.targetPrice) : "미설정"} /><Info icon={<CalendarDays size={17} />} label="다음 검토일" value={stock.nextReviewDate ?? "미설정"} /><Info icon={<CalendarClock size={17} />} label="다음 실적 발표일" value={stock.nextEarningsDate ?? "미설정"} /><Info icon={<MessageSquareText size={17} />} label="판단 메모" value={stock.currentViewMemo || "메모 없음"} /></div></section><section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><h2 className="font-semibold">태그</h2><div className="mt-3 flex flex-wrap gap-2">{stock.tags.length ? stock.tags.map((tag) => <span key={tag} className="rounded-md bg-[var(--surface-muted)] px-2.5 py-1 text-xs">#{tag}</span>) : <span className="text-sm text-[var(--muted)]">태그 없음</span>}</div></section>{editing && <StockForm stock={stock} onCancel={() => setEditing(false)} onSave={(next) => { updateStock(next); setEditing(false); }} />}</>;
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="flex gap-3"><span className="mt-0.5 text-[var(--muted)]">{icon}</span><div><p className="text-xs text-[var(--muted)]">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div></div>; }
