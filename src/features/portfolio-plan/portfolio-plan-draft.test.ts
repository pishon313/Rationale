import { describe, expect, it } from "vitest";
import type { InvestmentAccount } from "@/features/accounts/types";
import { sampleStocks } from "@/features/stocks/sample-data";
import {
  classifyPortfolioPlanChanges,
  emptyPortfolioPlanDraft,
  formatEffectiveAllocation,
  formatMinorAmountInput,
  parseMajorAmountToMinor,
  parsePercentageToBps,
  portfolioPlanDraftFromActive,
  validatePortfolioPlanEditorDraft,
  withPortfolioStockTargetInputs,
  withPortfolioStockTargetWeights,
  type PortfolioPlanEditorDraft,
} from "./portfolio-plan-draft";

const now = "2026-08-30T00:00:00.000Z";
const accounts: InvestmentAccount[] = ["a", "b"].map((id, index) => ({ id, name: id.toUpperCase(), institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: index === 0, archivedAt: null, memo: "", createdAt: now, updatedAt: now }));

describe("Portfolio Plan draft amount and percentage parsing", () => {
  it("converts major currency strings to safe integer minor units without floats", () => {
    expect(parseMajorAmountToMinor("1000000", "KRW")).toBe(1_000_000);
    expect(parseMajorAmountToMinor("1000.25", "USD")).toBe(100_025);
    expect(parseMajorAmountToMinor("0", "USD")).toBe(0);
    expect(formatMinorAmountInput(100_025, "USD")).toBe("1000.25");
    expect(formatMinorAmountInput(1_000_000, "KRW")).toBe("1000000");
  });

  it("rejects excess precision, exponent notation, negatives, and unsafe values", () => {
    expect(parseMajorAmountToMinor("1.1", "KRW")).toBeNull();
    expect(parseMajorAmountToMinor("1.001", "USD")).toBeNull();
    expect(parseMajorAmountToMinor("1e3", "USD")).toBeNull();
    expect(parseMajorAmountToMinor("-1", "KRW")).toBeNull();
    expect(parseMajorAmountToMinor("9007199254740992", "KRW")).toBeNull();
  });

  it("parses percentages to basis points with no more than two decimals", () => {
    expect(parsePercentageToBps("33.33")).toBe(3333);
    expect(parsePercentageToBps("0")).toBe(0);
    expect(parsePercentageToBps("100")).toBe(10000);
    expect(parsePercentageToBps("33.333")).toBeNull();
    expect(parsePercentageToBps("100.01")).toBeNull();
    expect(formatEffectiveAllocation(6000, 3333)).toBe("19.998%");
  });
});

