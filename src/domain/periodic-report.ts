import type { Review } from "@/features/reviews/types";
import type { Trade } from "@/features/trades/types";
import type { TradingLedger } from "./trading-ledger";

export type ReportPeriod = "week" | "month";
export type PeriodicReport = { label: string; tradeCount: number; realizedProfitKrw: number; closedCount: number; winRate: number; plannedTradeRate: number; violationCount: number; reviewCount: number; bestStock: string | null; bestStockProfitKrw: number; mistakeTags: Array<{ tag: string; count: number }>; lessons: string[] };

export function listReportPeriods(period: ReportPeriod, trades: Trade[], reviews: Review[]) {
  const dates = [...trades.filter((item) => !item.deletedAt).map((item) => item.tradedAt), ...reviews.filter((item) => !item.deletedAt).map((item) => item.reviewedAt)];
  return [...new Set(dates.map((date) => periodKey(period, date)))].sort().reverse();
}

export function buildPeriodicReport(period: ReportPeriod, key: string, trades: Trade[], reviews: Review[], ledger: TradingLedger): PeriodicReport {
  const [start, end] = periodRange(period, key);
  const inRange = (value: string | null) => Boolean(value && value.slice(0, 10) >= start && value.slice(0, 10) <= end);
  const periodTrades = trades.filter((trade) => !trade.deletedAt && (trade.tradeType === "매수" || trade.tradeType === "매도") && inRange(trade.tradedAt));
  const sells = periodTrades.filter((trade) => trade.tradeType === "매도" && !ledger.calculations[trade.id]?.error);
  const closed = ledger.cycles.filter((cycle) => inRange(cycle.closedAt));
  const periodReviews = reviews.filter((review) => !review.deletedAt && inRange(review.reviewedAt));
  const stockProfit = new Map<string, number>();
  for (const trade of sells) stockProfit.set(trade.stockName, (stockProfit.get(trade.stockName) ?? 0) + (ledger.calculations[trade.id]?.realizedProfitKrw ?? 0));
  const best = [...stockProfit].sort((a, b) => b[1] - a[1])[0];
  const mistakeCounts = new Map<string, number>();
  for (const review of periodReviews) for (const tag of review.mistakeTags ?? []) mistakeCounts.set(tag, (mistakeCounts.get(tag) ?? 0) + 1);
  const wins = closed.filter((cycle) => cycle.realizedProfitKrw > 0).length;
  return {
    label: period === "month" ? `${key.replace("-", "년 ")}월` : `${start.replaceAll("-", ".")}–${end.replaceAll("-", ".")}`,
    tradeCount: periodTrades.length,
    realizedProfitKrw: sells.reduce((sum, trade) => sum + (ledger.calculations[trade.id]?.realizedProfitKrw ?? 0), 0),
    closedCount: closed.length,
    winRate: closed.length ? wins / closed.length * 100 : 0,
    plannedTradeRate: periodTrades.length ? periodTrades.filter((trade) => trade.planId).length / periodTrades.length * 100 : 0,
    violationCount: periodTrades.reduce((sum, trade) => sum + (trade.ruleViolations?.length ?? 0), 0),
    reviewCount: periodReviews.length,
    bestStock: best?.[0] ?? null,
    bestStockProfitKrw: best?.[1] ?? 0,
    mistakeTags: [...mistakeCounts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    lessons: periodReviews.map((review) => review.lessons.trim()).filter(Boolean).slice(0, 5),
  };
}

export function periodKey(period: ReportPeriod, value: string) { if (period === "month") return value.slice(0, 7); const date = new Date(`${value.slice(0, 10)}T12:00:00Z`); const day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() - day + 1); return date.toISOString().slice(0, 10); }
function periodRange(period: ReportPeriod, key: string): [string, string] { if (period === "month") { const [year, month] = key.split("-").map(Number); return [`${key}-01`, new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)]; } const start = new Date(`${key}T12:00:00Z`); const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6); return [key, end.toISOString().slice(0, 10)]; }
