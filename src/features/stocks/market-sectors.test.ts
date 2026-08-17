import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/types";
import { translate } from "@/i18n/messages";
import { isMarketSectorId, marketSectorLabel, marketSectorMessageKeys, marketSectors } from "./market-sectors";

describe("market sector contract", () => {
  it("keeps the fixed IDs stable and rejects unknown values", () => {
    expect(marketSectors).toEqual([
      "energy", "materials", "industrials", "consumer-discretionary", "consumer-staples", "health-care",
      "financials", "information-technology", "communication-services", "utilities", "real-estate",
    ]);
    for (const id of marketSectors) expect(isMarketSectorId(id)).toBe(true);
    expect(isMarketSectorId("technology")).toBe(false);
  });

  it("provides a localized display label without changing the persisted ID", () => {
    for (const locale of locales) {
      for (const id of marketSectors) {
        const label = marketSectorLabel(id, (key) => translate(locale, key));
        expect(label).toBeTruthy();
        if (locale !== "ko") expect(label).not.toBe(marketSectorMessageKeys[id]);
        expect(id).toBe(marketSectors[marketSectors.indexOf(id)]);
      }
    }
  });
});
