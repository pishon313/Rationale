import { describe, expect, it } from "vitest";
import type { InvestmentAccount } from "@/features/accounts/types";
import { sampleStocks } from "@/features/stocks/sample-data";
import {
  classifyPortfolioPlanChanges,
  formatEffectiveAllocation,
  formatMinorAmountInput,
  parseMajorAmountToMinor,
  parsePercentageToBps,
  validatePortfolioPlanEditorDraft,
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
  it("accepts zero contribution and valid nested 100% totals", () => {
    const result = validatePortfolioPlanEditorDraft(validDraft(), sampleStocks, accounts);
    expect(result.valid).toBe(true);
    expect(result.parsed).toMatchObject({ contributionAmountMinor: 0, groups: [{ targetWeightBps: 10000 }], targets: [{ accountId: "a", weightWithinGroupBps: 10000 }] });
  });

  it("reports nested totals, duplicate stocks, missing accounts, and archived references", () => {
    const draft = validDraft();
    draft.groups[0]!.weightInput = "90";
    draft.groups[0]!.targets[0]!.weightInput = "50";
    draft.groups[0]!.targets.push({ ...draft.groups[0]!.targets[0]!, id: "t2", accountId: "", weightInput: "50", sortOrder: 1 });
    const result = validatePortfolioPlanEditorDraft(draft, sampleStocks, accounts);
    expect(result.valid).toBe(false);
    expect(result.summary).toEqual(expect.arrayContaining([
      "Allocation Group 비중 합계는 정확히 100%여야 합니다.",
      "활성 계좌를 선택해 주세요.",
      "한 리비전에 같은 종목을 두 번 추가할 수 없습니다.",
    ]));
  });

  it("classifies contribution-only edits without revision churn", () => {
    const saved = validDraft();
    const contribution = { ...saved, contributionAmountInput: "1000.25", contributionCurrency: "USD" as const };
    expect(classifyPortfolioPlanChanges({ draft: contribution, saved, hasActiveRevision: true })).toBe("contribution");
    expect(classifyPortfolioPlanChanges({ draft: { ...saved, thesis: "Changed" }, saved, hasActiveRevision: true })).toBe("revision");
    expect(classifyPortfolioPlanChanges({ draft: { ...saved, groups: [{ ...saved.groups[0]!, name: "  Core   " }] }, saved: { ...saved, groups: [{ ...saved.groups[0]!, name: "Core" }] }, hasActiveRevision: true })).toBe("none");
  });
});

function validDraft(): PortfolioPlanEditorDraft {
  return {
    contributionAmountInput: "0",
    contributionCurrency: "KRW",
    thesis: "Stay intentional",
    changeNote: "",
    groups: [{ id: "g1", name: "Core", weightInput: "100", sortOrder: 0, targets: [{ id: "t1", targetType: "stock", stockId: sampleStocks[0]!.id, accountId: "a", weightInput: "100", sortOrder: 0 }] }],
  };
}
