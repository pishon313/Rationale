import { describe, expect, it } from "vitest";
import { sampleReviews } from "@/features/reviews/sample-data";
import { sampleTrades } from "@/features/trades/sample-data";
import { buildAnalytics } from "./analytics";

describe("buildAnalytics", () => {
  it("계획 준수율과 평균 점수를 계산한다", () => {
    const result = buildAnalytics(sampleTrades, sampleReviews);
    expect(result.tradeCount).toBe(2);
    expect(result.plannedTradeCount).toBe(1);
    expect(result.plannedTradeRate).toBe(50);
    expect(result.averageRuleScore).toBe(4.5);
    expect(result.averageProcessScore).toBe(4);
    expect(result.monthlyTrades).toEqual([{ month: "2026-07", count: 2 }]);
  });

  it("빈 기록을 안전하게 처리한다", () => {
    expect(buildAnalytics([], [])).toMatchObject({ tradeCount: 0, plannedTradeCount: 0, plannedTradeRate: 0 });
  });

  it("미검토 가져오기 거래는 실행 수에 포함하되 행동 분석에서 제외한다", () => {
    const imported = { ...sampleTrades[0], id: "imported", journalStatus: "unreviewed" as const, planId: "untrusted", emotion: "FOMO", ruleComplianceScore: 1 };
    const result = buildAnalytics([...sampleTrades, imported], sampleReviews);
    expect(result.tradeCount).toBe(3);
    expect(result.plannedTradeCount).toBe(1);
    expect(result.plannedTradeRate).toBe(50);
    expect(result.emotions.find((item) => item.emotion === "FOMO")).toBeUndefined();
    expect(result.averageRuleScore).toBe(4.5);
  });
});
