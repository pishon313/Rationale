import { describe, expect, it, vi } from "vitest";
import { fallbackRatesToKrw } from "@/domain/currency";
import { withComputed, type Stock } from "@/features/stocks/types";
import { buildAssetAllocationData } from "./dashboard-page-client";
import {
  allocationShareDisplayPolicy,
  assetGroupColorPaletteSize,
  buildAssetAllocationGroups,
  colorForAssetGroup,
  formatAllocationShare,
} from "./asset-allocation";

function stock(id: string, overrides: Partial<Stock> = {}): Stock {
  return {
    ticker: "AMD",
    name: "AMD",
    market: "미국",
    currency: "USD",
    assetType: "주식",
    marketSector: "information-technology",
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

const groupOptions = (mode: "portfolio-category" | "market-sector") => ({
  mode,
  unspecifiedLabel: mode === "portfolio-category" ? "내 분류 미지정" : "시장 섹터 미지정",
  marketSectorLabel: (id: NonNullable<Stock["marketSector"]>) => `localized:${id}`,
});

describe("buildAssetAllocationData", () => {
  it("두 분류 차원과 종목 identity를 운반하면서 기존 금액과 비중 계산을 유지한다", () => {
    const data = buildAssetAllocationData(
      [withComputed(stock("amd-primary")), withComputed(stock("amd-secondary", { name: "AMD", sector: "성장", marketSector: "financials" }))],
      200 * fallbackRatesToKrw.USD,
      fallbackRatesToKrw,
    );

    expect(data).toEqual([
      expect.objectContaining({ id: "amd-primary", name: "AMD", portfolioCategory: "반도체", marketSector: "information-technology", value: 100 * fallbackRatesToKrw.USD, share: 50 }),
      expect.objectContaining({ id: "amd-secondary", name: "AMD", portfolioCategory: "성장", marketSector: "financials", value: 100 * fallbackRatesToKrw.USD, share: 50 }),
    ]);
    expect(new Set(data.map((item) => item.id)).size).toBe(2);
  });

  it("전체 가치가 0이면 금액은 유지하고 비중을 안전하게 0으로 둔다", () => {
    const [item] = buildAssetAllocationData([withComputed(stock("zero"))], 0, fallbackRatesToKrw);
    expect(item.value).toBe(100 * fallbackRatesToKrw.USD);
    expect(item.share).toBe(0);
  });
});

describe("buildAssetAllocationGroups", () => {
  it("내 분류의 정규화 동등 값은 합치고 사용자 표시는 보존하며 미지정은 마지막에 둔다", () => {
    const holdings = [
      withComputed(stock("nvidia", { name: "엔비디아", sector: "  Ｅnergy\t Core ", currentPrice: 200 })),
      withComputed(stock("samsung", { name: "삼성전자", sector: "energy core", currentPrice: 100 })),
      withComputed(stock("distinct", { name: "구분되는 분류", sector: "Energy, Core", currentPrice: 150 })),
      withComputed(stock("missing", { name: "분류 없는 종목", sector: "   ", currentPrice: 400 })),
    ];
    const data = buildAssetAllocationData(holdings, 850 * fallbackRatesToKrw.USD, fallbackRatesToKrw);
    const groups = buildAssetAllocationGroups(data, groupOptions("portfolio-category"));

    expect(groups.map((group) => group.name)).toEqual(["Energy Core", "Energy, Core", "내 분류 미지정"]);
    expect(groups[0]).toMatchObject({ id: "portfolio-category:energy core", value: 300 * fallbackRatesToKrw.USD, isUnspecified: false });
    expect(groups[0].holdings.map((item) => item.name)).toEqual(["엔비디아", "삼성전자"]);
    expect(groups[2]).toMatchObject({ id: "portfolio-category:__unspecified__", value: 400 * fallbackRatesToKrw.USD, isUnspecified: true });
  });

  it("시장 섹터의 안정 ID로 묶고 지역화된 표시만 사용하며 미지정은 마지막에 둔다", () => {
    const data = buildAssetAllocationData([
      withComputed(stock("tech-a", { currentPrice: 200, marketSector: "information-technology", sector: "AI" })),
      withComputed(stock("tech-b", { currentPrice: 100, marketSector: "information-technology", sector: "반도체" })),
      withComputed(stock("energy", { currentPrice: 150, marketSector: "energy" })),
      withComputed(stock("missing", { currentPrice: 500, marketSector: null })),
    ], 950 * fallbackRatesToKrw.USD, fallbackRatesToKrw);
    const groups = buildAssetAllocationGroups(data, groupOptions("market-sector"));

    expect(groups.map((group) => group.name)).toEqual(["localized:information-technology", "localized:energy", "시장 섹터 미지정"]);
    expect(groups.map((group) => group.id)).toEqual(["market-sector:information-technology", "market-sector:energy", "market-sector:__unspecified__"]);
    expect(groups[0].holdings.map((item) => item.id)).toEqual(["tech-a", "tech-b"]);
    expect(groups[2].isUnspecified).toBe(true);
    expect(data[0].marketSector).toBe("information-technology");
  });

  it("두 보기 모두 그룹 합계가 종목 배분 합계와 같다", () => {
    const data = buildAssetAllocationData([
      withComputed(stock("a", { currentPrice: 123, sector: "A", marketSector: "energy" })),
      withComputed(stock("b", { currentPrice: 77, sector: "B", marketSector: "energy" })),
    ], 200 * fallbackRatesToKrw.USD, fallbackRatesToKrw);
    for (const mode of ["portfolio-category", "market-sector"] as const) {
      const groups = buildAssetAllocationGroups(data, groupOptions(mode));
      expect(groups.reduce((sum, group) => sum + group.value, 0)).toBe(data.reduce((sum, item) => sum + item.value, 0));
      expect(groups.reduce((sum, group) => sum + group.share, 0)).toBeCloseTo(data.reduce((sum, item) => sum + item.share, 0), 10);
    }
  });
});

describe("stable asset-group colors", () => {
  it("그룹 순서가 바뀌거나 시장 섹터 표시 언어가 바뀌어도 같은 ID 색상을 유지한다", () => {
    const id = "market-sector:information-technology";
    const before = [id, "market-sector:energy"].map((groupId) => [groupId, colorForAssetGroup(groupId)]);
    const after = ["market-sector:energy", id].map((groupId) => [groupId, colorForAssetGroup(groupId)]);
    expect(Object.fromEntries(after)[id]).toBe(Object.fromEntries(before)[id]);
    expect(colorForAssetGroup(id)).toBe(colorForAssetGroup(id));
    expect(colorForAssetGroup(id)).toMatch(/^#[0-9a-f]{6}$/i);
    expect(assetGroupColorPaletteSize()).toBeGreaterThanOrEqual(12);
    const item = [{ id: "a", name: "A", value: 1, share: 100, portfolioCategory: "A", marketSector: "information-technology" as const }];
    const [english] = buildAssetAllocationGroups(item, { ...groupOptions("market-sector"), marketSectorLabel: () => "Information Technology" });
    const [korean] = buildAssetAllocationGroups(item, { ...groupOptions("market-sector"), marketSectorLabel: () => "정보기술" });
    expect(english.id).toBe(korean.id);
    expect(colorForAssetGroup(english.id)).toBe(colorForAssetGroup(korean.id));
  });

  it("정규화 동등 내 분류가 같은 ID와 색상을 얻는다", () => {
    const data = [
      { id: "a", name: "A", value: 60, share: 60, portfolioCategory: "  Ｅnergy  ", marketSector: null },
      { id: "b", name: "B", value: 40, share: 40, portfolioCategory: "energy", marketSector: null },
    ];
    const [group] = buildAssetAllocationGroups(data, groupOptions("portfolio-category"));
    expect(group.id).toBe("portfolio-category:energy");
    expect(colorForAssetGroup(group.id)).toBe(colorForAssetGroup("portfolio-category:energy"));
  });
});

describe("allocation percentage policy", () => {
  it.each([
    [0, 0, false, 1],
    [0.001, 0.001, true, 1],
    [0.1, 0.001, false, 2],
    [0.987, 0.00987, false, 2],
    [12.34, 0.1234, false, 1],
  ] as const)("share %s에 맞는 지역화 매개변수를 반환한다", (share, value, lessThan, maximumFractionDigits) => {
    expect(allocationShareDisplayPolicy(share)).toMatchObject({ value, lessThan, options: { style: "percent", maximumFractionDigits } });
  });

  it("작은 양수는 지역화된 0.1% 앞에 less-than 기호를 붙이고 0.0%로 표시하지 않는다", () => {
    const formatter = vi.fn((value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat("fr-FR", options).format(value));
    const result = formatAllocationShare(0.01, formatter);
    expect(result).toBe("<0,1 %");
    expect(result).not.toContain("0,0");
    expect(formatter).toHaveBeenCalledWith(0.001, expect.objectContaining({ style: "percent", minimumFractionDigits: 1 }));
  });
});
