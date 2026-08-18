import { currencies, type Currency } from "@/domain/currency";
import type { InstrumentSearchResult } from "./market-data";
import { marketFromCountry } from "./market-data";
import type { Stock } from "./types";

export type CreateStockFromInstrumentOptions = {
  id: string;
  now: string;
};

export type InstrumentSearchResultIssue = "unsupported-currency" | "invalid-identity" | "invalid-price";

export function supportedInstrumentCurrency(value: string): Currency | null {
  return currencies.includes(value as Currency) ? value as Currency : null;
}

export function instrumentSearchResultIssue(result: InstrumentSearchResult): InstrumentSearchResultIssue | null {
  const countryCode = result.countryCode?.trim().toUpperCase() || null;
  if (!supportedInstrumentCurrency(result.currency)) return "unsupported-currency";
  if (result.provider !== "eodhd" || !result.providerSymbol.trim() || !result.exchangeCode.trim() || !result.ticker.trim() || !result.name.trim()) return "invalid-identity";
  if (countryCode !== null && !/^[A-Z]{2}$/.test(countryCode)) return "invalid-identity";
  if (result.previousClose !== null && (!Number.isFinite(result.previousClose) || result.previousClose < 0)) return "invalid-price";
  return null;
}

export function createStockFromInstrumentSearchResult(
  result: InstrumentSearchResult,
  options: CreateStockFromInstrumentOptions,
): Stock {
  const id = options.id.trim();
  const ticker = result.ticker.trim();
  const name = result.name.trim();
  const providerSymbol = result.providerSymbol.trim();
  const exchangeCode = result.exchangeCode.trim();
  const currency = supportedInstrumentCurrency(result.currency);
  const countryCode = result.countryCode?.trim().toUpperCase() || null;
  const previousClose = result.previousClose;

  if (!id || !Number.isFinite(Date.parse(options.now))) throw new Error("INVALID_STOCK_DRAFT");
  const issue = instrumentSearchResultIssue(result);
  if (issue === "unsupported-currency" || !currency) throw new Error("UNSUPPORTED_INSTRUMENT_CURRENCY");
  if (issue === "invalid-identity") throw new Error("INVALID_INSTRUMENT_IDENTITY");
  if (issue === "invalid-price") throw new Error("INVALID_INSTRUMENT_PRICE");

  const hasPreviousClose = previousClose !== null;
  return {
    id,
    ticker,
    name,
    market: marketFromCountry(countryCode),
    currency,
    countryCode,
    exchangeCode,
    exchangeMic: result.exchangeMic?.trim() || null,
    exchangeName: result.exchangeName?.trim() || null,
    isin: result.isin?.trim().toUpperCase() || null,
    providerRefs: [{ provider: result.provider, symbol: providerSymbol, exchangeCode }],
    quotePreference: "auto",
    assetType: result.assetType.trim() || "주식",
    marketSector: null,
    sector: "",
    status: "관찰",
    investmentType: "관찰 전용",
    currentPrice: previousClose ?? 0,
    priceUpdatedAt: options.now,
    priceQuotedAt: hasPreviousClose ? result.previousCloseDate ?? options.now : options.now,
    priceSource: hasPreviousClose ? result.provider : "manual",
    priceFreshness: hasPreviousClose ? "eod" : "manual",
    priceDelayMinutes: null,
    priceStatus: hasPreviousClose ? "online" : "manual",
    targetPrice: null,
    averagePrice: 0,
    quantity: 0,
    thesisSummary: "",
    currentView: "판단 보류",
    currentViewMemo: "",
    nextReviewDate: null,
    reviewNote: "",
    nextEarningsDate: null,
    ledgerInitializedAt: options.now,
    tags: [],
    createdAt: options.now,
    updatedAt: options.now,
    deletedAt: null,
  };
}
