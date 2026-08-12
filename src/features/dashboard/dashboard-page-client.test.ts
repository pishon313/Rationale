import { describe, expect, it } from "vitest";
import { fallbackRatesToKrw } from "@/domain/currency";
import { withComputed, type Stock } from "@/features/stocks/types";
import { buildAssetAllocationData } from "./dashboard-page-client";

function stock(id: string): Stock {
  return {
    id,
    ticker: "AMD",
    name: "AMD",
    market: "미국",
    currency: "USD",
    assetType: "주식",
    sector: "반도체",
    status: "보유",
    investmentType: "장기 코어",
    currentPrice: 100,
    targetPrice: null,
    averagePrice: 80,
    quantity: 1,
    thesisSummary: "",
    currentView: "중립",
    currentViewMemo: "",
    nextReviewDate: null,
    tags: [],
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    deletedAt: null,
  };
}

describe("buildAssetAllocationData", () => {
  it("표시 이름이 같은 종목도 고유한 종목 ID를 차트 identity로 유지한다", () => {
    const data = buildAssetAllocationData(
      [withComputed(stock("amd-primary")), withComputed(stock("amd-secondary"))],
      200 * fallbackRatesToKrw.USD,
      fallbackRatesToKrw,
    );

    expect(data.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "amd-primary", name: "AMD" },
      { id: "amd-secondary", name: "AMD" },
    ]);
    expect(new Set(data.map((item) => item.id)).size).toBe(2);
  });
});
