import type { BuyPlan } from "@/features/plans/types";
import { isJournalRecorded, type Trade } from "@/features/trades/types";
import type { TradingLedger } from "./trading-ledger";

export type PlanRisk = {
  riskPerShare: number | null;
  rewardPerShare: number | null;
  plannedRiskAmount: number | null;
  rewardRiskRatio: number | null;
};

export type PlanPerformance = PlanRisk & {
  plan: BuyPlan;
  buyQuantity: number;
  averageBuyPrice: number | null;
  buyAmount: number;
  priceDeviationPercent: number | null;
  quantityDeviationPercent: number | null;
  amountDeviationPercent: number | null;
  soldQuantity: number;
  realizedProfit: number;
  rMultiple: number | null;
};

export function calculatePlanRisk(plan: BuyPlan): PlanRisk {
  const entry = positive(plan.targetPrice);
  const stop = positive(plan.stopLossPrice);
  const target = positive(plan.takeProfitPrice);
  const quantity = positive(plan.plannedQuantity);
  const riskPerShare = entry !== null && stop !== null && entry > stop ? entry - stop : null;
  const rewardPerShare = entry !== null && target !== null && target > entry ? target - entry : null;
  return {
    riskPerShare,
    rewardPerShare,
    plannedRiskAmount: riskPerShare !== null && quantity !== null ? riskPerShare * quantity : null,
    rewardRiskRatio: riskPerShare !== null && rewardPerShare !== null ? rewardPerShare / riskPerShare : null,
  };
}

export function buildPlanPerformance(plan: BuyPlan, allTrades: Trade[], ledger: TradingLedger): PlanPerformance {
  const trades = allTrades.filter((trade) => !trade.deletedAt && isJournalRecorded(trade) && trade.planId === plan.id);
  const buys = trades.filter((trade) => trade.tradeType === "매수");
  const sells = trades.filter((trade) => trade.tradeType === "매도");
  const buyQuantity = sum(buys, (trade) => trade.quantity);
  const buyAmount = sum(buys, (trade) => trade.quantity * trade.price);
  const averageBuyPrice = buyQuantity > 0 ? buyAmount / buyQuantity : null;
  const soldQuantity = sum(sells, (trade) => trade.quantity);
  const realizedProfit = sum(sells, (trade) => ledger.calculations[trade.id]?.realizedProfit ?? 0);
  const risk = calculatePlanRisk(plan);
  const realizedRisk = risk.riskPerShare !== null && soldQuantity > 0 ? risk.riskPerShare * soldQuantity : null;
  return {
    ...risk,
    plan,
    buyQuantity,
    averageBuyPrice,
    buyAmount,
    priceDeviationPercent: deviation(plan.targetPrice, averageBuyPrice),
    quantityDeviationPercent: deviation(plan.plannedQuantity, buyQuantity || null),
    amountDeviationPercent: deviation(plan.plannedAmount, buyAmount || null),
    soldQuantity,
    realizedProfit,
    rMultiple: realizedRisk && realizedRisk > 0 ? realizedProfit / realizedRisk : null,
  };
}

function positive(value: number | null | undefined) { return typeof value === "number" && value > 0 ? value : null; }
function deviation(planned: number | null | undefined, actual: number | null) { return planned && actual !== null ? (actual - planned) / planned * 100 : null; }
function sum<T>(items: T[], select: (item: T) => number) { return items.reduce((total, item) => total + select(item), 0); }
