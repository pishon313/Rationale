import { describe, expect, it, vi } from "vitest";
import { sampleStocks } from "@/features/stocks/sample-data";
import { buildPortfolioPlanActivation, persistPortfolioPlanActivation } from "./portfolio-plan-mutation";
import type { PortfolioAllocationTarget, PortfolioPlanRevision, PortfolioPlanState } from "./types";

const now = "2026-08-18T01:00:00.000Z";
const first: PortfolioPlanRevision = { id: "r1", revisionNumber: 1, basedOnRevisionId: null, thesis: "First", changeNote: "", createdAt: now, activatedAt: now, updatedAt: now };
const firstTarget: PortfolioAllocationTarget = { id: "t1", revisionId: first.id, targetType: "stock", stockId: sampleStocks[0].id, targetWeightBps: 10000, sortOrder: 0, updatedAt: now };
const state: PortfolioPlanState = { id: "default", activeRevisionId: first.id, updatedAt: now };

describe("Portfolio Plan activation", () => {
  it("requires exactly 10000 basis points and rejects duplicate Stock or Cash targets", () => {
    const base = { states: [], revisions: [], targets: [], stocks: sampleStocks, thesis: "", changeNote: "", now, revisionId: "r1" };
    expect(() => buildPortfolioPlanActivation({ ...base, draftTargets: [{ targetType: "stock", stockId: sampleStocks[0].id, targetWeightBps: 9999, sortOrder: 0 }] })).toThrow("PORTFOLIO_TARGET_TOTAL_INVALID");
    expect(() => buildPortfolioPlanActivation({ ...base, draftTargets: [{ targetType: "stock", stockId: sampleStocks[0].id, targetWeightBps: 5000, sortOrder: 0 }, { targetType: "stock", stockId: sampleStocks[0].id, targetWeightBps: 5000, sortOrder: 1 }], targetIds: ["a", "b"] })).toThrow("같은 종목");
    expect(() => buildPortfolioPlanActivation({ ...base, draftTargets: [{ targetType: "cash", stockId: null, targetWeightBps: 5000, sortOrder: 0 }, { targetType: "cash", stockId: null, targetWeightBps: 5000, sortOrder: 1 }], targetIds: ["a", "b"] })).toThrow("현금 목표");
  });

  it("rejects invalid basis points and missing Stock references", () => {
    const base = { states: [], revisions: [], targets: [], stocks: sampleStocks, thesis: "", changeNote: "", now, revisionId: "r1", targetIds: ["t1"] };
    expect(() => buildPortfolioPlanActivation({ ...base, draftTargets: [{ targetType: "stock", stockId: sampleStocks[0].id, targetWeightBps: 10000.5, sortOrder: 0 }] })).toThrow();
    expect(() => buildPortfolioPlanActivation({ ...base, draftTargets: [{ targetType: "stock", stockId: "missing", targetWeightBps: 10000, sortOrder: 0 }] })).toThrow("존재하지 않습니다");
  });

  it("creates revision 1 and atomically switches the active ID", async () => {
    const activation = buildPortfolioPlanActivation({ states: [], revisions: [], targets: [], stocks: sampleStocks, draftTargets: [{ targetType: "stock", stockId: sampleStocks[0].id, targetWeightBps: 10000, sortOrder: 0 }], thesis: "My thesis", changeNote: "", now, revisionId: "r1", targetIds: ["t1"] });
    expect(activation.revision).toMatchObject({ revisionNumber: 1, basedOnRevisionId: null, activatedAt: now });
    expect(activation.states[0].activeRevisionId).toBe("r1");
    const save = vi.fn().mockResolvedValue(undefined);
    await persistPortfolioPlanActivation(activation, save);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].map((write: { collection: string }) => write.collection)).toEqual(["portfolio-plan-state", "portfolio-plan-revisions", "portfolio-allocation-targets"]);
  });

  it("editing creates revision 2 and preserves the activated historical revision and targets", () => {
    const activation = buildPortfolioPlanActivation({ states: [state], revisions: [first], targets: [firstTarget], stocks: sampleStocks, draftTargets: [{ targetType: "stock", stockId: sampleStocks[1].id, targetWeightBps: 10000, sortOrder: 0 }], thesis: "Second", changeNote: "Changed", now: "2026-08-19T00:00:00Z", revisionId: "r2", targetIds: ["t2"] });
    expect(activation.revision).toMatchObject({ revisionNumber: 2, basedOnRevisionId: "r1" });
    expect(activation.revisions[0]).toEqual(first);
    expect(activation.targets[0]).toEqual(firstTarget);
    expect(activation.states[0].activeRevisionId).toBe("r2");
  });

  it("does not expose a switched active state when atomic persistence fails", async () => {
    const activation = buildPortfolioPlanActivation({ states: [state], revisions: [first], targets: [firstTarget], stocks: sampleStocks, draftTargets: [{ targetType: "stock", stockId: sampleStocks[0].id, targetWeightBps: 10000, sortOrder: 0 }], thesis: "", changeNote: "", now, revisionId: "r2", targetIds: ["t2"] });
    await expect(persistPortfolioPlanActivation(activation, vi.fn().mockRejectedValue(new Error("disk full")))).rejects.toThrow("disk full");
    expect(state.activeRevisionId).toBe("r1");
    expect(firstTarget.revisionId).toBe("r1");
  });
});
