"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { WalletCards, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "@/i18n/i18n-provider";
import type { Trade } from "@/features/trades/types";
import { currencies, investmentTypes, markets, stockStatuses, stockViews, type Stock } from "./types";
import { stockFormSchema, type StockFormValues } from "./schema";
import type { StockAccountHolding } from "./stock-account-holdings";
import { analyzeStockCurrencyCorrection, StockCurrencyCorrectionError } from "./stock-currency-correction";
import { marketFromCountry, type InstrumentSearchResult } from "./market-data";
import { isTauriApp } from "@/lib/local-repository";

type Props = { stock?: Stock; holdings?: StockAccountHolding[]; trades?: Trade[]; onCancel: () => void; onSave: (stock: Stock) => void | boolean | Promise<void | boolean> };

const fieldClass = "mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm";

export function StockForm({ stock, holdings = [], trades = [], onCancel, onSave }: Props) {
  const { t, formatNumber } = useI18n();
  const ledgerManaged = Boolean(stock?.ledgerInitializedAt);
  const legacyPosition = Boolean(stock && !stock.ledgerInitializedAt);
  const [pendingCorrection, setPendingCorrection] = useState<Stock | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [entryMode, setEntryMode] = useState<"search" | "manual">(stock ? "manual" : "search");
  const [searchQuery, setSearchQuery] = useState(""); const [countryFilter, setCountryFilter] = useState("");
  const [searchResults, setSearchResults] = useState<InstrumentSearchResult[]>([]); const [searchState, setSearchState] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const [selectedSearchResult, setSelectedSearchResult] = useState<InstrumentSearchResult | null>(null);
  const errorText = (message: string | undefined, fallback: string) => {
    if (!message) return undefined;
    return /[가-힣]/.test(message) ? t(message) : t(fallback);
  };
  const { register, handleSubmit, formState: { errors, isSubmitting }, watch, setValue } = useForm<StockFormValues>({
    resolver: zodResolver(stockFormSchema),
    defaultValues: stock ? {
      ticker: stock.ticker, name: stock.name, market: stock.market, currency: stock.currency,
      countryCode: stock.countryCode ?? "", exchangeCode: stock.exchangeCode ?? "", providerSymbol: stock.providerRefs?.[0]?.symbol ?? "", provider: stock.providerRefs?.[0]?.provider ?? "manual",
      assetType: stock.assetType, sector: stock.sector, status: stock.status, investmentType: stock.investmentType,
      currentPrice: stock.currentPrice, targetPrice: stock.targetPrice, averagePrice: stock.averagePrice,
      quantity: stock.quantity, thesisSummary: stock.thesisSummary, currentView: stock.currentView,
      currentViewMemo: stock.currentViewMemo, nextReviewDate: stock.nextReviewDate, reviewNote: stock.reviewNote ?? "",
      nextEarningsDate: stock.nextEarningsDate ?? null, tagsText: stock.tags.join(", "),
    } : {
      ticker: "", name: "", market: "한국", currency: "KRW", countryCode: "", exchangeCode: "", providerSymbol: "", provider: "manual", assetType: "주식", sector: "",
      status: "관찰", investmentType: "관찰 전용", currentPrice: 0, targetPrice: null,
      averagePrice: 0, quantity: 0, thesisSummary: "", currentView: "판단 보류", currentViewMemo: "",
      nextReviewDate: null, reviewNote: "", nextEarningsDate: null, tagsText: "",
    },
  });

  const market = watch("market");
  const selectedCurrency = watch("currency");
  const correctionAnalysis = stock ? analyzeStockCurrencyCorrection({ stock, trades, newCurrency: selectedCurrency }) : null;
  function syncCurrency(value: string) {
    setValue("market", value as Stock["market"]);
    if (ledgerManaged) return;
    if (value === "한국") setValue("currency", "KRW");
    if (value === "미국") setValue("currency", "USD");
  }
  async function search() { if (!searchQuery.trim()) return; if (!isTauriApp()) { setSearchState("error"); return; } setSearchState("loading"); try { const results = await invoke<InstrumentSearchResult[]>("search_instruments", { request: { provider: "eodhd", query: searchQuery, countryCode: countryFilter || null, limit: 20 } }); setSearchResults(results); setSearchState(results.length ? "idle" : "empty"); } catch { setSearchResults([]); setSearchState("error"); } }
  function selectResult(result: InstrumentSearchResult) { const currency = currencies.includes(result.currency as typeof currencies[number]) ? result.currency as typeof currencies[number] : null; if (!currency) { setSaveError("지원하지 않는 통화입니다."); return; } setSelectedSearchResult(result); setValue("ticker", result.ticker); setValue("name", result.name); setValue("market", marketFromCountry(result.countryCode)); setValue("currency", currency); setValue("countryCode", result.countryCode ?? ""); setValue("exchangeCode", result.exchangeCode); setValue("provider", "eodhd"); setValue("providerSymbol", result.providerSymbol); setValue("assetType", result.assetType || "주식"); if (result.previousClose) setValue("currentPrice", result.previousClose); setEntryMode("manual"); }

  async function persist(next: Stock) {
    setSaving(true);
    setSaveError("");
    try {
      const saved = await onSave(next);
      if (saved === false) return;
    } catch (error) {
      if (error instanceof StockCurrencyCorrectionError && error.code === "HISTORICAL_FX") setSaveError(t("{date} 거래의 과거 환율을 확인하지 못해 통화를 변경하지 않았습니다.", { date: error.tradeDate ?? "—" }));
      else if (error instanceof StockCurrencyCorrectionError && error.code === "MIXED_CURRENCY") setSaveError(t("이 종목에는 서로 다른 통화의 매매 기록이 있어 통화를 자동으로 변경할 수 없습니다. 매매 기록의 통화를 먼저 확인해 주세요."));
      else setSaveError(error instanceof Error ? error.message : t("통화를 변경하지 못했습니다."));
    } finally {
      setSaving(false);
      setPendingCorrection(null);
    }
  }

  return <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="dialog" aria-modal="true" aria-labelledby="stock-form-title"><form className="h-full w-full overflow-y-auto bg-[var(--surface)] shadow-2xl sm:max-w-2xl" onSubmit={handleSubmit(async (values) => {
    const parsed = stockFormSchema.parse(values); const now = new Date().toISOString();
    const next: Stock = { id: stock?.id ?? crypto.randomUUID(), ticker: parsed.ticker, name: parsed.name, market: parsed.market,
      currency: parsed.currency, assetType: parsed.assetType, sector: parsed.sector, status: parsed.status,
      countryCode: parsed.countryCode || null, exchangeCode: parsed.exchangeCode || null,
      exchangeMic: selectedSearchResult?.exchangeMic ?? stock?.exchangeMic ?? null, exchangeName: selectedSearchResult?.exchangeName ?? stock?.exchangeName ?? null, isin: selectedSearchResult?.isin ?? stock?.isin ?? null,
      providerRefs: parsed.provider === "manual" ? [] : [{ provider: parsed.provider, symbol: parsed.providerSymbol, exchangeCode: parsed.exchangeCode || null }], quotePreference: parsed.provider === "manual" || Boolean(stock && stock.currentPrice !== parsed.currentPrice) ? "manual" : "auto",
      investmentType: parsed.investmentType, currentPrice: parsed.currentPrice, targetPrice: parsed.targetPrice,
      averagePrice: stock?.averagePrice ?? 0, quantity: stock?.quantity ?? 0,
      ...(stock?.openingAccountName !== undefined ? { openingAccountName: stock.openingAccountName } : {}), thesisSummary: parsed.thesisSummary,
      currentView: parsed.currentView, currentViewMemo: parsed.currentViewMemo,
      nextReviewDate: parsed.nextReviewDate || null, reviewNote: parsed.reviewNote,
      nextEarningsDate: parsed.nextEarningsDate || null,
      tags: parsed.tagsText.split(",").map((tag) => tag.trim()).filter(Boolean),
      priceUpdatedAt: selectedSearchResult?.previousClose || !stock || stock.currentPrice !== parsed.currentPrice ? now : stock.priceUpdatedAt ?? null, priceQuotedAt: selectedSearchResult?.previousCloseDate ?? (!stock || stock.currentPrice !== parsed.currentPrice ? now : stock.priceQuotedAt ?? null),
      priceSource: selectedSearchResult?.previousClose ? "eodhd" : !stock || stock.currentPrice !== parsed.currentPrice ? "manual" : stock.priceSource ?? "manual", priceFreshness: selectedSearchResult?.previousClose ? "eod" : !stock || stock.currentPrice !== parsed.currentPrice ? "manual" : stock.priceFreshness ?? "manual", priceDelayMinutes: null, priceStatus: selectedSearchResult?.previousClose ? "online" : !stock || stock.currentPrice !== parsed.currentPrice ? "manual" : stock.priceStatus ?? "manual",
      ledgerInitializedAt: stock ? stock.ledgerInitializedAt ?? null : now,
      createdAt: stock?.createdAt ?? now, updatedAt: now, deletedAt: null };
    const listingChanged = Boolean(stock && (stock.ticker !== next.ticker || stock.market !== next.market || stock.currency !== next.currency));
    const providerRefChanged = stock?.providerRefs?.[0]?.provider !== next.providerRefs?.[0]?.provider || stock?.providerRefs?.[0]?.symbol !== next.providerRefs?.[0]?.symbol || stock?.providerRefs?.[0]?.exchangeCode !== next.providerRefs?.[0]?.exchangeCode;
    if (listingChanged && stock?.providerRefs?.length && !providerRefChanged) {
      if (!window.confirm("종목 식별 정보가 변경되어 기존 자동 시세 연결을 해제합니다. 계속할까요?")) return;
      next.providerRefs = []; next.quotePreference = "manual";
    }
    if (stock && stock.currency !== next.currency && correctionAnalysis?.hasMixedCurrencyConflict) {
      setSaveError(t("이 종목에는 서로 다른 통화의 매매 기록이 있어 통화를 자동으로 변경할 수 없습니다. 매매 기록의 통화를 먼저 확인해 주세요."));
      return;
    }
    if (stock && stock.currency !== next.currency && correctionAnalysis?.securityTradeCount) {
      setSaveError("");
      setPendingCorrection(next);
      return;
    }
    await persist(next);
  })}><div className="sticky top-0 z-10 flex items-center justify-between border-b bg-[var(--surface)] px-5 py-4"><div><h2 id="stock-form-title" className="text-lg font-semibold">{t(stock ? "종목 수정" : "새 종목 추가")}</h2><p className="mt-1 text-xs text-[var(--muted)]">{t("판단에 필요한 기본 정보를 기록하세요.")}</p></div><button type="button" aria-label={t("닫기")} onClick={onCancel} className="grid size-9 place-items-center rounded-lg hover:bg-[var(--surface-muted)]"><X size={19} /></button></div>{!stock && <div className="border-b p-5"><div className="flex gap-2"><button type="button" onClick={() => setEntryMode("search")} className={`rounded-lg px-3 py-2 text-sm ${entryMode === "search" ? "bg-[var(--accent)] text-white" : "border"}`}>검색해서 추가</button><button type="button" onClick={() => setEntryMode("manual")} className={`rounded-lg px-3 py-2 text-sm ${entryMode === "manual" ? "bg-[var(--accent)] text-white" : "border"}`}>직접 입력</button></div>{entryMode === "search" && <div className="mt-4"><div className="flex gap-2"><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} className={fieldClass} placeholder="티커, 종목명 또는 ISIN" /><select value={countryFilter} onChange={(event) => setCountryFilter(event.target.value)} className={fieldClass}><option value="">전체 국가</option><option value="US">미국</option><option value="KR">한국</option><option value="JP">일본</option><option value="HK">홍콩</option><option value="CA">캐나다</option></select><button type="button" onClick={() => void search()} className="mt-1 rounded-lg bg-[var(--accent)] px-4 text-sm text-white">검색</button></div>{searchState === "loading" && <p className="mt-3 text-sm text-[var(--muted)]">검색 중...</p>}{(searchState === "empty" || searchState === "error") && <p className="mt-3 text-sm text-[var(--muted)]">검색 결과를 가져오지 못했습니다. <button type="button" className="text-[var(--accent)] underline" onClick={() => setEntryMode("manual")}>직접 입력으로 계속</button></p>}<div className="mt-3 space-y-2">{searchResults.map((result) => <button type="button" key={`${result.providerSymbol}:${result.exchangeCode}`} onClick={() => selectResult(result)} className="block w-full rounded-lg border p-3 text-left"><b>{result.ticker} · {result.name}</b><span className="mt-1 block text-xs text-[var(--muted)]">{result.countryCode ?? "—"} · {result.exchangeCode} · {result.currency} · {result.assetType} · {result.providerSymbol}{result.previousClose ? ` · ${result.previousClose} (${result.previousCloseDate ?? "—"})` : ""}</span></button>)}</div></div>}</div>}<div className={`grid gap-5 p-5 sm:grid-cols-2 ${!stock && entryMode === "search" ? "hidden" : ""}`}>
    <Field label={t("티커")} error={errorText(errors.ticker?.message, "티커는 20자 이내로 입력해 주세요.")}><input autoFocus className={fieldClass} placeholder={t("예: 005930, TSLA")} {...register("ticker")} /></Field>
    <Field label={t("종목명")} error={errorText(errors.name?.message, "종목명은 100자 이내로 입력해 주세요.")}><input className={fieldClass} placeholder={t("예: 삼성전자")} {...register("name")} /></Field>
    <Field label={t("시장")}><select className={fieldClass} value={market} onChange={(e) => syncCurrency(e.target.value)}>{markets.map((v) => <option key={v} value={v}>{t(v)}</option>)}</select></Field>
    <Field label={t("통화")}><select aria-label={t("통화")} className={fieldClass} {...register("currency")}>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select>{ledgerManaged && <span className="mt-1 block text-xs font-normal leading-5 text-[var(--muted)]">{t("통화를 변경하면 기존 매수·매도 기록의 통화와 거래일 환율을 다시 적용합니다.")}</span>}</Field>
    <Field label="가격 제공자"><select className={fieldClass} {...register("provider")}><option value="manual">수동</option><option value="eodhd">EODHD</option><option value="twelve-data">Twelve Data</option></select></Field><Field label="Provider symbol" error={errors.providerSymbol?.message}><input className={fieldClass} placeholder="SHLD.TO" {...register("providerSymbol")} /></Field><Field label="국가 코드" error={errors.countryCode?.message}><input className={fieldClass} placeholder="CA" {...register("countryCode")} /></Field><Field label="거래소 코드" error={errors.exchangeCode?.message}><input className={fieldClass} placeholder="TO" {...register("exchangeCode")} /></Field>
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
  </div>{saveError && <p role="alert" className="mx-5 mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">{saveError}</p>}<div className="sticky bottom-0 flex justify-end gap-2 border-t bg-[var(--surface)] p-4"><button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button disabled={isSubmitting || saving} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white disabled:opacity-60">{t(stock ? "변경 저장" : "종목 추가")}</button></div></form>{pendingCorrection && stock && correctionAnalysis && <div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4" role="alertdialog" aria-modal="true" aria-labelledby="currency-correction-title"><div className="w-full max-w-lg rounded-xl border bg-[var(--surface)] p-5 shadow-2xl"><h2 id="currency-correction-title" className="text-lg font-semibold">{t("종목 통화를 변경할까요?")}</h2><p className="mt-2 text-xl font-semibold tabular-nums">{stock.currency} → {pendingCorrection.currency}</p><dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-[var(--surface-muted)] p-3 text-sm"><div><dt className="text-[var(--muted)]">{t("영향받는 매매 기록")}</dt><dd className="mt-1 font-medium">{t("{count}건", { count: formatNumber(correctionAnalysis.securityTradeCount) })}</dd></div><div><dt className="text-[var(--muted)]">{t("영향받는 계좌")}</dt><dd className="mt-1 font-medium">{t("{count}개", { count: formatNumber(correctionAnalysis.affectedAccountIds.length) })}</dd></div></dl><ul className="mt-4 space-y-2 text-sm leading-6 text-[var(--muted)]"><li>• {t("가격 숫자는 환산하지 않습니다.")}</li><li>• {t("기존 매수·매도의 통화가 {currency}(으)로 변경됩니다.", { currency: pendingCorrection.currency })}</li><li>• {t("각 거래일의 과거 환율을 다시 적용합니다.")}</li><li>• {t("원화 기준 투자원금과 손익이 다시 계산됩니다.")}</li></ul><div className="mt-4 rounded-lg border p-3 text-sm"><span className="text-[var(--muted)]">{t("현재 가격")}</span><p className="mt-1 tabular-nums">{formatNumber(stock.currentPrice)} {stock.currency} → {formatNumber(stock.currentPrice)} {pendingCorrection.currency}</p></div><div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setPendingCorrection(null)} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button type="button" disabled={saving} onClick={() => void persist(pendingCorrection)} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{t("통화 변경")}</button></div></div></div>}</div>;
}

function LegacyValue({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="mt-1 tabular-nums">{value}</dd></div>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium">{label}{children}{error && <span className="mt-1 block text-xs text-red-600">{error}</span>}</label>;
}
