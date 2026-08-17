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

  it("계좌 수수료 계산 스냅샷 문자열은 행동 분석에 들어가지 않는다", () => {
    const baseline = buildAnalytics(sampleTrades, sampleReviews);
    const withFeeEvidence = sampleTrades.map((trade, index) => index ? trade : {
      ...trade,
      feeMode: "accountPolicy" as const,
      feeCalculation: {
        version: 1 as const, policyAccountId: "account-emotion-fomo", ruleId: "rule-plan-untrusted", ruleName: "FOMO",
        market: "all" as const, currency: trade.currency, side: "buy" as const, ratePercent: "0", fixedFee: "1200",
        minimumFee: null, maximumFee: null, grossAmountFrom: null, grossAmountTo: null, effectiveFrom: "2020-01-01", effectiveTo: null,
        roundingMode: "floor" as const, roundingUnit: "1", tradedAtDate: trade.tradedAt.slice(0, 10), quantity: "120", price: "64100",
        grossAmount: "7692000", calculatedFee: "1200", calculatedAt: "2026-08-17T00:00:00Z",
      },
    });
    expect(buildAnalytics(withFeeEvidence, sampleReviews)).toEqual(baseline);
  });
});
