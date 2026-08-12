import type { BuyPlan } from "@/features/plans/types";
import { isJournalRecorded, type Trade } from "@/features/trades/types";
import { buildTradingLedger, type TradingLedger } from "./trading-ledger";

export type PerformanceGroup = { label: string; count: number; wins: number; winRate: number; profitKrw: number };
export type EquityPoint = { date: string; cumulativeProfitKrw: number; drawdownKrw: number };
export type CalendarReturn = { date: string; profitKrw: number; tradeCount: number };
export type PerformanceAnalytics = {
  closedCycleCount: number;
  winRate: number;
  averageProfitKrw: number;
  averageLossKrw: number;
  payoffRatio: number | null;
  profitFactor: number | null;
  maxDrawdownKrw: number;
  equityCurve: EquityPoint[];
  byStock: PerformanceGroup[];
  byStrategy: PerformanceGroup[];
  byEmotion: PerformanceGroup[];
  calendar: CalendarReturn[];
};

type Result = { profitKrw: number; stock: string; strategy: string; emotion: string };

export function buildPerformanceAnalytics(trades: Trade[], plans: BuyPlan[], inputLedger?: TradingLedger): PerformanceAnalytics {
  const active = trades.filter((trade) => !trade.deletedAt);
  const tradeById = new Map(active.map((trade) => [trade.id, trade]));
  const planById = new Map(plans.filter((plan) => !plan.deletedAt).map((plan) => [plan.id, plan]));
  const ledger = inputLedger ?? buildTradingLedger(active);
  const results: Result[] = ledger.cycles.filter((cycle) => cycle.closedAt).map((cycle) => {
    const cycleTrades = cycle.tradeIds.map((id) => tradeById.get(id)).filter((trade): trade is Trade => Boolean(trade));
    const entry = cycleTrades.find((trade) => trade.tradeType === "매수");
    const plan = entry?.planId ? planById.get(entry.planId) : undefined;
    return { profitKrw: cycle.realizedProfitKrw, stock: cycle.stockName, strategy: entry && isJournalRecorded(entry) ? plan?.scenarioType ?? "비계획" : "미기록", emotion: entry && isJournalRecorded(entry) ? entry.emotion || "미기록" : "미기록" };
  });
  const wins = results.filter((item) => item.profitKrw > 0);
  const losses = results.filter((item) => item.profitKrw < 0);
  const grossProfit = sum(wins.map((item) => item.profitKrw));
  const grossLoss = Math.abs(sum(losses.map((item) => item.profitKrw)));
  const averageProfitKrw = average(wins.map((item) => item.profitKrw));
  const averageLossKrw = average(losses.map((item) => item.profitKrw));
  const equityCurve = buildEquityCurve(active, ledger);
  return {
    closedCycleCount: results.length,
    winRate: results.length ? wins.length / results.length * 100 : 0,
    averageProfitKrw,
    averageLossKrw,
    payoffRatio: averageProfitKrw > 0 && averageLossKrw < 0 ? averageProfitKrw / Math.abs(averageLossKrw) : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    maxDrawdownKrw: Math.abs(Math.min(0, ...equityCurve.map((item) => item.drawdownKrw))),
    equityCurve,
    byStock: groupResults(results, (item) => item.stock),
    byStrategy: groupResults(results, (item) => item.strategy),
    byEmotion: groupResults(results, (item) => item.emotion),
    calendar: buildCalendar(active, ledger),
  };
}

function buildEquityCurve(trades: Trade[], ledger: TradingLedger) {
  const realized = trades.filter((trade) => trade.tradeType === "매도" && ledger.calculations[trade.id] && !ledger.calculations[trade.id].error).sort(compareTrades);
  let cumulative = 0;
  let peak = 0;
  return realized.map((trade) => {
    cumulative += ledger.calculations[trade.id]?.realizedProfitKrw ?? 0;
    peak = Math.max(peak, cumulative);
    return { date: trade.tradedAt.slice(0, 10), cumulativeProfitKrw: cumulative, drawdownKrw: cumulative - peak };
  });
}

function buildCalendar(trades: Trade[], ledger: TradingLedger) {
  const days = new Map<string, CalendarReturn>();
  for (const trade of trades.filter((item) => item.tradeType === "매도")) {
    const calculation = ledger.calculations[trade.id];
    if (!calculation || calculation.error) continue;
    const date = trade.tradedAt.slice(0, 10);
    const current = days.get(date) ?? { date, profitKrw: 0, tradeCount: 0 };
    current.profitKrw += calculation.realizedProfitKrw;
    current.tradeCount += 1;
    days.set(date, current);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function groupResults(results: Result[], select: (result: Result) => string): PerformanceGroup[] {
  const groups = new Map<string, Result[]>();
  for (const result of results) groups.set(select(result), [...(groups.get(select(result)) ?? []), result]);
  return [...groups].map(([label, items]) => {
    const wins = items.filter((item) => item.profitKrw > 0).length;
    return { label, count: items.length, wins, winRate: items.length ? wins / items.length * 100 : 0, profitKrw: sum(items.map((item) => item.profitKrw)) };
  }).sort((a, b) => b.profitKrw - a.profitKrw);
}

function average(values: number[]) { return values.length ? sum(values) / values.length : 0; }
function sum(values: number[]) { return values.reduce((total, value) => total + value, 0); }
function compareTrades(a: Trade, b: Trade) { return Date.parse(a.tradedAt) - Date.parse(b.tradedAt) || a.id.localeCompare(b.id); }
