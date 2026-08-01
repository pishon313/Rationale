import { describe, expect, it } from "vitest";
import { sampleObservations } from "@/features/observations/sample-data";
import { samplePlans } from "@/features/plans/sample-data";
import { sampleReviews } from "@/features/reviews/sample-data";
import { sampleRules } from "@/features/rules/sample-data";
import { sampleStocks } from "@/features/stocks/sample-data";
import { sampleTrades } from "@/features/trades/sample-data";
import { validateBackupPayload } from "./backup";

const valid = {
  version: 1,
  exportedAt: "2026-08-01T00:00:00.000Z",
  stocks: sampleStocks,
  plans: samplePlans,
  trades: sampleTrades,
};

describe("validateBackupPayload", () => {
  it("accepts a valid legacy backup", () => {
    expect(validateBackupPayload(valid).version).toBe(1);
  });

  it("accepts a complete version 3 backup", () => {
    const backup = { ...valid, version: 3, observations: sampleObservations, reviews: sampleReviews, rules: sampleRules };
    expect(validateBackupPayload(backup).version).toBe(3);
  });

  it("rejects duplicate record IDs before restore", () => {
    expect(() => validateBackupPayload({ ...valid, trades: [sampleTrades[0], sampleTrades[0]] })).toThrow("중복 ID");
  });

  it("rejects a stock record that only has an ID", () => {
    expect(() => validateBackupPayload({ ...valid, stocks: [{ id: "broken-stock" }] })).toThrow("종목 1번째 항목");
  });

  it("rejects a plan with a non-numeric amount", () => {
    expect(() => validateBackupPayload({ ...valid, plans: [{ ...samplePlans[0], plannedAmount: "many" }] })).toThrow("plannedAmount");
  });

  it("rejects an unsupported trade type", () => {
    expect(() => validateBackupPayload({ ...valid, trades: [{ ...sampleTrades[0], tradeType: "환전" }] })).toThrow("거래 유형");
  });

  it("requires all extended collections for version 3", () => {
    expect(() => validateBackupPayload({ ...valid, version: 3 })).toThrow("관찰 기록 목록");
  });

  it("rejects an initialized holding without any security history", () => {
    const stock = { ...sampleStocks[0], id: "orphan", ledgerInitializedAt: "2026-08-01", quantity: 3 };
    expect(() => validateBackupPayload({ ...valid, stocks: [stock], trades: [] })).toThrow("매매 기록이 없습니다");
  });
});
