import { describe, expect, it } from "vitest";
import { migrateStoredCollection } from "./stored-data-migration";
describe("stored data migration", () => {
  it("fills missing CAD/HKD rates without replacing metadata", () => { const old = [{ id: "latest", ratesToKrw: { KRW: 1, USD: 1400, JPY: 9, EUR: 1600 }, source: "frankfurter", rateDate: "2026-01-01", fetchedAt: "2026-01-01", updatedAt: "2026-01-01" }]; const next = migrateStoredCollection("exchange-rates", old) as typeof old; expect(next[0]).toMatchObject({ source: "frankfurter", ratesToKrw: { USD: 1400, CAD: 1000, HKD: 177 } }); });
  it("keeps legacy 기타 stocks unlinked", () => { const [stock] = migrateStoredCollection("stocks", [{ id: "s", market: "기타" }]) as Array<Record<string, unknown>>; expect(stock).toMatchObject({ countryCode: null, providerRefs: [], quotePreference: "manual" }); });
});
