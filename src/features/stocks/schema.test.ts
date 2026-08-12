import { describe, expect, it } from "vitest";
import { stockFormSchema } from "./schema";

const valid = { ticker: " tsla ", name: "Tesla", market: "미국", currency: "USD", twelveDataSymbol: "", twelveDataCountry: "", twelveDataExchange: "", assetType: "주식", sector: "자동차", status: "관찰", investmentType: "중기 투자", currentPrice: "312.5", targetPrice: "350", averagePrice: "0", quantity: "0", thesisSummary: "관찰", currentView: "중립", currentViewMemo: "", nextReviewDate: "", reviewNote: "판매량 확인", nextEarningsDate: "2026-10-21", tagsText: "미국, 자동차" };

describe("stockFormSchema", () => {
  it("입력값을 정규화하고 숫자로 변환한다", () => {
    const parsed = stockFormSchema.parse(valid);
    expect(parsed.ticker).toBe("TSLA");
    expect(parsed.currentPrice).toBe(312.5);
    expect(parsed.nextReviewDate).toBe("");
    expect(parsed.reviewNote).toBe("판매량 확인");
    expect(parsed.nextEarningsDate).toBe("2026-10-21");
  });
  it("음수 가격을 거부한다", () => {
    expect(stockFormSchema.safeParse({ ...valid, currentPrice: "-1" }).success).toBe(false);
  });
  it("기타 시장은 명시적인 Twelve Data identity를 요구한다", () => {
    expect(stockFormSchema.safeParse({ ...valid, market: "기타", currency: "CAD" }).success).toBe(false);
    expect(stockFormSchema.safeParse({ ...valid, ticker: "SHLD", market: "기타", currency: "CAD", twelveDataSymbol: "SHLD", twelveDataCountry: "CA", twelveDataExchange: "TSX" }).success).toBe(true);
  });
});
