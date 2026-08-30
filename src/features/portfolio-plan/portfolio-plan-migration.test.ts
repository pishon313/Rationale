import { describe, expect, it } from "vitest";
import type { InvestmentAccount } from "@/features/accounts/types";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { LegacyPortfolioAllocationTargetV6, LegacyPortfolioPlanRevisionV6, LegacyPortfolioPlanStateV6 } from "./types";
import { buildPortfolioPlanRepairActivation, legacyGroupId, migratePortfolioPlanV6, persistPortfolioPlanRepairActivation, persistPortfolioPlanV6Migration } from "./portfolio-plan-migration";
import { vi } from "vitest";

const now = "2026-08-18T00:00:00.000Z";
const account = (id: string): InvestmentAccount => ({ id, name: id, institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: id === "a", archivedAt: null, memo: "", createdAt: now, updatedAt: now });
const revisions: LegacyPortfolioPlanRevisionV6[] = [
  { id: "r1", revisionNumber: 1, basedOnRevisionId: null, targetAmountKrw: 1_000_000, thesis: "First", changeNote: "", createdAt: now, activatedAt: now, updatedAt: now },
  { id: "r2", revisionNumber: 2, basedOnRevisionId: "r1", targetAmountKrw: 1_200_000, thesis: "Second", changeNote: "", createdAt: now, activatedAt: now, updatedAt: now },
];
const states: LegacyPortfolioPlanStateV6[] = [{ id: "default", activeRevisionId: "r2", updatedAt: now }];
const targets: LegacyPortfolioAllocationTargetV6[] = revisions.map((revision, index) => ({ id: `t${index + 1}`, revisionId: revision.id, targetType: "stock", stockId: sampleStocks[0].id, targetWeightBps: 10000, sortOrder: 0, updatedAt: now }));

describe("Portfolio V6 migration", () => {
  it("creates one deterministic Legacy Allocation Group per historical revision", () => {
    const input = { states, revisions, targets, stocks: sampleStocks, accounts: [account("a")], trades: [] };
    const result = migratePortfolioPlanV6(input);
    expect(result.needsAccountSelection).toBe(false);
    expect(result.states[0]).toMatchObject({ activeRevisionId: "r2", contributionAmountMinor: 1_200_000, contributionCurrency: "KRW" });
    expect(result.revisions).toHaveLength(2);
    expect(result.revisions[0]).not.toHaveProperty("targetAmountKrw");
    expect(result.groups).toEqual(revisions.map((revision) => expect.objectContaining({ id: legacyGroupId(revision.id), revisionId: revision.id, name: "Legacy Allocation", targetWeightBps: 10000 })));
    expect(result.targets.map((target) => target.weightWithinGroupBps)).toEqual([10000, 10000]);
    expect(result.targets.every((target) => target.accountId === "a" && target.groupId === legacyGroupId(target.revisionId))).toBe(true);
    expect(migratePortfolioPlanV6(input)).toEqual(result);
  });

  it("preserves an ambiguous V6 plan as an inactive account-selection repair draft", () => {
    const cash: LegacyPortfolioAllocationTargetV6 = { id: "cash", revisionId: "r1", targetType: "cash", stockId: null, targetWeightBps: 10000, sortOrder: 0, updatedAt: now };
    const input = { states: [{ ...states[0], activeRevisionId: "r1" }], revisions: [revisions[0]], targets: [cash], stocks: sampleStocks, accounts: [account("a"), account("b")], trades: [] };
    const result = migratePortfolioPlanV6(input);
    expect(result).toMatchObject({ needsAccountSelection: true, revisions: [], groups: [], targets: [] });
    expect(result.states[0]).toMatchObject({ activeRevisionId: null, contributionAmountMinor: 1_000_000, repairDraft: { status: "needsAccountSelection", unresolvedTargetIds: ["cash"], legacyTargets: [cash] } });
  });

  it("persists deterministic mappings inside a partially ambiguous repair draft", () => {
    const mixed: LegacyPortfolioAllocationTargetV6[] = [
      { id: "stock", revisionId: "r1", targetType: "stock", stockId: sampleStocks[0].id, targetWeightBps: 5000, sortOrder: 0, updatedAt: now },
      { id: "cash", revisionId: "r1", targetType: "cash", stockId: null, targetWeightBps: 5000, sortOrder: 1, updatedAt: now },
    ];
    const trades = [{ id: "trade", stockId: sampleStocks[0].id, accountId: "a", deletedAt: null }] as never[];
    const result = migratePortfolioPlanV6({ states: [{ ...states[0], activeRevisionId: "r1" }], revisions: [revisions[0]], targets: mixed, stocks: sampleStocks, accounts: [account("a"), account("b")], trades });
    expect(result.states[0]?.repairDraft).toMatchObject({ unresolvedTargetIds: ["cash"], inferredAccountIdsByTargetId: { stock: "a" } });
  });

  it("repairs every preserved historical revision and clears the draft only in the atomic candidate", async () => {
    const cashTargets: LegacyPortfolioAllocationTargetV6[] = revisions.map((revision, index) => ({ id: `cash-${index}`, revisionId: revision.id, targetType: "cash", stockId: null, targetWeightBps: 10000, sortOrder: 0, updatedAt: now }));
    const migration = migratePortfolioPlanV6({ states, revisions, targets: cashTargets, stocks: sampleStocks, accounts: [account("a"), account("b")], trades: [] });
    const repairState = migration.states[0]!;
    const activation = buildPortfolioPlanRepairActivation({ state: repairState, accountIdsByTargetId: { "cash-0": "a", "cash-1": "b" }, stocks: sampleStocks, accounts: [account("a"), account("b")], contributionAmountMinor: 1_200_000, contributionCurrency: "KRW", now });
    expect(activation.revisions).toHaveLength(2);
    expect(activation.groups).toHaveLength(2);
    expect(activation.targets.map((target) => target.accountId)).toEqual(["a", "b"]);
    expect(activation.states[0]).toMatchObject({ activeRevisionId: "r2", repairDraft: null });
    expect(repairState.repairDraft).not.toBeNull();

    const save = vi.fn().mockRejectedValue(new Error("disk full"));
    await expect(persistPortfolioPlanRepairActivation(activation, save)).rejects.toThrow("disk full");
    expect(repairState.repairDraft).not.toBeNull();
  });

  it("persists a migration as one four-collection atomic write", async () => {
    const migration = migratePortfolioPlanV6({ states, revisions, targets, stocks: sampleStocks, accounts: [account("a")], trades: [] });
    const save = vi.fn().mockResolvedValue(undefined);
    await persistPortfolioPlanV6Migration(migration, save);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].map((write: { collection: string }) => write.collection)).toEqual(["portfolio-plan-state", "portfolio-plan-revisions", "portfolio-allocation-groups", "portfolio-allocation-targets"]);
    expect(save).toHaveBeenCalledWith(expect.any(Array), { failurePolicy: "caller-managed" });
  });
});
