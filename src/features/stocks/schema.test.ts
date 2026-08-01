import { describe, expect, it } from "vitest";
import { stockFormSchema } from "./schema";

const valid = { ticker: " tsla ", name: "Tesla", market: "미국", currency: "USD", assetType: "주식", sector: "자동차", status: "관찰", investmentType: "중기 투자", currentPrice: "312.5", targetPrice: "350", averagePrice: "0", quantity: "0", thesisSummary: "관찰", currentView: "중립", currentViewMemo: "", nextReviewDate: "", nextEarningsDate: "2026-10-21", tagsText: "미국, 자동차" };

describe("stockFormSchema", () => {
  it("입력값을 정규화하고 숫자로 변환한다", () => {
    const parsed = stockFormSchema.parse(valid);
    expect(parsed.ticker).toBe("TSLA");
    expect(parsed.currentPrice).toBe(312.5);
    expect(parsed.nextReviewDate).toBe("");
    expect(parsed.nextEarningsDate).toBe("2026-10-21");
  });
  it("음수 가격을 거부한다", () => {
    expect(stockFormSchema.safeParse({ ...valid, currentPrice: "-1" }).success).toBe(false);
  });
});
