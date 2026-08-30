import { describe, expect, it } from "vitest";
import type { InvestmentAccount } from "@/features/accounts/types";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { PortfolioAllocationGroup, PortfolioAllocationTarget, PortfolioPlanRevision, PortfolioPlanState } from "./types";
import { validateContributionAmount, validateNewPortfolioTargetReferences, validatePortfolioPlanCollections } from "./validation";

const now = "2026-08-30T00:00:00.000Z";
const accounts: InvestmentAccount[] = [account("a"), account("b")];
const revisions: PortfolioPlanRevision[] = [{ id: "r1", revisionNumber: 1, basedOnRevisionId: null, thesis: "", changeNote: "", createdAt: now, activatedAt: now, updatedAt: now }];
const states: PortfolioPlanState[] = [{ id: "default", activeRevisionId: "r1", contributionAmountMinor: 1_000_000, contributionCurrency: "KRW", updatedAt: now }];
const groups: PortfolioAllocationGroup[] = [
  { id: "g1", revisionId: "r1", name: "Stocks", targetWeightBps: 6000, sortOrder: 0, updatedAt: now },
  { id: "g2", revisionId: "r1", name: "Savings", targetWeightBps: 4000, sortOrder: 1, updatedAt: now },
];
const targets: PortfolioAllocationTarget[] = [
  { id: "t1", revisionId: "r1", groupId: "g1", accountId: "a", targetType: "stock", stockId: sampleStocks[0].id, weightWithinGroupBps: 5000, sortOrder: 0, updatedAt: now },
  { id: "t2", revisionId: "r1", groupId: "g1", accountId: "a", targetType: "stock", stockId: sampleStocks[1].id, weightWithinGroupBps: 5000, sortOrder: 1, updatedAt: now },
  { id: "t3", revisionId: "r1", groupId: "g2", accountId: "b", targetType: "cash", stockId: null, weightWithinGroupBps: 10000, sortOrder: 0, updatedAt: now },
];

describe("Portfolio plan validation", () => {
  const valid = () => ({ states, revisions, groups, targets, stocks: sampleStocks, accounts });

  it("accepts exact 10,000-bps Group and per-Group Target totals", () => {
    expect(() => validatePortfolioPlanCollections(valid())).not.toThrow();
  });

  it("rejects invalid Group and per-Group totals", () => {
    expect(() => validatePortfolioPlanCollections({ ...valid(), groups: [{ ...groups[0], targetWeightBps: 5999 }, groups[1]] })).toThrow("Group Target Weight");
    expect(() => validatePortfolioPlanCollections({ ...valid(), targets: [{ ...targets[0], weightWithinGroupBps: 4999 }, ...targets.slice(1)] })).toThrow("Group 내부");
  });

  it("rejects normalized duplicate Group names, duplicate Stocks, and duplicate Cash Accounts", () => {
    expect(() => validatePortfolioPlanCollections({ ...valid(), groups: [groups[0], { ...groups[1], name: " stocks " }] })).toThrow("같은 Allocation Group 이름");
    expect(() => validatePortfolioPlanCollections({ ...valid(), targets: [targets[0], { ...(targets[1] as Extract<PortfolioAllocationTarget, { targetType: "stock" }>), stockId: sampleStocks[0].id }, targets[2]] })).toThrow("같은 종목");
    const cashTargets: PortfolioAllocationTarget[] = [
      { ...targets[0], targetType: "cash", stockId: null, accountId: "a" } as PortfolioAllocationTarget,
      { ...targets[1], targetType: "cash", stockId: null, accountId: "a" } as PortfolioAllocationTarget,
      targets[2],
    ];
    expect(() => validatePortfolioPlanCollections({ ...valid(), targets: cashTargets })).toThrow("Cash Target");
  });

  it("rejects missing Revision, Group, Account, and Stock references", () => {
    expect(() => validatePortfolioPlanCollections({ ...valid(), targets: [{ ...targets[0], revisionId: "missing" }, ...targets.slice(1)] })).toThrow("리비전이 존재하지 않습니다");
    expect(() => validatePortfolioPlanCollections({ ...valid(), targets: [{ ...targets[0], groupId: "missing" }, ...targets.slice(1)] })).toThrow("Allocation Group이 존재하지 않습니다");
    expect(() => validatePortfolioPlanCollections({ ...valid(), targets: [{ ...targets[0], accountId: "missing" }, ...targets.slice(1)] })).toThrow("계좌가 존재하지 않습니다");
    expect(() => validatePortfolioPlanCollections({ ...valid(), targets: [{ ...(targets[0] as Extract<PortfolioAllocationTarget, { targetType: "stock" }>), stockId: "missing" }, ...targets.slice(1)] })).toThrow("종목이 존재하지 않습니다");
  });

  it("preserves historical archived/deleted references but rejects them for new plans", () => {
    const archived = [{ ...accounts[0], archivedAt: now }, accounts[1]];
    const deleted = [{ ...sampleStocks[0], deletedAt: now }, ...sampleStocks.slice(1)];
    expect(() => validatePortfolioPlanCollections({ ...valid(), accounts: archived, stocks: deleted })).not.toThrow();
    expect(() => validateNewPortfolioTargetReferences(targets, sampleStocks, archived)).toThrow("보관된 계좌");
    expect(() => validateNewPortfolioTargetReferences(targets, deleted, accounts)).toThrow("삭제된 종목");
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])("rejects invalid Contribution Amount %s", (value) => {
    expect(() => validateContributionAmount(value)).toThrow("minor-unit 정수");
  });

  it("rejects an unsupported Contribution Currency", () => {
    expect(() => validatePortfolioPlanCollections({ ...valid(), states: [{ ...states[0], contributionCurrency: "BTC" as "KRW" }] })).toThrow("Contribution Currency");
  });
});

function account(id: string): InvestmentAccount {
  return { id, name: id.toUpperCase(), institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: id === "a", archivedAt: null, memo: "", createdAt: now, updatedAt: now };
}
