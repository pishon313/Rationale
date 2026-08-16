import { describe, expect, it } from "vitest";
import { validateStoredCollection } from "./collection-validation";
import { sampleStocks } from "@/features/stocks/sample-data";

describe("import mapping profile storage validation", () => {
  const profile = { id: "p1", name: "Broker", version: 1, bindings: { tradedAt: { normalizedHeader: "date", occurrence: 0 } }, headerSignature: "date#0", createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z" };

  it("accepts versioned stable references without raw row data", () => {
    expect(validateStoredCollection("import-mapping-profiles", [profile])).toEqual({ valid: true });
  });

  it("rejects unknown fields and index-based bindings", () => {
    expect(validateStoredCollection("import-mapping-profiles", [{ ...profile, bindings: { unknown: { normalizedHeader: "x", occurrence: 1 } } }])).toMatchObject({ valid: false });
    expect(validateStoredCollection("import-mapping-profiles", [{ ...profile, bindings: { tradedAt: 0 } }])).toMatchObject({ valid: false });
    expect(validateStoredCollection("import-mapping-profiles", [{ ...profile, fileName: "broker.csv", rows: [["private"]] }])).toMatchObject({ valid: false });
  });
});

describe("stock storage validation", () => {
  const eodhdStock = {
    ...sampleStocks[0],
    countryCode: "US",
    exchangeCode: "US",
    providerRefs: [{ provider: "eodhd", symbol: "SHOP.US", exchangeCode: "US" }],
    quotePreference: "auto",
    priceSource: "eodhd",
    priceFreshness: "eod",
    priceStatus: "online",
  };

  it("accepts an EODHD-linked Stock without rewriting its metadata", () => {
    expect(validateStoredCollection("stocks", [eodhdStock])).toEqual({ valid: true });
  });

  it("rejects invalid provider metadata", () => {
    expect(validateStoredCollection("stocks", [{ ...eodhdStock, providerRefs: [{ provider: "manual", symbol: "SHOP.US" }] }])).toMatchObject({ valid: false, index: 0 });
  });
});
