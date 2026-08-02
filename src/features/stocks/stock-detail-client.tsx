"use client";

import Link from "next/link";
import { ArrowLeft, CalendarClock, CalendarDays, Edit3, Lightbulb, MessageSquareText, Plus, Target, TrendingUp } from "lucide-react";
import { useState } from "react";
import { ObservationForm } from "@/features/observations/observations-page-client";
import type { Observation } from "@/features/observations/types";
import { ReviewForm } from "@/features/reviews/reviews-page-client";
import type { Review } from "@/features/reviews/types";
import { useI18n } from "@/i18n/i18n-provider";
import { useLocalCollection } from "@/lib/use-local-collection";
import { StockForm } from "./stock-form";
import { useStockStore } from "./use-stock-store";
import { withComputed } from "./types";

export function StockDetailClient({ stockId }: { stockId: string }) {
  const { t, formatDate, formatNumber } = useI18n();
  const { stocks, ready, updateStock } = useStockStore();
  const observations = useLocalCollection<Observation>("observations", []);
  const reviews = useLocalCollection<Review>("reviews", []);
  const [editing, setEditing] = useState(false);
  const [observing, setObserving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
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
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{t("이 종목의 관찰 기록")}</h2><div className="flex items-center gap-2"><button onClick={() => setObserving(true)} className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-xs text-white"><Plus size={14} />{t("새 관찰 기록")}</button><Link href="/observations" className="rounded-md px-2 py-2 text-xs text-[var(--accent)]">{t("전체 관찰 보기")}</Link></div></div>
      <div className="mt-3 space-y-2">{stockObservations.slice(0, 5).map((observation) => <article key={observation.id} className="rounded-lg bg-[var(--surface-muted)] p-3"><div className="flex justify-between gap-3 text-sm"><b>{observation.title}</b><span className="shrink-0 text-xs text-[var(--muted)]">{date(observation.observedAt)}</span></div><p className="mt-2 line-clamp-2 text-sm text-[var(--muted)]">{observation.content}</p><span className="mt-2 inline-block rounded-full bg-[var(--surface)] px-2 py-0.5 text-xs">{t(observation.stockView)}</span></article>)}{!stockObservations.length && <p className="py-5 text-center text-sm text-[var(--muted)]">{t("아직 이 종목의 관찰 기록이 없습니다.")}</p>}</div>
    </section>
    <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">{t("이 종목의 회고")}</h2><div className="flex items-center gap-2"><button onClick={() => setReviewing(true)} className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-xs text-white"><Plus size={14} />{t("이 종목 회고")}</button><Link href="/reviews" className="rounded-md px-2 py-2 text-xs text-[var(--accent)]">{t("전체 회고 보기")}</Link></div></div>
      <div className="mt-3 space-y-2">{stockReviews.slice(0, 5).map((review) => <article key={review.id} className="rounded-lg bg-[var(--surface-muted)] p-3"><div className="flex justify-between gap-3 text-sm"><b>{t(review.evaluation)}</b><span className="shrink-0 text-xs text-[var(--muted)]">{date(review.reviewedAt)}</span></div><p className="mt-2 line-clamp-2 text-sm text-[var(--muted)]">{review.lessons || review.result || t("작성된 요약이 없습니다.")}</p></article>)}{!stockReviews.length && <p className="py-5 text-center text-sm text-[var(--muted)]">{t("아직 이 종목에 연결된 회고가 없습니다.")}</p>}</div>
    </section>
    <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><h2 className="font-semibold">{t("태그")}</h2><div className="mt-3 flex flex-wrap gap-2">{stock.tags.length ? stock.tags.map((tag) => <span key={tag} className="rounded-md bg-[var(--surface-muted)] px-2.5 py-1 text-xs">#{tag}</span>) : <span className="text-sm text-[var(--muted)]">{t("태그 없음")}</span>}</div></section>
    {editing && <StockForm stock={stock} onCancel={() => setEditing(false)} onSave={(next) => { updateStock(next); setEditing(false); }} />}
    {observing && <ObservationForm stocks={stocks} initialStockId={stock.id} onCancel={() => setObserving(false)} onSave={(observation) => { observations.add(observation); setObserving(false); }} />}
    {reviewing && <ReviewForm stocks={stocks} initialStockId={stock.id} cancel={() => setReviewing(false)} save={(review) => { reviews.add(review); setReviewing(false); }} />}
  </>;
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex gap-3"><span className="mt-0.5 text-[var(--muted)]">{icon}</span><div><p className="text-xs text-[var(--muted)]">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div></div>;
}
