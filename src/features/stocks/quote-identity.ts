import type { Stock, TwelveDataIdentity } from "./types";

export type TwelveDataQuote = { price: number; symbol: string; country: string; currency: string; exchange: string; quotedAt: string; isMarketOpen: boolean | null; source: string };

export function twelveDataIdentity(stock: Stock): TwelveDataIdentity | null {
  if (stock.twelveData) return normalizeIdentity(stock.twelveData);
  return null;
}

export function assertMatchingQuote(stock: Stock, quote: TwelveDataQuote) {
  const identity = twelveDataIdentity(stock);
  if (!identity) throw new Error("QUOTE_IDENTITY_MISSING");
  if (normalize(quote.symbol) !== normalize(identity.symbol)) throw new Error("QUOTE_SYMBOL_MISMATCH");
  if (normalize(quote.currency) !== normalize(stock.currency)) throw new Error("QUOTE_CURRENCY_MISMATCH");
  if (identity.exchange && normalize(quote.exchange) !== normalize(identity.exchange)) throw new Error("QUOTE_EXCHANGE_MISMATCH");
  if (!countryMatches(identity.country, quote.country)) throw new Error("QUOTE_COUNTRY_MISMATCH");
  if (!Number.isFinite(quote.price) || quote.price <= 0) throw new Error("QUOTE_PRICE_INVALID");
  return quote;
}

function normalizeIdentity(identity: TwelveDataIdentity): TwelveDataIdentity {
  return { symbol: normalize(identity.symbol), country: normalize(identity.country), exchange: normalize(identity.exchange) };
}
function normalize(value: string) { return value.trim().toUpperCase(); }
function countryMatches(expected: string, actual: string) {
  const aliases: Record<string, string> = { CANADA: "CA", "UNITED STATES": "US", USA: "US", "SOUTH KOREA": "KR", KOREA: "KR" };
  return (aliases[normalize(expected)] ?? normalize(expected)) === (aliases[normalize(actual)] ?? normalize(actual));
}
