import { describe, expect, it } from "vitest";
import { fallbackRatesToKrw } from "@/domain/currency";
import { withComputed, type Stock } from "@/features/stocks/types";
import { buildAssetAllocationData, buildAssetAllocationGroups } from "./dashboard-page-client";

function stock(id: string, overrides: Partial<Stock> = {}): Stock {
  return {
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
    ...overrides,
    id,
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

  it("섹터별로 묶고 비중순으로 정렬하되 섹터 미지정 그룹은 마지막에 둔다", () => {
    const holdings = [
      withComputed(stock("nvidia", { name: "엔비디아", sector: " 반도체 ", currentPrice: 200 })),
      withComputed(stock("samsung", { name: "삼성전자", sector: "반도체", currentPrice: 100 })),
      withComputed(stock("tesla", { name: "테슬라", sector: "자동차", currentPrice: 150 })),
      withComputed(stock("missing", { name: "섹터 없는 종목", sector: "   ", currentPrice: 400 })),
    ];
    const data = buildAssetAllocationData(holdings, 850 * fallbackRatesToKrw.USD, fallbackRatesToKrw);

    const groups = buildAssetAllocationGroups(data, "섹터 미지정");

    expect(groups.map((group) => group.name)).toEqual(["반도체", "자동차", "섹터 미지정"]);
    expect(groups[0]).toMatchObject({ value: 300 * fallbackRatesToKrw.USD, isUnspecified: false });
    expect(groups[0].holdings.map((item) => item.name)).toEqual(["엔비디아", "삼성전자"]);
    expect(groups[2]).toMatchObject({ value: 400 * fallbackRatesToKrw.USD, isUnspecified: true });
  });

  it("영문 섹터의 대소문자와 공백 차이를 같은 그룹으로 정규화한다", () => {
    const data = buildAssetAllocationData([
      withComputed(stock("energy-a", { sector: "Energy", currentPrice: 100 })),
      withComputed(stock("energy-b", { sector: "  energy  ", currentPrice: 100 })),
    ], 200 * fallbackRatesToKrw.USD, fallbackRatesToKrw);

    expect(buildAssetAllocationGroups(data, "섹터 미지정")).toHaveLength(1);
  });
});
