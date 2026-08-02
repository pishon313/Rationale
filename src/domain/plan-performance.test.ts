import { describe, expect, it } from "vitest";
import { buildPlanPerformance, calculatePlanRisk } from "./plan-performance";
import type { BuyPlan } from "@/features/plans/types";
import type { Trade } from "@/features/trades/types";
import type { TradingLedger } from "./trading-ledger";

const plan = { id: "p1", targetPrice: 100, stopLossPrice: 90, takeProfitPrice: 120, plannedQuantity: 10, plannedAmount: 1000 } as BuyPlan;

describe("plan performance", () => {
  it("계획 리스크와 손익비를 계산한다", () => expect(calculatePlanRisk(plan)).toEqual({ riskPerShare: 10, rewardPerShare: 20, plannedRiskAmount: 100, rewardRiskRatio: 2 }));
  it("실제 체결 편차와 R-Multiple을 계산한다", () => {
    const trades = [
      { id: "b", planId: "p1", tradeType: "매수", quantity: 10, price: 102 } as Trade,
      { id: "s", planId: "p1", tradeType: "매도", quantity: 5, price: 115 } as Trade,
    ];
    const ledger = { calculations: { s: { realizedProfit: 65 } } } as unknown as TradingLedger;
    const result = buildPlanPerformance(plan, trades, ledger);
    expect(result.priceDeviationPercent).toBe(2);
    expect(result.amountDeviationPercent).toBe(2);
    expect(result.rMultiple).toBe(1.3);
  });
});
