import { describe, expect, it } from "vitest";
import { stockFormSchema } from "./schema";

const valid = { ticker: " tsla ", name: "Tesla", market: "미국", currency: "USD", countryCode: "", exchangeCode: "", providerSymbol: "", provider: "manual", assetType: "주식", marketSector: "consumer-discretionary", sector: "자동차", status: "관찰", investmentType: "중기 투자", currentPrice: "312.5", targetPrice: "350", averagePrice: "0", quantity: "0", thesisSummary: "관찰", currentView: "중립", currentViewMemo: "", nextReviewDate: "", reviewNote: "판매량 확인", nextEarningsDate: "2026-10-21", tagsText: "미국, 자동차" };

describe("stockFormSchema", () => {
  it("입력값을 정규화하고 숫자로 변환한다", () => {
    const parsed = stockFormSchema.parse(valid);
    expect(parsed.ticker).toBe("TSLA");
    expect(parsed.currentPrice).toBe(312.5);
    expect(parsed.nextReviewDate).toBe("");
    expect(parsed.reviewNote).toBe("판매량 확인");
    expect(parsed.nextEarningsDate).toBe("2026-10-21");
    expect(parsed.marketSector).toBe("consumer-discretionary");
  });
  it("시장 섹터의 null과 빈 값을 허용하고 알 수 없는 ID는 거부한다", () => {
    const missing = { ...valid } as Partial<typeof valid>;
    delete missing.marketSector;
    expect(stockFormSchema.parse(missing).marketSector).toBeNull();
    expect(stockFormSchema.parse({ ...valid, marketSector: "" }).marketSector).toBeNull();
    expect(stockFormSchema.parse({ ...valid, marketSector: null }).marketSector).toBeNull();
    expect(stockFormSchema.safeParse({ ...valid, marketSector: "technology" }).success).toBe(false);
  });
  it("내 분류 표시를 정규화하되 문장부호는 보존한다", () => {
    expect(stockFormSchema.parse({ ...valid, sector: "  Ｅnergy\t Core, ETF  " }).sector).toBe("Energy Core, ETF");
    expect(stockFormSchema.safeParse({ ...valid, sector: "x".repeat(61) }).success).toBe(false);
  });
  it("음수 가격을 거부한다", () => {
    expect(stockFormSchema.safeParse({ ...valid, currentPrice: "-1" }).success).toBe(false);
  });
  it("연결된 종목은 provider identity를 요구한다", () => {
    expect(stockFormSchema.safeParse({ ...valid, provider: "eodhd" }).success).toBe(false);
    expect(stockFormSchema.safeParse({ ...valid, ticker: "SHLD", market: "캐나다", currency: "CAD", countryCode: "CA", exchangeCode: "TO", providerSymbol: "SHLD.TO", provider: "eodhd" }).success).toBe(true);
  });
});
