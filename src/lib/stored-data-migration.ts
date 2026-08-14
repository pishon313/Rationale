import { fallbackRatesToKrw } from "@/domain/currency";

export function migrateStoredCollection(collection: string, value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  if (collection === "exchange-rates") return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const record = item as Record<string, unknown>;
    if (!record.ratesToKrw || typeof record.ratesToKrw !== "object" || Array.isArray(record.ratesToKrw)) return item;
    return { ...record, ratesToKrw: { ...fallbackRatesToKrw, ...(record.ratesToKrw as Record<string, unknown>) } };
  });
  if (collection === "stocks") return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const stock = item as Record<string, unknown>;
    if (stock.providerRefs !== undefined) return stock;
    const legacy = stock.twelveData && typeof stock.twelveData === "object" && !Array.isArray(stock.twelveData) ? stock.twelveData as Record<string, unknown> : null;
    const countryCode = stock.market === "한국" ? "KR" : stock.market === "미국" ? "US" : null;
    return {
      ...stock,
      countryCode,
      providerRefs: legacy && typeof legacy.symbol === "string" ? [{ provider: "twelve-data", symbol: legacy.symbol, exchangeCode: typeof legacy.exchange === "string" ? legacy.exchange : null }] : [],
      quotePreference: legacy ? "twelve-data" : "manual",
      ...(legacy && typeof legacy.country === "string" ? { countryCode: legacy.country.toUpperCase() } : {}),
    };
  });
  return value;
}
