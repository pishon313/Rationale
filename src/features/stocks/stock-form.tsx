"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { WalletCards, X } from "lucide-react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { useI18n } from "@/i18n/i18n-provider";
import { currencies, investmentTypes, markets, stockStatuses, stockViews, type Stock } from "./types";
import { stockFormSchema, type StockFormValues } from "./schema";
import type { StockAccountHolding } from "./stock-account-holdings";

type Props = { stock?: Stock; holdings?: StockAccountHolding[]; onCancel: () => void; onSave: (stock: Stock) => void };

const fieldClass = "mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm";

export function StockForm({ stock, holdings = [], onCancel, onSave }: Props) {
  const { t, formatNumber } = useI18n();
  const ledgerManaged = Boolean(stock?.ledgerInitializedAt);
  const legacyPosition = Boolean(stock && !stock.ledgerInitializedAt);
  const errorText = (message: string | undefined, fallback: string) => {
    if (!message) return undefined;
    return /[가-힣]/.test(message) ? t(message) : t(fallback);
  };
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
      averagePrice: stock?.averagePrice ?? 0, quantity: stock?.quantity ?? 0,
      ...(stock?.openingAccountName !== undefined ? { openingAccountName: stock.openingAccountName } : {}), thesisSummary: parsed.thesisSummary,
      currentView: parsed.currentView, currentViewMemo: parsed.currentViewMemo,
      nextReviewDate: parsed.nextReviewDate || null, reviewNote: parsed.reviewNote,
      nextEarningsDate: parsed.nextEarningsDate || null,
      tags: parsed.tagsText.split(",").map((tag) => tag.trim()).filter(Boolean),
      priceUpdatedAt: stock?.priceUpdatedAt ?? null, priceQuotedAt: stock?.priceQuotedAt ?? null,
      priceSource: stock?.priceSource ?? "manual", priceStatus: "manual",
      ledgerInitializedAt: stock ? stock.ledgerInitializedAt ?? null : now,
      createdAt: stock?.createdAt ?? now, updatedAt: now, deletedAt: null });
  })}><div className="sticky top-0 z-10 flex items-center justify-between border-b bg-[var(--surface)] px-5 py-4"><div><h2 id="stock-form-title" className="text-lg font-semibold">{t(stock ? "종목 수정" : "새 종목 추가")}</h2><p className="mt-1 text-xs text-[var(--muted)]">{t("판단에 필요한 기본 정보를 기록하세요.")}</p></div><button type="button" aria-label={t("닫기")} onClick={onCancel} className="grid size-9 place-items-center rounded-lg hover:bg-[var(--surface-muted)]"><X size={19} /></button></div><div className="grid gap-5 p-5 sm:grid-cols-2">
    <Field label={t("티커")} error={errorText(errors.ticker?.message, "티커는 20자 이내로 입력해 주세요.")}><input autoFocus className={fieldClass} placeholder={t("예: 005930, TSLA")} {...register("ticker")} /></Field>
    <Field label={t("종목명")} error={errorText(errors.name?.message, "종목명은 100자 이내로 입력해 주세요.")}><input className={fieldClass} placeholder={t("예: 삼성전자")} {...register("name")} /></Field>
    <Field label={t("시장")}><select className={fieldClass} value={market} onChange={(e) => syncCurrency(e.target.value)}>{markets.map((v) => <option key={v} value={v}>{t(v)}</option>)}</select></Field>
    <Field label={t("통화")}><select disabled={ledgerManaged} className={`${fieldClass} disabled:cursor-not-allowed disabled:opacity-60`} {...register("currency")}>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select></Field>
    <Field label={t("자산 유형")} error={errorText(errors.assetType?.message, "자산 유형을 입력해 주세요.")}><input className={fieldClass} {...register("assetType")} /></Field>
    <Field label={t("섹터")} error={errorText(errors.sector?.message, "섹터는 60자 이내로 입력해 주세요.")}><input className={fieldClass} placeholder={t("예: 반도체")} {...register("sector")} /></Field>
    <Field label={t("상태")}><select className={fieldClass} {...register("status")}>{stockStatuses.map((v) => <option key={v} value={v}>{t(v)}</option>)}</select></Field>
    <Field label={t("투자 유형")}><select className={fieldClass} {...register("investmentType")}>{investmentTypes.map((v) => <option key={v} value={v}>{t(v)}</option>)}</select></Field>
    <Field label={t("현재 가격")} error={errorText(errors.currentPrice?.message, "0 이상의 값을 입력해 주세요.")}><input type="number" step="any" className={fieldClass} {...register("currentPrice")} /></Field>
    <Field label={t("목표 가격")} error={errorText(errors.targetPrice?.message, "0 이상의 값을 입력해 주세요.")}><input type="number" step="any" className={fieldClass} {...register("targetPrice")} /></Field>
    {!stock && <div className="sm:col-span-2 rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">{t("보유 계좌·수량·평균단가는 종목 추가 후 매매 원장에서 등록합니다.")}</div>}
    {ledgerManaged && <div className="sm:col-span-2 rounded-lg bg-[var(--surface-muted)] p-4 text-sm"><p className="font-medium">{t("보유 계좌")}</p>{holdings.length ? <ul className="mt-3 space-y-2">{holdings.map((holding) => <li key={holding.accountId} className="flex items-center justify-between gap-4"><span>{holding.accountName}</span><span className="tabular-nums text-[var(--muted)]">{formatNumber(holding.quantity, { maximumFractionDigits: 8 })}</span></li>)}</ul> : <p className="mt-2 text-xs text-[var(--muted)]">{t("현재 보유 포지션이 없습니다.")}</p>}<p className="mt-3 text-xs leading-5 text-[var(--muted)]">{t("계좌와 보유 수량은 매매 원장에서 관리됩니다.")}</p><div className="mt-3 flex flex-wrap gap-2"><Link href="/trades" className="inline-flex items-center gap-2 rounded-lg border bg-[var(--surface)] px-3 py-2 text-sm font-medium"><WalletCards size={16} />{t("매매 원장 열기")}</Link>{holdings.length === 0 && stock && <Link href={`/trades?openingStockId=${encodeURIComponent(stock.id)}`} className="inline-flex items-center gap-2 rounded-lg border bg-[var(--surface)] px-3 py-2 text-sm font-medium"><WalletCards size={16} />{t("기초 포지션 등록")}</Link>}</div></div>}
    {legacyPosition && stock && <div className="sm:col-span-2 rounded-lg bg-[var(--surface-muted)] p-4 text-sm"><p className="font-medium">{t("기존 보유 정보")}</p><dl className="mt-3 grid gap-2 sm:grid-cols-3"><LegacyValue label={t("기초 계좌")} value={stock.openingAccountName || "—"} /><LegacyValue label={t("기초 수량")} value={formatNumber(stock.quantity, { maximumFractionDigits: 8 })} /><LegacyValue label={t("기초 평균단가")} value={formatNumber(stock.averagePrice, { maximumFractionDigits: 8 })} /></dl><p className="mt-3 text-xs leading-5 text-[var(--muted)]">{t("매매 원장 전환 전의 기존 보유 기록입니다.")}</p><Link href="/trades" className="mt-3 inline-flex items-center gap-2 rounded-lg border bg-[var(--surface)] px-3 py-2 text-sm font-medium"><WalletCards size={16} />{t("매매 원장 열기")}</Link></div>}
    <Field label={t("현재 판단")}><select className={fieldClass} {...register("currentView")}>{stockViews.map((v) => <option key={v} value={v}>{t(v)}</option>)}</select></Field>
    <Field label={t("다음 검토일")}><input type="date" className={fieldClass} {...register("nextReviewDate")} /></Field>
    <Field label={t("검토할 사항")} error={errorText(errors.reviewNote?.message, "검토할 사항은 300자 이내로 입력해 주세요.")}><input className={fieldClass} placeholder={t("예: 분기 실적과 마진 추이 확인")} {...register("reviewNote")} /></Field>
    <Field label={t("다음 실적 발표일")}><input type="date" className={fieldClass} {...register("nextEarningsDate")} /></Field>
    <div className="sm:col-span-2"><Field label={t("투자 아이디어 요약")} error={errorText(errors.thesisSummary?.message, "투자 아이디어 요약은 500자 이내로 입력해 주세요.")}><textarea className="mt-1 min-h-24 w-full rounded-lg border bg-[var(--surface)] p-3 text-sm" placeholder={t("왜 이 종목을 보고 있는지 짧게 기록하세요.")} {...register("thesisSummary")} /></Field></div>
    <div className="sm:col-span-2"><Field label={t("현재 판단 메모")} error={errorText(errors.currentViewMemo?.message, "현재 판단 메모는 1000자 이내로 입력해 주세요.")}><textarea className="mt-1 min-h-20 w-full rounded-lg border bg-[var(--surface)] p-3 text-sm" {...register("currentViewMemo")} /></Field></div>
    <div className="sm:col-span-2"><Field label={t("태그")}><input className={fieldClass} placeholder={t("쉼표로 구분: 반도체, 코어")} {...register("tagsText")} /></Field></div>
  </div><div className="sticky bottom-0 flex justify-end gap-2 border-t bg-[var(--surface)] p-4"><button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button disabled={isSubmitting} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white">{t(stock ? "변경 저장" : "종목 추가")}</button></div></form></div>;
}

function LegacyValue({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="mt-1 tabular-nums">{value}</dd></div>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium">{label}{children}{error && <span className="mt-1 block text-xs text-red-600">{error}</span>}</label>;
}