describe("Portfolio Plan draft validation and semantic changes", () => {
  it("starts with fixed Savings, Stocks, and Bonds categories", () => {
    const draft = emptyPortfolioPlanDraft("KRW");
    expect(draft.groups.map((group) => [group.category, group.name, group.weightInput])).toEqual([
      ["savings", "적금", "30"],
      ["stocks", "주식 투자", "60"],
      ["bonds", "채권", "10"],
    ]);
  });

  it("maps a legacy free-form stock Group into the fixed categories without dropping its target", () => {
    const revision = { id: "r1", revisionNumber: 1, basedOnRevisionId: null, thesis: "", changeNote: "", createdAt: now, activatedAt: now, updatedAt: now };
    const draft = portfolioPlanDraftFromActive({
      state: { id: "default", activeRevisionId: "r1", contributionAmountMinor: 1_000_000, contributionCurrency: "KRW", updatedAt: now },
      revision,
      groups: [{ id: "core", revisionId: "r1", name: "Core", targetWeightBps: 10000, sortOrder: 0, updatedAt: now }],
      targets: [{ id: "target", revisionId: "r1", groupId: "core", accountId: "a", targetType: "stock", stockId: sampleStocks[0]!.id, weightWithinGroupBps: 10000, sortOrder: 0, updatedAt: now }],
      fallbackCurrency: "KRW",
    });
    expect(draft.groups.map((group) => [group.category, group.weightInput, group.targets.length])).toEqual([
      ["savings", "0", 0],
      ["stocks", "100", 1],
      ["bonds", "0", 0],
    ]);
  });

  it("accepts zero contribution and valid nested 100% totals", () => {
    const result = validatePortfolioPlanEditorDraft(validDraft(), sampleStocks, accounts);
    expect(result.valid).toBe(true);
    expect(result.parsed).toMatchObject({ contributionAmountMinor: 0, groups: [{ targetWeightBps: 0 }, { targetWeightBps: 10000 }, { targetWeightBps: 0 }], targets: [{ accountId: "a", weightWithinGroupBps: 10000 }] });
  });

  it("reports nested totals and duplicate stocks while allowing an unassigned account", () => {
    const draft = validDraft();
    draft.groups[1]!.weightInput = "90";
    draft.groups[1]!.targets[0]!.weightInput = "50";
    draft.groups[1]!.targets.push({ ...draft.groups[1]!.targets[0]!, id: "t2", accountId: "", weightInput: "50", sortOrder: 1 });
    const result = validatePortfolioPlanEditorDraft(draft, sampleStocks, accounts);
    expect(result.valid).toBe(false);
    expect(result.summary).toEqual(expect.arrayContaining([
      "Allocation Group 비중 합계는 정확히 100%여야 합니다.",
      "한 리비전에 같은 종목을 두 번 추가할 수 없습니다.",
    ]));
  });

  it("parses an omitted execution account as null", () => {
    const draft = validDraft();
    draft.groups[1]!.targets[0]!.accountId = "";
    const result = validatePortfolioPlanEditorDraft(draft, sampleStocks, []);
    expect(result.valid).toBe(true);
    expect(result.parsed?.targets[0]?.accountId).toBeNull();
  });

  it("classifies contribution-only edits without revision churn", () => {
    const saved = validDraft();
    const contribution = { ...saved, contributionAmountInput: "1000.25", contributionCurrency: "USD" as const };
    expect(classifyPortfolioPlanChanges({ draft: contribution, saved, hasActiveRevision: true })).toBe("contribution");
    expect(classifyPortfolioPlanChanges({ draft: { ...saved, thesis: "Changed" }, saved, hasActiveRevision: true })).toBe("revision");
    const renamed = saved.groups.map((group, index) => index === 1 ? { ...group, name: "  주식   투자  " } : group);
    expect(classifyPortfolioPlanChanges({ draft: { ...saved, groups: renamed }, saved, hasActiveRevision: true })).toBe("none");
  });

  it("applies optional Allocation stock targets only to the execution draft", () => {
    const saved = validDraft();
    const execution = withPortfolioStockTargetWeights(saved, [
      { stockId: sampleStocks[0]!.id, targetWeightBps: 7000 },
      { stockId: sampleStocks[1]!.id, targetWeightBps: 3000 },
    ]);
    expect(execution.groups[1]?.targets).toEqual([
      expect.objectContaining({ id: "t1", stockId: sampleStocks[0]!.id, accountId: "a", weightInput: "70" }),
      expect.objectContaining({ id: `allocation:stock:${sampleStocks[1]!.id}`, stockId: sampleStocks[1]!.id, accountId: "", weightInput: "30" }),
    ]);
    expect(saved.groups[1]?.targets).toHaveLength(1);
  });

  it("preserves invalid execution-only stock inputs for inline validation", () => {
    const execution = withPortfolioStockTargetInputs(validDraft(), [
      { stockId: sampleStocks[0]!.id, weightInput: "90" },
      { stockId: sampleStocks[1]!.id, weightInput: "20" },
    ]);
    expect(execution.groups[1]?.targets.map((target) => target.weightInput)).toEqual(["90", "20"]);
    expect(validatePortfolioPlanEditorDraft(execution, sampleStocks, accounts).summary).toContain("Group 내부 Target 비중 합계는 정확히 100%여야 합니다.");
  });
});

function validDraft(): PortfolioPlanEditorDraft {
  return {
    contributionAmountInput: "0",
    contributionCurrency: "KRW",
    thesis: "Stay intentional",
    changeNote: "",
    groups: [
      { id: "savings", category: "savings", name: "적금", weightInput: "0", sortOrder: 0, targets: [] },
      { id: "stocks", category: "stocks", name: "주식 투자", weightInput: "100", sortOrder: 1, targets: [{ id: "t1", targetType: "stock", stockId: sampleStocks[0]!.id, accountId: "a", weightInput: "100", sortOrder: 0 }] },
      { id: "bonds", category: "bonds", name: "채권", weightInput: "0", sortOrder: 2, targets: [] },
    ],
  };
}
