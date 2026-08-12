import type { Review } from "@/features/reviews/types";
import { isJournalRecorded, type Trade } from "@/features/trades/types";

export type AnalyticsSummary = {
  tradeCount: number;
  recordedTradeCount: number;
  unreviewedTradeCount: number;
  plannedTradeCount: number;
  plannedTradeRate: number;
  averageRuleScore: number;
  averageProcessScore: number;
  monthlyTrades: Array<{ month: string; count: number }>;
  emotions: Array<{ emotion: string; count: number; averageRuleScore: number }>;
};

export function buildAnalytics(trades: Trade[], reviews: Review[]): AnalyticsSummary {
  const activeTrades = trades.filter((trade) => !trade.deletedAt && (trade.tradeType === "매수" || trade.tradeType === "매도"));
  const recordedTrades = activeTrades.filter(isJournalRecorded);
  const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const plannedTradeCount = recordedTrades.filter((trade) => trade.planId).length;
  const monthly = new Map<string, number>();
  const emotionGroups = new Map<string, Trade[]>();

  for (const trade of activeTrades) {
    const month = trade.tradedAt.slice(0, 7);
    monthly.set(month, (monthly.get(month) ?? 0) + 1);
    if (isJournalRecorded(trade)) {
      const group = emotionGroups.get(trade.emotion) ?? [];
      group.push(trade);
      emotionGroups.set(trade.emotion, group);
    }
  }

  return {
    tradeCount: activeTrades.length,
    recordedTradeCount: recordedTrades.length,
    unreviewedTradeCount: activeTrades.length - recordedTrades.length,
    plannedTradeCount,
    plannedTradeRate: recordedTrades.length ? plannedTradeCount / recordedTrades.length * 100 : 0,
    averageRuleScore: average(recordedTrades.map((trade) => trade.ruleComplianceScore)),
    averageProcessScore: average(reviews.map((review) => review.processScore)),
    monthlyTrades: [...monthly].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count })),
    emotions: [...emotionGroups].map(([emotion, values]) => ({ emotion, count: values.length, averageRuleScore: average(values.map((value) => value.ruleComplianceScore)) })).sort((a, b) => b.count - a.count),
  };
}
