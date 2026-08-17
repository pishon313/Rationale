"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { invoke } from "@tauri-apps/api/core";
import { WalletCards, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { Trade } from "@/features/trades/types";
import { useI18n } from "@/i18n/i18n-provider";
import { isTauriApp } from "@/lib/local-repository";
import { marketFromCountry, type InstrumentSearchResult } from "./market-data";
import { stockFormSchema, type StockFormValues } from "./schema";
import type { StockAccountHolding } from "./stock-account-holdings";
import { analyzeStockCurrencyCorrection, StockCurrencyCorrectionError } from "./stock-currency-correction";
import { marketSectorLabel, marketSectors } from "./market-sectors";
import { canonicalPortfolioCategoryName, collectPortfolioCategories } from "./portfolio-categories";
import { currencies, investmentTypes, markets, stockStatuses, stockViews, type MarketDataProvider, type Stock } from "./types";

type Props = {
  stock?: Stock;
  holdings?: StockAccountHolding[];
  trades?: Trade[];
  categoryStocks?: readonly Stock[];
  onCancel: () => void;
  onSave: (stock: Stock) => void | boolean | Promise<void | boolean>;
};

const fieldClass = "mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm";
const openPositionTolerance = 1e-8;

export function StockForm({ stock, holdings = [], trades = [], categoryStocks = [], onCancel, onSave }: Props) {
  const { t, localeTag, formatNumber } = useI18n();
  const ledgerManaged = Boolean(stock?.ledgerInitializedAt);
  const legacyPosition = Boolean(stock && !stock.ledgerInitializedAt);
  const storedListingLocked = Boolean(stock?.providerRefs?.length && stock.quotePreference !== "manual");
  const relinkBlocked = Boolean(stock && (
    trades.length > 0
    || holdings.some((holding) => Math.abs(holding.quantity) > openPositionTolerance)
    || Math.abs(stock.quantity) > openPositionTolerance
  ));
  const [pendingCorrection, setPendingCorrection] = useState<Stock | null>(null);
  const [confirmingManualManagement, setConfirmingManualManagement] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [entryMode, setEntryMode] = useState<"search" | "manual">(stock ? "manual" : "search");
  const [relinking, setRelinking] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState("");
  const [searchResults, setSearchResults] = useState<InstrumentSearchResult[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const [selectedSearchResult, setSelectedSearchResult] = useState<InstrumentSearchResult | null>(null);
  const errorText = (message: string | undefined, fallback: string) => {
    if (!message) return undefined;
    return /[가-힣]/.test(message) ? t(message) : t(fallback);
  };
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, dirtyFields },
    watch,
    setValue,
  } = useForm<StockFormValues>({
    resolver: zodResolver(stockFormSchema),
    defaultValues: stock ? {
      ticker: stock.ticker,
      name: stock.name,
      market: stock.market,
      currency: stock.currency,
      countryCode: stock.countryCode ?? "",
      exchangeCode: stock.exchangeCode ?? "",
      providerSymbol: stock.providerRefs?.[0]?.symbol ?? "",
      provider: stock.providerRefs?.[0]?.provider ?? "manual",
      assetType: stock.assetType,
      marketSector: stock.marketSector ?? "",
      sector: stock.sector,
      status: stock.status,
      investmentType: stock.investmentType,
      currentPrice: stock.currentPrice,
      targetPrice: stock.targetPrice,
      averagePrice: stock.averagePrice,
      quantity: stock.quantity,
      thesisSummary: stock.thesisSummary,
      currentView: stock.currentView,
      currentViewMemo: stock.currentViewMemo,
      nextReviewDate: stock.nextReviewDate,
      reviewNote: stock.reviewNote ?? "",
      nextEarningsDate: stock.nextEarningsDate ?? null,
      tagsText: stock.tags.join(", "),
    } : {
      ticker: "",
      name: "",
      market: "한국",
      currency: "KRW",
      countryCode: "",
      exchangeCode: "",
      providerSymbol: "",
      provider: "manual",
      assetType: "주식",
      marketSector: "",
      sector: "",
      status: "관찰",
      investmentType: "관찰 전용",
      currentPrice: 0,
      targetPrice: null,
      averagePrice: 0,
      quantity: 0,
      thesisSummary: "",
      currentView: "판단 보류",
      currentViewMemo: "",
      nextReviewDate: null,
      reviewNote: "",
      nextEarningsDate: null,
      tagsText: "",
    },
  });

  const market = watch("market");
  const selectedCurrency = watch("currency");
  const listedTicker = watch("ticker");
  const listedName = watch("name");
  const listedCountry = watch("countryCode");
  const listedExchange = watch("exchangeCode");
  const listedProvider = watch("provider");
  const listedProviderSymbol = watch("providerSymbol");
  const selectedCategory = watch("sector");
  const categoryOptions = collectPortfolioCategories(categoryStocks, selectedCategory, localeTag);
  const listingReadOnly = storedListingLocked || selectedSearchResult !== null;
  const displayedProviderRefs = selectedSearchResult
    ? [{ provider: selectedSearchResult.provider, symbol: selectedSearchResult.providerSymbol }]
    : stock?.providerRefs ?? (listedProvider === "manual" ? [] : [{ provider: listedProvider, symbol: listedProviderSymbol }]);
  const correctionAnalysis = stock
    ? analyzeStockCurrencyCorrection({ stock, trades, newCurrency: selectedCurrency })
    : null;

  function syncCurrency(value: string) {
    setValue("market", value as Stock["market"]);
    if (ledgerManaged) return;
    if (value === "한국") setValue("currency", "KRW");
    if (value === "미국") setValue("currency", "USD");
  }

  function resetSearch() {
    setSearchQuery("");
    setCountryFilter("");
    setSearchResults([]);
    setSearchState("idle");
  }

  function switchToManualEntry() {
    setSelectedSearchResult(null);
    setValue("provider", "manual");
    setValue("providerSymbol", "");
    setEntryMode("manual");
    resetSearch();
  }

  async function search() {
    if (!searchQuery.trim()) return;
    if (!isTauriApp()) {
      setSearchState("error");
      return;
    }
    setSearchState("loading");
    try {
      const results = await invoke<InstrumentSearchResult[]>("search_instruments", {
        request: { provider: "eodhd", query: searchQuery, countryCode: countryFilter || null, limit: 20 },
      });
      setSearchResults(results);
      setSearchState(results.length ? "idle" : "empty");
    } catch {
      setSearchResults([]);
      setSearchState("error");
    }
  }

  function selectResult(result: InstrumentSearchResult) {
    const currency = supportedCurrency(result.currency);
    if (!currency) return;
    setSelectedSearchResult(result);
    setValue("ticker", result.ticker);
    setValue("name", result.name);
    setValue("market", marketFromCountry(result.countryCode));
    setValue("currency", currency);
    setValue("countryCode", result.countryCode ?? "");
    setValue("exchangeCode", result.exchangeCode);
    setValue("provider", result.provider);
    setValue("providerSymbol", result.providerSymbol);
    setValue("assetType", result.assetType || "주식");
    setValue("currentPrice", result.previousClose ?? 0);
    setSaveError("");
    setEntryMode("manual");
    setRelinking(false);
    resetSearch();
  }

  async function persist(next: Stock) {
    setSaving(true);
    setSaveError("");
    try {
      const saved = await onSave(next);
      if (saved === false) return;
    } catch (error) {
      if (error instanceof StockCurrencyCorrectionError && error.code === "HISTORICAL_FX") {
        setSaveError(t("{date} 거래의 과거 환율을 확인하지 못해 통화를 변경하지 않았습니다.", { date: error.tradeDate ?? "—" }));
      } else if (error instanceof StockCurrencyCorrectionError && error.code === "MIXED_CURRENCY") {
        setSaveError(t("이 종목에는 서로 다른 통화의 매매 기록이 있어 통화를 자동으로 변경할 수 없습니다. 매매 기록의 통화를 먼저 확인해 주세요."));
      } else {
        setSaveError(error instanceof Error ? error.message : t("변경 내용을 저장하지 못했습니다."));
      }
    } finally {
      setSaving(false);
      setPendingCorrection(null);
      setConfirmingManualManagement(false);
    }
  }

  async function enableManualManagement() {
    if (!stock || !storedListingLocked) return;
    await persist({
      ...stock,
      providerRefs: [],
      quotePreference: "manual",
      updatedAt: new Date().toISOString(),
    });
  }

  return <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="dialog" aria-modal="true" aria-labelledby="stock-form-title">
    <form className="h-full w-full overflow-y-auto bg-[var(--surface)] shadow-2xl sm:max-w-2xl" onSubmit={handleSubmit(async (values) => {
      const parsed = stockFormSchema.parse(values);
      const now = new Date().toISOString();
      const keepStoredIdentity = storedListingLocked && !selectedSearchResult && stock;
      const providerRefs = selectedSearchResult
        ? [{ provider: selectedSearchResult.provider, symbol: selectedSearchResult.providerSymbol, exchangeCode: selectedSearchResult.exchangeCode }]
        : keepStoredIdentity
          ? stock.providerRefs ?? []
          : parsed.provider === "manual"
            ? []
            : [{ provider: parsed.provider, symbol: parsed.providerSymbol, exchangeCode: parsed.exchangeCode || null }];
      const quotePreference = selectedSearchResult
        ? "auto"
        : keepStoredIdentity
          ? stock.quotePreference ?? "auto"
          : parsed.provider === "manual" || (stock?.quotePreference === "manual" && Boolean(stock.providerRefs?.length))
            ? "manual"
            : "auto";
      const priceChanged = !stock || stock.currentPrice !== parsed.currentPrice;
      const searchedPrice = selectedSearchResult?.previousClose ?? null;
      const marketSector = stock && !dirtyFields.marketSector ? stock.marketSector : parsed.marketSector;
      const portfolioCategory = stock && !dirtyFields.sector
        ? stock.sector
        : canonicalPortfolioCategoryName(categoryStocks, parsed.sector);
      const next: Stock = {
        id: stock?.id ?? crypto.randomUUID(),
        ticker: keepStoredIdentity ? stock.ticker : parsed.ticker,
        name: keepStoredIdentity ? stock.name : parsed.name,
        market: keepStoredIdentity ? stock.market : parsed.market,
        currency: keepStoredIdentity ? stock.currency : parsed.currency,
        assetType: parsed.assetType,
        ...(marketSector === undefined ? {} : { marketSector }),
        sector: portfolioCategory,
        status: parsed.status,
        countryCode: keepStoredIdentity ? stock.countryCode ?? null : parsed.countryCode || null,
        exchangeCode: keepStoredIdentity ? stock.exchangeCode ?? null : parsed.exchangeCode || null,
        exchangeMic: selectedSearchResult?.exchangeMic ?? stock?.exchangeMic ?? null,
        exchangeName: selectedSearchResult?.exchangeName ?? stock?.exchangeName ?? null,
        isin: selectedSearchResult?.isin ?? stock?.isin ?? null,
        providerRefs,
        quotePreference,
        investmentType: parsed.investmentType,
        currentPrice: parsed.currentPrice,
        targetPrice: parsed.targetPrice,
        averagePrice: stock?.averagePrice ?? 0,
        quantity: stock?.quantity ?? 0,
        ...(stock?.openingAccountName !== undefined ? { openingAccountName: stock.openingAccountName } : {}),
        thesisSummary: parsed.thesisSummary,
        currentView: parsed.currentView,
        currentViewMemo: parsed.currentViewMemo,
        nextReviewDate: parsed.nextReviewDate || null,
        reviewNote: parsed.reviewNote,
        nextEarningsDate: parsed.nextEarningsDate || null,
        tags: parsed.tagsText.split(",").map((tag) => tag.trim()).filter(Boolean),
        priceUpdatedAt: searchedPrice !== null || priceChanged ? now : stock?.priceUpdatedAt ?? null,
        priceQuotedAt: searchedPrice !== null
          ? selectedSearchResult?.previousCloseDate ?? now
          : priceChanged ? now : stock?.priceQuotedAt ?? null,
        priceSource: searchedPrice !== null ? selectedSearchResult?.provider : priceChanged ? "manual" : stock?.priceSource ?? "manual",
        priceFreshness: searchedPrice !== null ? "eod" : priceChanged ? "manual" : stock?.priceFreshness ?? "manual",
        priceDelayMinutes: searchedPrice !== null || priceChanged ? null : stock?.priceDelayMinutes ?? null,
        priceStatus: searchedPrice !== null ? "online" : priceChanged ? "manual" : stock?.priceStatus ?? "manual",
        ledgerInitializedAt: stock ? stock.ledgerInitializedAt ?? null : now,
        createdAt: stock?.createdAt ?? now,
        updatedAt: now,
        deletedAt: null,
      };

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
    })}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-[var(--surface)] px-5 py-4">
        <div>
          <h2 id="stock-form-title" className="text-lg font-semibold">{t(stock ? "종목 수정" : "새 종목 추가")}</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">{t("판단에 필요한 기본 정보를 기록하세요.")}</p>
        </div>
        <button type="button" aria-label={t("닫기")} onClick={onCancel} className="grid size-9 place-items-center rounded-lg hover:bg-[var(--surface-muted)]"><X size={19} /></button>
      </div>

      {!stock && <div className="border-b p-5">
        <div className="flex gap-2">
          <button type="button" onClick={() => { setEntryMode("search"); resetSearch(); }} className={`rounded-lg px-3 py-2 text-sm ${entryMode === "search" ? "bg-[var(--accent)] text-white" : "border"}`}>검색해서 추가</button>
          <button type="button" onClick={switchToManualEntry} className={`rounded-lg px-3 py-2 text-sm ${entryMode === "manual" && !selectedSearchResult ? "bg-[var(--accent)] text-white" : "border"}`}>직접 입력</button>
        </div>
        {entryMode === "search" && <SearchPanel
          searchQuery={searchQuery}
          countryFilter={countryFilter}
          searchResults={searchResults}
          searchState={searchState}
          onQueryChange={setSearchQuery}
          onCountryChange={setCountryFilter}
          onSearch={() => void search()}
          onSelect={selectResult}
          onManualFallback={switchToManualEntry}
        />}
      </div>}

      <div className={`grid gap-5 p-5 sm:grid-cols-2 ${!stock && entryMode === "search" ? "hidden" : ""}`}>
        {listingReadOnly ? <section className="sm:col-span-2 rounded-xl border bg-[var(--surface-muted)] p-4" aria-labelledby="linked-listing-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="linked-listing-title" className="font-semibold">검색으로 연결된 종목 정보</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">연결 정보는 API 키나 현재 가격 조회 상태와 관계없이 보호됩니다.</p>
            </div>
            {selectedSearchResult && <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs text-[var(--accent)]">새 연결 예정</span>}
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <ReadOnlyValue label={t("티커")} value={listedTicker} />
            <ReadOnlyValue label={t("종목명")} value={listedName} />
            <ReadOnlyValue label={t("시장")} value={t(market)} />
            <ReadOnlyValue label={t("통화")} value={selectedCurrency} />
            <ReadOnlyValue label="가격 제공자" value={displayedProviderRefs.map((ref) => providerName(ref.provider)).join(", ") || "—"} />
            <ReadOnlyValue label="Provider symbol" value={displayedProviderRefs.map((ref) => ref.symbol).join(", ") || "—"} />
            <ReadOnlyValue label="국가 코드" value={listedCountry || "—"} />
            <ReadOnlyValue label="거래소 코드" value={listedExchange || "—"} />
          </dl>
          <input type="hidden" {...register("ticker")} />
          <input type="hidden" {...register("name")} />
          <input type="hidden" {...register("market")} />
          <input type="hidden" {...register("currency")} />
          <input type="hidden" {...register("provider")} />
          <input type="hidden" {...register("providerSymbol")} />
          <input type="hidden" {...register("countryCode")} />
          <input type="hidden" {...register("exchangeCode")} />
          {stock && storedListingLocked && <div className="mt-4 border-t pt-4">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setConfirmingManualManagement(true)} className="rounded-lg border bg-[var(--surface)] px-3 py-2 text-sm font-medium">수동 관리로 전환</button>
              <button type="button" disabled={relinkBlocked} onClick={() => { setRelinking(true); resetSearch(); }} className="rounded-lg border bg-[var(--surface)] px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50">다른 종목으로 다시 연결</button>
            </div>
            {relinkBlocked && <p className="mt-2 text-xs leading-5 text-[var(--muted)]">기존 기록 보호를 위해 새 종목으로 추가해 주세요.</p>}
            {relinking && <div className="mt-4 rounded-lg border bg-[var(--surface)] p-4">
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-semibold">새 종목 검색</h4>
                <button type="button" onClick={() => { setRelinking(false); resetSearch(); }} className="text-xs text-[var(--muted)] underline">재연결 취소</button>
              </div>
              <SearchPanel
                searchQuery={searchQuery}
                countryFilter={countryFilter}
                searchResults={searchResults}
                searchState={searchState}
                onQueryChange={setSearchQuery}
                onCountryChange={setCountryFilter}
                onSearch={() => void search()}
                onSelect={selectResult}
              />
            </div>}
          </div>}
          {!stock && selectedSearchResult && <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
            <button type="button" onClick={() => { setSelectedSearchResult(null); setEntryMode("search"); resetSearch(); }} className="rounded-lg border bg-[var(--surface)] px-3 py-2 text-sm">검색 결과 다시 선택</button>
            <button type="button" onClick={switchToManualEntry} className="rounded-lg border bg-[var(--surface)] px-3 py-2 text-sm">직접 입력으로 전환</button>
          </div>}
        </section> : <>
          <Field label={t("티커")} error={errorText(errors.ticker?.message, "티커는 20자 이내로 입력해 주세요.")}><input autoFocus className={fieldClass} placeholder={t("예: 005930, TSLA")} {...register("ticker")} /></Field>
          <Field label={t("종목명")} error={errorText(errors.name?.message, "종목명은 100자 이내로 입력해 주세요.")}><input className={fieldClass} placeholder={t("예: 삼성전자")} {...register("name")} /></Field>
          <Field label={t("시장")}><select className={fieldClass} value={market} onChange={(event) => syncCurrency(event.target.value)}>{markets.map((value) => <option key={value} value={value}>{t(value)}</option>)}</select></Field>
          <Field label={t("통화")}><select aria-label={t("통화")} className={fieldClass} {...register("currency")}>{currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}</select>{ledgerManaged && <span className="mt-1 block text-xs font-normal leading-5 text-[var(--muted)]">{t("통화를 변경하면 기존 매수·매도 기록의 통화와 거래일 환율을 다시 적용합니다.")}</span>}</Field>
          <Field label="가격 제공자"><select className={fieldClass} {...register("provider")}><option value="manual">수동</option><option value="eodhd">EODHD</option><option value="twelve-data">Twelve Data</option></select></Field>
          <Field label="Provider symbol" error={errors.providerSymbol?.message}><input className={fieldClass} placeholder="SHLD.TO" {...register("providerSymbol")} /></Field>
          <Field label="국가 코드" error={errors.countryCode?.message}><input className={fieldClass} placeholder="CA" {...register("countryCode")} /></Field>
          <Field label="거래소 코드" error={errors.exchangeCode?.message}><input className={fieldClass} placeholder="TO" {...register("exchangeCode")} /></Field>
        </>}

        <Field label={t("자산 유형")} error={errorText(errors.assetType?.message, "자산 유형을 입력해 주세요.")}><input className={fieldClass} {...register("assetType")} /></Field>
        <section className="rounded-xl border bg-[var(--surface-muted)] p-4 sm:col-span-2" aria-labelledby="stock-classification-title">
          <h3 id="stock-classification-title" className="font-semibold">{t("분류")}</h3>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Field label={t("시장 섹터")} error={errors.marketSector?.message}>
              <select aria-label={t("시장 섹터")} aria-describedby="market-sector-help" className={fieldClass} {...register("marketSector")}>
                <option value="">{t("미지정")}</option>
                {marketSectors.map((id) => <option key={id} value={id}>{marketSectorLabel(id, t)}</option>)}
              </select>
              <span id="market-sector-help" className="mt-1.5 block text-xs font-normal leading-5 text-[var(--muted)]">{t("객관적인 산업 노출을 비교하기 위한 선택 항목입니다.")} {t("여러 섹터에 걸친 ETF는 비워둘 수 있습니다.")}</span>
            </Field>
            <Field label={t("내 분류")} error={errorText(errors.sector?.message, "내 분류는 60자 이내로 입력해 주세요.")}>
              <input aria-label={t("내 분류")} aria-describedby="portfolio-category-help" className={fieldClass} list="portfolio-category-options" placeholder={t("기존 분류를 선택하거나 새 분류 입력")} {...register("sector")} />
              <datalist id="portfolio-category-options">{categoryOptions.map((category) => <option key={category.key} value={category.name} />)}</datalist>
              <span id="portfolio-category-help" className="mt-1.5 block text-xs font-normal leading-5 text-[var(--muted)]">{t("대시보드에서 포트폴리오를 묶는 한 가지 대표 분류입니다.")} {t("시장 기준과 다르게 자유롭게 정할 수 있습니다.")}</span>
            </Field>
          </div>
        </section>
        <Field label={t("상태")}><select className={fieldClass} {...register("status")}>{stockStatuses.map((value) => <option key={value} value={value}>{t(value)}</option>)}</select></Field>
        <Field label={t("투자 유형")}><select className={fieldClass} {...register("investmentType")}>{investmentTypes.map((value) => <option key={value} value={value}>{t(value)}</option>)}</select></Field>
        <Field label={t("현재 가격")} error={errorText(errors.currentPrice?.message, "0 이상의 값을 입력해 주세요.")}><input type="number" step="any" className={fieldClass} {...register("currentPrice")} /></Field>
        <Field label={t("목표 가격")} error={errorText(errors.targetPrice?.message, "0 이상의 값을 입력해 주세요.")}><input type="number" step="any" className={fieldClass} {...register("targetPrice")} /></Field>
        {!stock && <div className="sm:col-span-2 rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]">{t("보유 계좌·수량·평균단가는 종목 추가 후 매매 원장에서 등록합니다.")}</div>}
        {ledgerManaged && <div className="sm:col-span-2 rounded-lg bg-[var(--surface-muted)] p-4 text-sm">
          <p className="font-medium">{t("보유 계좌")}</p>
          {holdings.length ? <ul className="mt-3 space-y-2">{holdings.map((holding) => <li key={holding.accountId} className="flex items-center justify-between gap-4"><span>{holding.accountName}</span><span className="tabular-nums text-[var(--muted)]">{formatNumber(holding.quantity, { maximumFractionDigits: 8 })}</span></li>)}</ul> : <p className="mt-2 text-xs text-[var(--muted)]">{t("현재 보유 포지션이 없습니다.")}</p>}
          <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{t("계좌와 보유 수량은 매매 원장에서 관리됩니다.")}</p>
          <div className="mt-3 flex flex-wrap gap-2"><Link href="/trades" className="inline-flex items-center gap-2 rounded-lg border bg-[var(--surface)] px-3 py-2 text-sm font-medium"><WalletCards size={16} />{t("매매 원장 열기")}</Link>{holdings.length === 0 && stock && <Link href={`/trades?openingStockId=${encodeURIComponent(stock.id)}`} className="inline-flex items-center gap-2 rounded-lg border bg-[var(--surface)] px-3 py-2 text-sm font-medium"><WalletCards size={16} />{t("기초 포지션 등록")}</Link>}</div>
        </div>}
        {legacyPosition && stock && <div className="sm:col-span-2 rounded-lg bg-[var(--surface-muted)] p-4 text-sm">
          <p className="font-medium">{t("기존 보유 정보")}</p>
          <dl className="mt-3 grid gap-2 sm:grid-cols-3"><LegacyValue label={t("기초 계좌")} value={stock.openingAccountName || "—"} /><LegacyValue label={t("기초 수량")} value={formatNumber(stock.quantity, { maximumFractionDigits: 8 })} /><LegacyValue label={t("기초 평균단가")} value={formatNumber(stock.averagePrice, { maximumFractionDigits: 8 })} /></dl>
          <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{t("매매 원장 전환 전의 기존 보유 기록입니다.")}</p>
          <Link href="/trades" className="mt-3 inline-flex items-center gap-2 rounded-lg border bg-[var(--surface)] px-3 py-2 text-sm font-medium"><WalletCards size={16} />{t("매매 원장 열기")}</Link>
        </div>}
        <Field label={t("현재 판단")}><select className={fieldClass} {...register("currentView")}>{stockViews.map((value) => <option key={value} value={value}>{t(value)}</option>)}</select></Field>
        <Field label={t("다음 검토일")}><input type="date" className={fieldClass} {...register("nextReviewDate")} /></Field>
        <Field label={t("검토할 사항")} error={errorText(errors.reviewNote?.message, "검토할 사항은 300자 이내로 입력해 주세요.")}><input className={fieldClass} placeholder={t("예: 분기 실적과 마진 추이 확인")} {...register("reviewNote")} /></Field>
        <Field label={t("다음 실적 발표일")}><input type="date" className={fieldClass} {...register("nextEarningsDate")} /></Field>
        <div className="sm:col-span-2"><Field label={t("투자 아이디어 요약")} error={errorText(errors.thesisSummary?.message, "투자 아이디어 요약은 500자 이내로 입력해 주세요.")}><textarea className="mt-1 min-h-24 w-full rounded-lg border bg-[var(--surface)] p-3 text-sm" placeholder={t("왜 이 종목을 보고 있는지 짧게 기록하세요.")} {...register("thesisSummary")} /></Field></div>
        <div className="sm:col-span-2"><Field label={t("현재 판단 메모")} error={errorText(errors.currentViewMemo?.message, "현재 판단 메모는 1000자 이내로 입력해 주세요.")}><textarea className="mt-1 min-h-20 w-full rounded-lg border bg-[var(--surface)] p-3 text-sm" {...register("currentViewMemo")} /></Field></div>
        <div className="sm:col-span-2"><Field label={t("태그")}><input aria-label={t("태그")} className={fieldClass} placeholder={t("쉼표로 구분: 반도체, 코어")} {...register("tagsText")} /><span className="mt-1.5 block text-xs font-normal leading-5 text-[var(--muted)]">{t("여러 테마나 특징이 겹칠 때 사용합니다.")} {t("태그는 자산배분 합계를 만들지 않습니다.")}</span></Field></div>
      </div>

      {saveError && <p role="alert" className="mx-5 mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">{saveError}</p>}
      <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-[var(--surface)] p-4"><button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button disabled={isSubmitting || saving} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm font-medium text-white disabled:opacity-60">{t(stock ? "변경 저장" : "종목 추가")}</button></div>
    </form>

    {confirmingManualManagement && stock && <div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4" role="alertdialog" aria-modal="true" aria-labelledby="manual-management-title">
      <div className="w-full max-w-md rounded-xl border bg-[var(--surface)] p-5 shadow-2xl">
        <h2 id="manual-management-title" className="text-lg font-semibold">수동 관리로 전환할까요?</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">자동 시세 연결을 해제합니다. 마지막 정상 가격과 가격 메타데이터는 그대로 보존되며, 전환 후 종목 식별 정보를 직접 수정할 수 있습니다.</p>
        <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setConfirmingManualManagement(false)} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button type="button" disabled={saving} onClick={() => void enableManualManagement()} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">수동 관리로 전환</button></div>
      </div>
    </div>}

    {pendingCorrection && stock && correctionAnalysis && <div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4" role="alertdialog" aria-modal="true" aria-labelledby="currency-correction-title">
      <div className="w-full max-w-lg rounded-xl border bg-[var(--surface)] p-5 shadow-2xl">
        <h2 id="currency-correction-title" className="text-lg font-semibold">{t("종목 통화를 변경할까요?")}</h2>
        <p className="mt-2 text-xl font-semibold tabular-nums">{stock.currency} → {pendingCorrection.currency}</p>
        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-[var(--surface-muted)] p-3 text-sm"><div><dt className="text-[var(--muted)]">{t("영향받는 매매 기록")}</dt><dd className="mt-1 font-medium">{t("{count}건", { count: formatNumber(correctionAnalysis.securityTradeCount) })}</dd></div><div><dt className="text-[var(--muted)]">{t("영향받는 계좌")}</dt><dd className="mt-1 font-medium">{t("{count}개", { count: formatNumber(correctionAnalysis.affectedAccountIds.length) })}</dd></div></dl>
        <ul className="mt-4 space-y-2 text-sm leading-6 text-[var(--muted)]"><li>• {t("가격 숫자는 환산하지 않습니다.")}</li><li>• {t("기존 매수·매도의 통화가 {currency}(으)로 변경됩니다.", { currency: pendingCorrection.currency })}</li><li>• {t("각 거래일의 과거 환율을 다시 적용합니다.")}</li><li>• {t("원화 기준 투자원금과 손익이 다시 계산됩니다.")}</li></ul>
        <div className="mt-4 rounded-lg border p-3 text-sm"><span className="text-[var(--muted)]">{t("현재 가격")}</span><p className="mt-1 tabular-nums">{formatNumber(stock.currentPrice)} {stock.currency} → {formatNumber(stock.currentPrice)} {pendingCorrection.currency}</p></div>
        <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setPendingCorrection(null)} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button type="button" disabled={saving} onClick={() => void persist(pendingCorrection)} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{t("통화 변경")}</button></div>
      </div>
    </div>}
  </div>;
}

