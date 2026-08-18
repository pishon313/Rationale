import { describe, expect, it } from "vitest";
import type { InstrumentSearchResult } from "./market-data";
import { createStockFromInstrumentSearchResult } from "./stock-from-instrument";

const now = "2026-08-18T04:00:00.000Z";
const result = (overrides: Partial<InstrumentSearchResult> = {}): InstrumentSearchResult => ({
  provider: "eodhd",
  providerSymbol: "CRWD.US",
  ticker: "CRWD",
  name: "CrowdStrike Holdings",
  countryCode: "US",
  countryName: "USA",
  exchangeCode: "US",
  exchangeMic: "XNAS",
  exchangeName: "NASDAQ",
  currency: "USD",
  assetType: "Common Stock",
  isin: "US22788C1053",
  previousClose: 430.25,
  previousCloseDate: "2026-08-17",
  isPrimary: true,
  ...overrides,
});

describe("createStockFromInstrumentSearchResult", () => {
  it("creates the complete observation-only Stock contract with deterministic identity and timestamps", () => {
    expect(createStockFromInstrumentSearchResult(result(), { id: "draft-stock", now })).toEqual(expect.objectContaining({
      id: "draft-stock", ticker: "CRWD", name: "CrowdStrike Holdings", market: "미국", countryCode: "US",
      exchangeCode: "US", exchangeMic: "XNAS", exchangeName: "NASDAQ", isin: "US22788C1053", currency: "USD",
      providerRefs: [{ provider: "eodhd", symbol: "CRWD.US", exchangeCode: "US" }], quotePreference: "auto",
      status: "관찰", investmentType: "관찰 전용", marketSector: null, sector: "", tags: [], quantity: 0,
      averagePrice: 0, targetPrice: null, thesisSummary: "", currentView: "판단 보류", ledgerInitializedAt: now,
      currentPrice: 430.25, priceSource: "eodhd", priceFreshness: "eod", priceQuotedAt: "2026-08-17",
      priceUpdatedAt: now, createdAt: now, updatedAt: now, deletedAt: null,
    }));
  });

  it("uses ordinary manual zero-price metadata when previous close is absent", () => {
    expect(createStockFromInstrumentSearchResult(result({ previousClose: null, previousCloseDate: null }), { id: "draft", now })).toMatchObject({
      currentPrice: 0, priceSource: "manual", priceFreshness: "manual", priceStatus: "manual", priceQuotedAt: now, priceUpdatedAt: now,
    });
  });

  it("blocks unsupported currencies and incomplete provider identity", () => {
    expect(() => createStockFromInstrumentSearchResult(result({ currency: "CHF" }), { id: "draft", now })).toThrow("UNSUPPORTED_INSTRUMENT_CURRENCY");
    expect(() => createStockFromInstrumentSearchResult(result({ providerSymbol: "" }), { id: "draft", now })).toThrow("INVALID_INSTRUMENT_IDENTITY");
  });
});
