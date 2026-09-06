import { describe, expect, it, vi } from "vitest";
import { buildSampleDataset, knownSampleIds, sampleCollectionNames, validateSampleDataset } from "./sample-dataset";
import { deriveSampleDatasetState, installSampleDataset, removeSampleDataset, SampleDependencyError, type SampleCollections } from "./sample-dataset-service";
import { validateBackupPayload } from "@/features/settings/backup";
import type { PortfolioAllocationTarget } from "@/features/portfolio-plan/types";

const now = "2026-08-10T12:00:00.000Z";
const empty = (): SampleCollections => ({ accounts: [], stocks: [], trades: [], plans: [], observations: [], reviews: [], rules: [], notes: [], portfolioAllocationTargets: [] });

describe("Sample Dataset v1", () => {
  it("builds deterministic, valid, relative sample records", () => {
    const first = buildSampleDataset(now); const second = buildSampleDataset(now);
    expect(first).toEqual(second);
    const all = sampleCollectionNames.flatMap((name) => first[name].map((item) => item.id));
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((id) => id.startsWith("sample:v1:"))).toBe(true);
    expect(first.stocks.find((item) => item.ticker === "NVDA")?.nextEarningsDate).toBe("2026-08-24");
    expect(first.reviews[0].reviewedAt).toBe("2026-08-03");
    const ledger = validateSampleDataset(first);
    expect(ledger.errors).toEqual([]);
    expect(ledger.positions.find((item) => item.stockId.endsWith(":samsung"))?.quantity).toBe(45);
    expect(ledger.positions.find((item) => item.stockId.endsWith(":nvda"))?.quantity).toBeCloseTo(0.4);
    expect(first.trades.some((item) => item.stockId?.endsWith(":voo") && item.tradeType === "배당")).toBe(true);
    expect(new Set(ledger.positions.map((item) => item.accountId)).size).toBe(2);
  });

  it("remains a manifest-free Backup V5 dataset", () => {
    const sample = buildSampleDataset(now);
    const restored = validateBackupPayload({ version: 5, exportedAt: now, ...sample, language: "ko", dashboardNotes: [], earningsEvents: [], displayCurrency: "KRW" });
    expect(restored.version).toBe(5);
    expect(deriveSampleDatasetState(sample, buildSampleDataset(now))).toBe("installed");
  });

  it("merges once, preserves user and modified sample records, and repairs partial state", async () => {
    const userAccount = { ...buildSampleDataset(now).accounts[0], id: "user:account", name: "내 계좌" };
    let stored = { ...empty(), accounts: [userAccount] };
    const save = vi.fn(async (writes) => { stored = Object.fromEntries(writes.map((write: { collection: string; values: unknown[] }) => [write.collection, write.values])) as SampleCollections; });
    const deps = { load: async () => stored, save };
    await installSampleDataset(now, deps);
    expect(save).toHaveBeenCalledTimes(1); expect(stored.accounts[0]).toEqual(userAccount); expect(deriveSampleDatasetState(stored, buildSampleDataset(now))).toBe("installed");
    const sample = buildSampleDataset(now); const modified = { ...stored.notes.find((item) => item.id === sample.notes[0].id)!, content: "수정함" };
    stored = { ...stored, notes: [modified], rules: stored.rules.slice(1) };
    expect(deriveSampleDatasetState(stored, sample)).toBe("partial");
    await installSampleDataset(now, deps);
    expect(stored.notes.find((item) => item.id === modified.id)?.content).toBe("수정함");
    expect(deriveSampleDatasetState(stored, sample)).toBe("installed");
    await installSampleDataset(now, deps); expect(save).toHaveBeenCalledTimes(2);
  });

  it("removes exact IDs atomically while preserving user records", async () => {
    const sample = buildSampleDataset(now); const userNote = { ...sample.notes[0], id: "user:note" };
    let stored: SampleCollections = { ...sample, notes: [...sample.notes, userNote], portfolioAllocationTargets: [] };
    const save = vi.fn(async (writes) => { stored = Object.fromEntries(writes.map((write: { collection: string; values: unknown[] }) => [write.collection, write.values])) as SampleCollections; });
    await removeSampleDataset(now, { load: async () => stored, save });
    expect(save).toHaveBeenCalledTimes(1); expect(stored.notes).toEqual([userNote]);
    expect(sampleCollectionNames.every((name) => stored[name].every((item) => !knownSampleIds(sample)[name].has(item.id)))).toBe(true);
  });

  it("blocks removal when user records reference sample entities", async () => {
    const sample = buildSampleDataset(now);
    const stored: SampleCollections = { ...sample, trades: [...sample.trades, { ...sample.trades[1], id: "user:trade" }], portfolioAllocationTargets: [] };
    const save = vi.fn();
    await expect(removeSampleDataset(now, { load: async () => stored, save })).rejects.toBeInstanceOf(SampleDependencyError);
    expect(save).not.toHaveBeenCalled();
  });

  it("blocks removal when an immutable Portfolio Plan target references a sample Stock", async () => {
    const sample = buildSampleDataset(now);
    const target: PortfolioAllocationTarget = { id: "user:portfolio-target", revisionId: "user:portfolio-revision", groupId: "user:portfolio-group", accountId: sample.accounts[0].id, targetType: "stock", stockId: sample.stocks[0].id, weightWithinGroupBps: 10000, sortOrder: 0, updatedAt: now };
    const stored: SampleCollections = { ...sample, portfolioAllocationTargets: [target] };
    const save = vi.fn();

    await expect(removeSampleDataset(now, { load: async () => stored, save })).rejects.toMatchObject({
      summary: { portfolioAllocationTargets: 1 },
    });
    expect(save).not.toHaveBeenCalled();
  });
});
