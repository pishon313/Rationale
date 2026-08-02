import { describe, expect, it } from "vitest";
import type { Review } from "@/features/reviews/types";
import type { Trade } from "@/features/trades/types";
import type { TradingLedger } from "./trading-ledger";
import { buildPeriodicReport, listReportPeriods, periodKey } from "./periodic-report";

const trades = [{ id: "b", tradedAt: "2026-08-03T10:00", tradeType: "매수", planId: "p", stockName: "A", ruleViolations: [] }, { id: "s", tradedAt: "2026-08-05T10:00", tradeType: "매도", planId: "p", stockName: "A", ruleViolations: [{ ruleId: "r" }] }] as Trade[];
const reviews = [{ reviewedAt: "2026-08-06", mistakeTags: ["추격매수"], lessons: "기다린다.", deletedAt: null }] as Review[];
const ledger = { calculations: { s: { realizedProfitKrw: 500, error: null } }, cycles: [{ closedAt: "2026-08-05", realizedProfitKrw: 500 }] } as unknown as TradingLedger;

describe("periodic report", () => {
  it("월간 핵심 수치와 회고 태그를 모은다", () => { const report = buildPeriodicReport("month", "2026-08", trades, reviews, ledger); expect(report).toMatchObject({ tradeCount: 2, realizedProfitKrw: 500, winRate: 100, plannedTradeRate: 100, violationCount: 1, reviewCount: 1, bestStock: "A" }); expect(report.mistakeTags[0]).toEqual({ tag: "추격매수", count: 1 }); });
  it("월요일 기준 주간 키와 선택 목록을 만든다", () => { expect(periodKey("week", "2026-08-06")).toBe("2026-08-03"); expect(listReportPeriods("week", trades, reviews)).toEqual(["2026-08-03"]); });
});
