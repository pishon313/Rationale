import type { Currency } from "@/domain/currency";
import type { MarketDataProvider, QuoteFreshness, Stock } from "./types";

export type InstrumentSearchResult = { provider: "eodhd"; providerSymbol: string; ticker: string; name: string; countryCode: string | null; countryName: string | null; exchangeCode: string; exchangeMic: string | null; exchangeName: string | null; currency: string; assetType: string; isin: string | null; previousClose: number | null; previousCloseDate: string | null; isPrimary: boolean | null };
export type MarketQuote = { provider: Exclude<MarketDataProvider, "manual">; providerSymbol: string; price: number; currency: string; exchangeCode: string | null; countryCode: string | null; quotedAt: string; freshness: QuoteFreshness; delayMinutes: number | null; isMarketOpen: boolean | null };
export type QuoteRequest = { provider: "eodhd" | "twelve-data"; providerSymbol: string; exchangeCode?: string | null; expectedCurrency: Currency; expectedCountryCode?: string | null };

export function marketFromCountry(countryCode: string | null | undefined): Stock["market"] {
  return ({ KR: "한국", US: "미국", JP: "일본", HK: "홍콩", CA: "캐나다" } as const)[countryCode?.toUpperCase() as "KR"] ?? "기타";
}

export function providerRef(stock: Stock, provider: QuoteRequest["provider"]) { return stock.providerRefs?.find((ref) => ref.provider === provider) ?? null; }

export function planQuoteRequests(stock: Stock): QuoteRequest[] {
  if ((stock.quotePreference ?? "manual") === "manual") return [];
  const expected = { expectedCurrency: stock.currency, expectedCountryCode: stock.countryCode ?? null };
  const eodhd = providerRef(stock, "eodhd"); const twelve = providerRef(stock, "twelve-data");
  if (stock.quotePreference === "eodhd") return eodhd ? [{ provider: "eodhd", providerSymbol: eodhd.symbol, exchangeCode: eodhd.exchangeCode, ...expected }] : [];
  if (stock.quotePreference === "twelve-data") return twelve ? [{ provider: "twelve-data", providerSymbol: twelve.symbol, exchangeCode: twelve.exchangeCode, ...expected }] : [];
  return stock.countryCode === "US"
    ? [...(twelve ? [{ provider: "twelve-data" as const, providerSymbol: twelve.symbol, exchangeCode: twelve.exchangeCode, ...expected }] : []), ...(eodhd ? [{ provider: "eodhd" as const, providerSymbol: eodhd.symbol, exchangeCode: eodhd.exchangeCode, ...expected }] : [])]
    : eodhd ? [{ provider: "eodhd", providerSymbol: eodhd.symbol, exchangeCode: eodhd.exchangeCode, ...expected }] : [];
}

export function validateQuote(stock: Stock, request: QuoteRequest, quote: MarketQuote) {
  const ref = providerRef(stock, request.provider);
  if (!ref || quote.provider !== request.provider || normalize(quote.providerSymbol) !== normalize(ref.symbol)) throw new Error("IDENTITY_MISMATCH");
  if (normalize(quote.currency) !== normalize(stock.currency)) throw new Error("IDENTITY_MISMATCH");
  if (ref.exchangeCode && normalize(quote.exchangeCode ?? "") !== normalize(ref.exchangeCode)) throw new Error("IDENTITY_MISMATCH");
  if (stock.countryCode && normalize(quote.countryCode ?? "") !== normalize(stock.countryCode)) throw new Error("IDENTITY_MISMATCH");
  if (!Number.isFinite(quote.price) || quote.price <= 0) throw new Error("INVALID_RESPONSE");
  return quote;
}

export function stockFromSearchResult(result: InstrumentSearchResult, now = new Date().toISOString()): Partial<Stock> {
  return { ticker: result.ticker, name: result.name, market: marketFromCountry(result.countryCode), countryCode: result.countryCode, exchangeCode: result.exchangeCode, exchangeMic: result.exchangeMic, exchangeName: result.exchangeName, isin: result.isin, currency: result.currency as Currency, assetType: result.assetType || "주식", providerRefs: [{ provider: "eodhd", symbol: result.providerSymbol, exchangeCode: result.exchangeCode }], quotePreference: "auto", currentPrice: result.previousClose ?? 0, priceSource: result.previousClose ? "eodhd" : "manual", priceFreshness: result.previousClose ? "eod" : "manual", priceQuotedAt: result.previousCloseDate, priceUpdatedAt: result.previousClose ? now : null };
}

export function applyQuote(stock: Stock, quote: MarketQuote, now = new Date().toISOString()): Stock {
  return { ...stock, currentPrice: quote.price, priceUpdatedAt: now, priceQuotedAt: quote.quotedAt || null, priceSource: quote.provider, priceFreshness: quote.freshness, priceDelayMinutes: quote.delayMinutes, priceStatus: "online", updatedAt: now };
}
function normalize(value: string) { return value.trim().toUpperCase(); }
