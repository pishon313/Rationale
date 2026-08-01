import { describe, expect, it } from "vitest";
import { sampleRules } from "@/features/rules/sample-data";
import { evaluateTradeRules } from "./rules";
describe("evaluateTradeRules", () => {
  it("계획되지 않은 매수를 경고한다", () => expect(evaluateTradeRules(sampleRules, { amount: 1000, planId: null }).some((w) => w.title.includes("계획되지 않은"))).toBe(true));
  it("비활성 원칙은 검사하지 않는다", () => expect(evaluateTradeRules(sampleRules.map((r) => ({ ...r, isActive: false })), { amount: 1000, planId: null })).toHaveLength(0));
});