type SearchPanelProps = {
  searchQuery: string;
  countryFilter: string;
  searchResults: InstrumentSearchResult[];
  searchState: "idle" | "loading" | "empty" | "error";
  onQueryChange: (value: string) => void;
  onCountryChange: (value: string) => void;
  onSearch: () => void;
  onSelect: (result: InstrumentSearchResult) => void;
  onManualFallback?: () => void;
};

function SearchPanel({ searchQuery, countryFilter, searchResults, searchState, onQueryChange, onCountryChange, onSearch, onSelect, onManualFallback }: SearchPanelProps) {
  return <div className="mt-4">
    <div className="flex flex-col gap-2 sm:flex-row">
      <input aria-label="종목 검색어" value={searchQuery} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onSearch(); } }} className={fieldClass} placeholder="티커, 종목명 또는 ISIN" />
      <select aria-label="국가 필터" value={countryFilter} onChange={(event) => onCountryChange(event.target.value)} className={fieldClass}><option value="">전체 국가</option><option value="US">미국</option><option value="KR">한국</option><option value="JP">일본</option><option value="HK">홍콩</option><option value="CA">캐나다</option></select>
      <button type="button" onClick={onSearch} className="mt-1 rounded-lg bg-[var(--accent)] px-4 text-sm text-white">검색</button>
    </div>
    {searchState === "loading" && <p className="mt-3 text-sm text-[var(--muted)]">검색 중...</p>}
    {(searchState === "empty" || searchState === "error") && <p className="mt-3 text-sm text-[var(--muted)]">검색 결과를 가져오지 못했습니다.{onManualFallback && <> <button type="button" className="text-[var(--accent)] underline" onClick={onManualFallback}>직접 입력으로 계속</button></>}</p>}
    <div className="mt-3 space-y-2">{searchResults.map((result) => {
      const unsupported = !supportedCurrency(result.currency);
      return <button type="button" disabled={unsupported} key={`${result.providerSymbol}:${result.exchangeCode}`} onClick={() => onSelect(result)} className="block w-full rounded-lg border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50">
        <b>{result.ticker} · {result.name}</b>
        <span className="mt-1 block text-xs text-[var(--muted)]">{result.countryCode ?? "—"} · {result.exchangeCode} · {result.currency} · {result.assetType} · {result.providerSymbol}{result.previousClose ? ` · ${result.previousClose} (${result.previousCloseDate ?? "—"})` : ""}</span>
        {unsupported && <span className="mt-1 block text-xs font-medium text-red-600">지원하지 않는 통화</span>}
      </button>;
    })}</div>
  </div>;
}

function supportedCurrency(value: string): Stock["currency"] | null {
  return currencies.includes(value as Stock["currency"]) ? value as Stock["currency"] : null;
}

function providerName(provider: Exclude<MarketDataProvider, "manual">) {
  if (provider === "eodhd") return "EODHD";
  return "Twelve Data";
}

function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-[var(--surface)] p-3"><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="mt-1 font-medium"><output aria-label={label}>{value}</output></dd></div>;
}

function LegacyValue({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="mt-1 tabular-nums">{value}</dd></div>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium">{label}{children}{error && <span className="mt-1 block text-xs text-red-600">{error}</span>}</label>;
}
