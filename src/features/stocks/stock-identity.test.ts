import { describe, expect, it } from "vitest";
import { sampleStocks } from "./sample-data";
import type { InstrumentSearchResult } from "./market-data";
import { resolveInstrumentStockIdentity } from "./stock-identity";
import type { Stock } from "./types";

const remote = (overrides: Partial<InstrumentSearchResult> = {}): InstrumentSearchResult => ({
  provider: "eodhd", providerSymbol: "CRWD.US", ticker: "CRWD", name: "CrowdStrike Holdings", countryCode: "US", countryName: "USA",
  exchangeCode: "US", exchangeMic: "XNAS", exchangeName: "NASDAQ", currency: "USD", assetType: "Common Stock",
  isin: "US22788C1053", previousClose: null, previousCloseDate: null, isPrimary: true, ...overrides,
});
const stock = (overrides: Partial<Stock> = {}): Stock => ({
  ...sampleStocks[0], id: "crwd", ticker: "CRWD", name: "CrowdStrike Holdings", market: "미국", currency: "USD",
  countryCode: "US", exchangeCode: "US", isin: "US22788C1053",
  providerRefs: [{ provider: "eodhd", symbol: "CRWD.US", exchangeCode: "US" }], deletedAt: null, ...overrides,
});

describe("resolveInstrumentStockIdentity", () => {
  it("resolves active provider and ISIN matches", () => {
    expect(resolveInstrumentStockIdentity(remote({ isin: null }), [stock({ isin: null })])).toMatchObject({ status: "active", stock: { id: "crwd" } });
    expect(resolveInstrumentStockIdentity(remote({ providerSymbol: "OTHER.US" }), [stock({ providerRefs: [] })])).toMatchObject({ status: "active", stock: { id: "crwd" } });
  });

  it("returns deleted, ambiguous, and new outcomes without choosing the first match", () => {
    expect(resolveInstrumentStockIdentity(remote(), [stock({ deletedAt: "2026-08-01T00:00:00Z" })])).toMatchObject({ status: "deleted", stock: { id: "crwd" } });
    const duplicate = stock({ id: "crwd-2", providerRefs: [], isin: "US22788C1053" });
    expect(resolveInstrumentStockIdentity(remote(), [stock(), duplicate])).toMatchObject({ status: "ambiguous", stocks: [{ id: "crwd" }, { id: "crwd-2" }] });
    expect(resolveInstrumentStockIdentity(remote(), [])).toEqual({ status: "new" });
  });

  it("does not treat matching names or tickers from a different listing as identity", () => {
    const otherListing = stock({ id: "other", countryCode: "CA", exchangeCode: "TO", currency: "CAD", isin: "CA0000000001", providerRefs: [{ provider: "eodhd", symbol: "CRWD.TO", exchangeCode: "TO" }] });
    expect(resolveInstrumentStockIdentity(remote(), [otherListing])).toEqual({ status: "new" });
  });
});
