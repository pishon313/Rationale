"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { useForm } from "react-hook-form";
import { investmentTypes, markets, stockStatuses, stockViews, type Stock } from "./types";
import { stockFormSchema, type StockFormValues } from "./schema";

type Props = { stock?: Stock; onCancel: () => void; onSave: (stock: Stock) => void };

const fieldClass = "mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm";

export function StockForm({ stock, onCancel, onSave }: Props) {
  const ledgerManaged = Boolean(stock?.ledgerInitializedAt);
  const { register, handleSubmit, formState: { errors, isSubmitting }, watch, setValue } = useForm<StockFormValues>({
    resolver: zodResolver(stockFormSchema),
    defaultValues: stock ? {
      ticker: stock.ticker, name: stock.name, market: stock.market, currency: stock.currency,
      assetType: stock.assetType, sector: stock.sector, status: stock.status, investmentType: stock.investmentType,
      currentPrice: stock.currentPrice, targetPrice: stock.targetPrice, averagePrice: stock.averagePrice,
      quantity: stock.quantity, thesisSummary: stock.thesisSummary, currentView: stock.currentView,
      currentViewMemo: stock.currentViewMemo, nextReviewDate: stock.nextReviewDate, reviewNote: stock.reviewNote ?? "",
      nextEarningsDate: stock.nextEarningsDate ?? null, tagsText: stock.tags.join(", "),
    } : {
      ticker: "", name: "", market: "한국", currency: "KRW", assetType: "주식", sector: "",
      status: "관찰", investmentType: "관찰 전용", currentPrice: 0, targetPrice: null,
      averagePrice: 0, quantity: 0, thesisSummary: "", currentView: "판단 보류", currentViewMemo: "",
      nextReviewDate: null, reviewNote: "", nextEarningsDate: null, tagsText: "",
    },
  });

  const market = watch("market");
  function syncCurrency(value: string) {
    setValue("market", value as "한국" | "미국" | "기타");
    if (ledgerManaged) return;
    if (value === "한국") setValue("currency", "KRW");
    if (value === "미국") setValue("currency", "USD");
  }

  return <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="dialog" aria-modal="true" aria-labelledby="stock-form-title"><form className="h-full w-full overflow-y-auto bg-[var(--surface)] shadow-2xl sm:max-w-2xl" onSubmit={handleSubmit((values) => {
    const parsed = stockFormSchema.parse(values); const now = new Date().toISOString();
    onSave({ id: stock?.id ?? crypto.randomUUID(), ticker: parsed.ticker, name: parsed.name, market: parsed.market,
      currency: ledgerManaged ? stock!.currency : parsed.currency, assetType: parsed.assetType, sector: parsed.sector, status: parsed.status,
      investmentType: parsed.investmentType, currentPrice: parsed.currentPrice, targetPrice: parsed.targetPrice,
      averagePrice: ledgerManaged ? stock!.averagePrice : parsed.averagePrice, quantity: ledgerManaged ? stock!.quantity : parsed.quantity, thesisSummary: parsed.thesisSummary,
      currentView: parsed.currentView, currentViewMemo: parsed.currentViewMemo,
      nextReviewDate: parsed.nextReviewDate || null, reviewNote: parsed.reviewNote,
      nextEarningsDate: parsed.nextEarningsDate || null,
      tags: parsed.tagsText.split(",").map((tag) => tag.trim()).filter(Boolean),
      priceUpdatedAt: stock?.priceUpdatedAt ?? null, priceQuotedAt: stock?.priceQuotedAt ?? null,
      priceSource: stock?.priceSource ?? "manual", priceStatus: "manual",
      ledgerInitializedAt: stock ? stock.ledgerInitializedAt ?? null : parsed.quantity === 0 ? now : null,
      createdAt: stock?.createdAt ?? now, updatedAt: now, deletedAt: null });
  })}><div className="sticky top-0 z-10 flex items-center justify-between border-b bg-[var(--surface)] px-5 py-4"><div><h2 id="stock-form-title" className="text-lg font-semibold">{stock ? "종목 수정" : "새 종목 추가"}</h2><p className="mt-1 text-xs text-[var(--muted)]">판단에 필요한 기본 정보를 기록하세요.</p></div><button type="button" aria-label="닫기" onClick={onCancel} className="grid size-9 place-items-center rounded-lg hover:bg-[var(--surface-muted)]"><X size={19} /></button></div><div className="grid gap-5 p-5 sm:grid-cols-2">
    <Field label="티커" error={errors.ticker?.message}><input autoFocus className={fieldClass} placeholder="예: 005930, TSLA" {...register("ticker")} /></Field>
    <Field label="종목명" error={errors.name?.message}><input className={fieldClass} placeholder="예: 삼성전자" {...register("name")} /></Field>
    <Field label="시장"><select className={fieldClass} value={market} onChange={(e) => syncCurrency(e.target.value)}>{markets.map((v) => <option key={v}>{v}</option>)}</select></Field>
    <Field label="통화"><select disabled={ledgerManaged} className={`${fieldClass} disabled:cursor-not-allowed disabled:opacity-60`} {...register("currency")}><option>KRW</option><option>USD</option></select></Field>
    <Field label="자산 유형" error={errors.assetType?.message}><input className={fieldClass} {...register("assetType")} /></Field>
    <Field label="섹터"><input className={fieldClass} placeholder="예: 반도체" {...register("sector")} /></Field>
    <Field label="상태"><select className={fieldClass} {...register("status")}>{stockStatuses.map((v) => <option key={v}>{v}</option>)}</select></Field>
    <Field label="투자 유형"><select className={fieldClass} {...register("investmentType")}>{investmentTypes.map((v) => <option key={v}>{v}</option>)}</select></Field>
    <Field label="현재 가격" error={errors.currentPrice?.message}><input type="number" step="any" className={fieldClass} {...register("currentPrice")} /></Field>
    <Field label="목표 가격" error={errors.targetPrice?.message}><input type="number" step="any" className={fieldClass} {...register("targetPrice")} /></Field>
    <Field label="평균단가" error={errors.averagePrice?.message}><input readOnly={ledgerManaged} type="number" step="any" className={`${fieldClass} read-only:cursor-not-allowed read-only:opacity-60`} {...register("averagePrice")} /></Field>
    <Field label="보유 수량" error={errors.quantity?.message}><input readOnly={ledgerManaged} type="number" step="any" className={`${fieldClass} read-only:cursor-not-allowed read-only:opacity-60`} {...register("quantity")} /></Field>
    {ledgerManaged && <p className="sm:col-span-2 rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">통화·평균단가·보유 수량은 매매 원장에서 자동 계산됩니다. 값을 바꾸려면 해당 매매 기록을 수정해 주세요.</p>}
    <Field label="현재 판단"><select className={fieldClass} {...register("currentView")}>{stockViews.map((v) => <option key={v}>{v}</option>)}</select></Field>
    <Field label="다음 검토일"><input type="date" className={fieldClass} {...register("nextReviewDate")} /></Field>
    <Field label="검토할 사항" error={errors.reviewNote?.message}><input className={fieldClass} placeholder="예: 분기 실적과 마진 추이 확인" {...register("reviewNote")} /></Field>
    <Field label="다음 실적 발표일"><input type="date" className={fieldClass} {...register("nextEarningsDate")} /></Field>
    <div className="sm:col-span-2"><Field label="투자 아이디어 요약" error={errors.thesisSummary?.message}><textarea className="mt-1 min-h-24 w-full rounded-lg border bg-[var(--surface)] p-3 text-sm" placeholder="왜 이 종목을 보고 있는지 짧게 기록하세요." {...register("thesisSummary")} /></Field></div>
    <div className="sm:col-span-2"><Field label="현재 판단 메모" error={errors.currentViewMemo?.message}><textarea className="mt-1 min-h-20 w-full rounded-lg border bg-[var(--surface)] p-3 text-sm" {...register("currentViewMemo")} /></Field></div>
    <div className="sm:col-span-2"><Field label="태그"><input className={fieldClass} placeholder="쉼표로 구분: 반도체, 코어" {...register("tagsText")} /></Field></div>
  </div><div className="sticky bottom-0 flex justify-end gap-2 border-t bg-[var(--surface)] p-4"><button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm">취소</button><button disabled={isSubmitting} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white">{stock ? "변경 저장" : "종목 추가"}</button></div></form></div>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium">{label}{children}{error && <span className="mt-1 block text-xs text-red-600">{error}</span>}</label>;
}
