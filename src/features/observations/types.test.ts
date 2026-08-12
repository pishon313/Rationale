import { describe, expect, it } from "vitest";
import { filterObservations, normalizeObservation, stockObservationsFor, type Observation } from "./types";

const base: Observation = { id: "stock", stockId: "s1", stockName: "Stock", observedAt: "2026-08-10T10:00", title: "Stock", content: "", marketCondition: "", stockView: "중립", tags: [], attachmentUrls: [], createdAt: "2026-08-10T10:00:00Z", updatedAt: "2026-08-10T10:00:00Z", deletedAt: null };
const market: Observation = { ...base, id: "market", scope: "market", stockId: null, stockName: "", marketTargets: ["nasdaq", "sp500"], observedAt: "2026-08-11T10:00", title: "Market" };

describe("observations domain", () => {
  it("normalizes legacy observations as stock observations", () => expect(normalizeObservation(base)).toMatchObject({ scope: "stock", marketTargets: [] }));
  it("keeps valid market observations without a stock relationship", () => expect(normalizeObservation(market)).toMatchObject({ scope: "market", stockId: null, stockName: "", marketTargets: ["nasdaq", "sp500"] }));
  it("filters a mixed chronological timeline", () => {
    expect(filterObservations([base, market], "all").map((item) => item.id)).toEqual(["market", "stock"]);
    expect(filterObservations([base, market], "market").map((item) => item.id)).toEqual(["market"]);
    expect(filterObservations([base, market], "stock").map((item) => item.id)).toEqual(["stock"]);
    expect(filterObservations([base, market], "market", "nasdaq").map((item) => item.id)).toEqual(["market"]);
    expect(filterObservations([base, market], "market", "kospi")).toEqual([]);
    expect(filterObservations([base, market], "stock", "all", "s1").map((item) => item.id)).toEqual(["stock"]);
  });
  it("only returns matching stock observations for stock detail", () => expect(stockObservationsFor([base, market, { ...base, id: "other", stockId: "s2" }], "s1").map((item) => item.id)).toEqual(["stock"]));
});
