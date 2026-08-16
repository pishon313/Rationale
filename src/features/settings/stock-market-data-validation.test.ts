import { describe, expect, it } from "vitest";
import { sampleStocks } from "@/features/stocks/sample-data";
import { marketDataProviders, priceStatuses, quoteFreshnessValues, quotePreferences, remoteMarketDataProviders } from "@/features/stocks/types";
import { validateBackupCollectionRecord } from "./backup";

const stock = { ...sampleStocks[0], countryCode: "US", providerRefs: [], quotePreference: "manual" };

describe("Stock market-data validation contract", () => {
  it.each(marketDataProviders)("accepts %s as a price source", (priceSource) => {
    expect(() => validateBackupCollectionRecord("stocks", { ...stock, priceSource }, 0)).not.toThrow();
  });

  it.each(remoteMarketDataProviders)("accepts %s as a provider reference", (provider) => {
    expect(() => validateBackupCollectionRecord("stocks", { ...stock, providerRefs: [{ provider, symbol: "SHOP.US" }], quotePreference: "auto" }, 0)).not.toThrow();
  });

  it("rejects manual and unknown provider references", () => {
    for (const provider of ["manual", "future-provider"]) {
      expect(() => validateBackupCollectionRecord("stocks", { ...stock, providerRefs: [{ provider, symbol: "SHOP.US" }] }, 0)).toThrow("provider 연결");
    }
  });

  it.each(quotePreferences)("accepts %s as a quote preference", (quotePreference) => {
    expect(() => validateBackupCollectionRecord("stocks", { ...stock, quotePreference }, 0)).not.toThrow();
  });

  it.each(quoteFreshnessValues)("accepts %s as quote freshness", (priceFreshness) => {
    expect(() => validateBackupCollectionRecord("stocks", { ...stock, priceFreshness }, 0)).not.toThrow();
  });

  it.each(priceStatuses)("accepts %s as a price status", (priceStatus) => {
    expect(() => validateBackupCollectionRecord("stocks", { ...stock, priceStatus }, 0)).not.toThrow();
  });

  it("fails closed for unknown market-data values", () => {
    for (const invalid of [
      { priceSource: "future-provider" },
      { quotePreference: "future-provider" },
      { priceFreshness: "stale" },
      { priceStatus: "cached" },
    ]) expect(() => validateBackupCollectionRecord("stocks", { ...stock, ...invalid }, 0)).toThrow();
  });
});
