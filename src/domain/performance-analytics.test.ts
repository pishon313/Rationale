import { describe, expect, it } from "vitest";
import type { BuyPlan } from "@/features/plans/types";
import type { Trade } from "@/features/trades/types";
import type { TradingLedger } from "./trading-ledger";
import { buildPerformanceAnalytics } from "./performance-analytics";

const trade = (id: string, tradeType: "매수" | "매도", tradedAt: string, planId: string | null, emotion = "평온") => ({ id, tradeType, tradedAt, planId, stockId: id.startsWith("a") ? "a" : "b", stockName: id.startsWith("a") ? "A" : "B", emotion, deletedAt: null } as Trade);
const trades = [trade("ab", "매수", "2026-01-01", "p1"), trade("as", "매도", "2026-01-02", "p1"), trade("bb", "매수", "2026-01-03", null, "FOMO"), trade("bs", "매도", "2026-01-04", null, "FOMO")];
const ledger = {
  cycles: [
    { stockName: "A", closedAt: "2026-01-02", tradeIds: ["ab", "as"], realizedProfitKrw: 200 },
    { stockName: "B", closedAt: "2026-01-04", tradeIds: ["bb", "bs"], realizedProfitKrw: -100 },
  ],
  calculations: { as: { realizedProfitKrw: 200, error: null }, bs: { realizedProfitKrw: -100, error: null } },
} as unknown as TradingLedger;

describe("buildPerformanceAnalytics", () => {
  it("완결된 포지션의 핵심 성과 지표를 계산한다", () => {
    const result = buildPerformanceAnalytics(trades, [{ id: "p1", scenarioType: "눌림목", deletedAt: null } as BuyPlan], ledger);
    expect(result.closedCycleCount).toBe(2);
    expect(result.winRate).toBe(50);
    expect(result.payoffRatio).toBe(2);
    expect(result.profitFactor).toBe(2);
    expect(result.maxDrawdownKrw).toBe(100);
  });

  it("종목·전략·감정 및 일별 성과를 묶는다", () => {
    const result = buildPerformanceAnalytics(trades, [{ id: "p1", scenarioType: "눌림목", deletedAt: null } as BuyPlan], ledger);
    expect(result.byStrategy.map((item) => item.label)).toEqual(["눌림목", "비계획"]);
    expect(result.byEmotion.find((item) => item.label === "FOMO")?.profitKrw).toBe(-100);
    expect(result.calendar).toHaveLength(2);
    expect(result.equityCurve.at(-1)?.cumulativeProfitKrw).toBe(100);
  });
});
