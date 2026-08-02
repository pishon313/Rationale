import { describe, expect, it } from "vitest";
import { sampleReviews } from "@/features/reviews/sample-data";
import { sampleTrades } from "@/features/trades/sample-data";
import { buildAnalytics } from "./analytics";

describe("buildAnalytics", () => {
  it("계획 준수율과 평균 점수를 계산한다", () => {
    const result = buildAnalytics(sampleTrades, sampleReviews);
    expect(result.tradeCount).toBe(2);
    expect(result.plannedTradeRate).toBe(50);
    expect(result.averageRuleScore).toBe(4.5);
    expect(result.averageProcessScore).toBe(4);
    expect(result.monthlyTrades).toEqual([{ month: "2026-07", count: 2 }]);
  });

  it("빈 기록을 안전하게 처리한다", () => {
    expect(buildAnalytics([], []).plannedTradeRate).toBe(0);
  });
});
