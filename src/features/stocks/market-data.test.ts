import { describe, expect, it } from "vitest";
import { applyQuote, marketFromCountry, planQuoteRequests, validateQuote, type MarketQuote } from "./market-data";
import type { Stock } from "./types";
const stock = { id: "s", ticker: "SHLD", market: "캐나다", countryCode: "CA", exchangeCode: "TO", currency: "CAD", providerRefs: [{ provider: "eodhd", symbol: "SHLD.TO", exchangeCode: "TO" }], quotePreference: "auto", currentPrice: 10 } as Stock;
const quote: MarketQuote = { provider: "eodhd", providerSymbol: "SHLD.TO", price: 12, currency: "CAD", exchangeCode: "TO", countryCode: "CA", quotedAt: "2026-08-12", freshness: "eod", delayMinutes: null, isMarketOpen: null };
describe("market data routing", () => {
  it("maps supported countries without guessing others", () => { expect(marketFromCountry("CA")).toBe("캐나다"); expect(marketFromCountry("GB")).toBe("기타"); });
  it("routes non-US only to an exact EODHD ref", () => expect(planQuoteRequests(stock)).toEqual([{ provider: "eodhd", providerSymbol: "SHLD.TO", exchangeCode: "TO", expectedCurrency: "CAD", expectedCountryCode: "CA" }]));
  it("rejects mismatch and preserves the original stock", () => { expect(() => validateQuote(stock, planQuoteRequests(stock)[0], { ...quote, currency: "USD" })).toThrow("IDENTITY_MISMATCH"); expect(stock.currentPrice).toBe(10); });
  it("applies only validated quote metadata", () => expect(applyQuote(stock, validateQuote(stock, planQuoteRequests(stock)[0], quote), "now")).toMatchObject({ currentPrice: 12, priceSource: "eodhd", priceFreshness: "eod", priceUpdatedAt: "now" }));
});
