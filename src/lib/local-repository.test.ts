import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearPersistenceError, getPersistenceSnapshot, loadCollection, retryLastSave, saveCollection, saveCollectionsAtomically } from "./local-repository";

const sqlMocks = vi.hoisted(() => ({ load: vi.fn(), invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: sqlMocks.load } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: sqlMocks.invoke }));

describe("browser local repository", () => {
  beforeEach(() => {
    clearPersistenceError();
    localStorage.clear();
    vi.restoreAllMocks();
    sqlMocks.load.mockReset();
    sqlMocks.invoke.mockReset();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("distinguishes a saved empty collection from an uninitialized collection", async () => {
    const fallback = [{ id: "sample" }];
    await expect(loadCollection("never-saved", fallback)).resolves.toEqual(fallback);

    await saveCollection("saved-empty", []);
    await expect(loadCollection("saved-empty", fallback)).resolves.toEqual([]);
  });

  it("saves multiple collections together", async () => {
    await saveCollectionsAtomically([
      { collection: "stocks", values: [{ id: "stock-1" }] },
      { collection: "trades", values: [] },
    ]);

    expect(JSON.parse(localStorage.getItem("tradejournal.stocks.v1") ?? "null")).toEqual([{ id: "stock-1" }]);
    expect(JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "null")).toEqual([]);
  });

  it("restores browser collections when a multi-collection save fails", async () => {
    localStorage.setItem("tradejournal.stocks.v1", JSON.stringify([{ id: "old-stock" }]));
    localStorage.setItem("tradejournal.trades.v1", JSON.stringify([{ id: "old-trade" }]));
    const originalSetItem = Storage.prototype.setItem;
    let failed = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === "tradejournal.trades.v1" && !failed) { failed = true; throw new Error("quota exceeded"); }
      return originalSetItem.call(this, key, value);
    });

    await expect(saveCollectionsAtomically([
      { collection: "stocks", values: [{ id: "new-stock" }] },
      { collection: "trades", values: [{ id: "new-trade" }] },
    ])).rejects.toThrow("quota exceeded");

    expect(JSON.parse(localStorage.getItem("tradejournal.stocks.v1") ?? "null")).toEqual([{ id: "old-stock" }]);
    expect(JSON.parse(localStorage.getItem("tradejournal.trades.v1") ?? "null")).toEqual([{ id: "old-trade" }]);
  });

  it("keeps a failed write available for retry", async () => {
    const originalSetItem = Storage.prototype.setItem;
    let failed = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (!failed) { failed = true; throw new Error("disk full"); }
      return originalSetItem.call(this, key, value);
    });

    await expect(saveCollection("notes", [{ id: "note-1" }])).rejects.toThrow("disk full");
    expect(getPersistenceSnapshot()).toMatchObject({ error: expect.stringContaining("disk full"), canRetry: true });

    await retryLastSave();
    expect(JSON.parse(localStorage.getItem("tradejournal.notes.v1") ?? "null")).toEqual([{ id: "note-1" }]);
    expect(getPersistenceSnapshot()).toMatchObject({ error: null, canRetry: false, pendingWrites: 0 });
  });

  it("does not retry an older failure after the same collection saves newer data", async () => {
    const originalSetItem = Storage.prototype.setItem;
    const payloads: string[] = [];
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === "tradejournal.stocks.v1") payloads.push(value);
      if (value.includes('"id":"A1"')) throw new Error("first write failed");
      return originalSetItem.call(this, key, value);
    });

    await expect(saveCollection("stocks", [{ id: "A1" }])).rejects.toThrow("first write failed");
    await saveCollection("stocks", [{ id: "B" }]);
    await retryLastSave();

    expect(JSON.parse(localStorage.getItem("tradejournal.stocks.v1") ?? "null")).toEqual([{ id: "B" }]);
    expect(payloads.filter((value) => value.includes('"id":"A1"'))).toHaveLength(1);
    expect(getPersistenceSnapshot()).toMatchObject({ error: null, canRetry: false, pendingWrites: 0 });
  });

  it("retries only collections that were not superseded by a newer success", async () => {
    const originalSetItem = Storage.prototype.setItem;
    let plansAttempts = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === "tradejournal.plans.v1" && value.includes('"id":"P1"')) {
        plansAttempts += 1;
        if (plansAttempts === 1) throw new Error("plans failed");
      }
      return originalSetItem.call(this, key, value);
    });

    await expect(saveCollectionsAtomically([
      { collection: "stocks", values: [{ id: "A1" }] },
      { collection: "plans", values: [{ id: "P1" }] },
    ])).rejects.toThrow("plans failed");
    await saveCollection("stocks", [{ id: "A2" }]);
    expect(getPersistenceSnapshot()).toMatchObject({ canRetry: true });

    await retryLastSave();

    expect(JSON.parse(localStorage.getItem("tradejournal.stocks.v1") ?? "null")).toEqual([{ id: "A2" }]);
    expect(JSON.parse(localStorage.getItem("tradejournal.plans.v1") ?? "null")).toEqual([{ id: "P1" }]);
    expect(plansAttempts).toBe(2);
    expect(getPersistenceSnapshot()).toMatchObject({ error: null, canRetry: false, pendingWrites: 0 });
  });

  it("clears retry state when a newer save for the failed collection succeeds", async () => {
    const originalSetItem = Storage.prototype.setItem;
    let failed = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (!failed && key === "tradejournal.stocks.v1") { failed = true; throw new Error("stale failure"); }
      return originalSetItem.call(this, key, value);
    });

    await expect(saveCollection("stocks", [{ id: "A1" }])).rejects.toThrow("stale failure");
    expect(getPersistenceSnapshot()).toMatchObject({ error: expect.stringContaining("stale failure"), canRetry: true });
    await saveCollection("stocks", [{ id: "A2" }]);
    expect(getPersistenceSnapshot()).toMatchObject({ error: null, canRetry: false, pendingWrites: 0 });
  });

  it("keeps a retryable failure when retry itself fails", async () => {
    const originalSetItem = Storage.prototype.setItem;
    let attempts = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === "tradejournal.notes.v1") {
        attempts += 1;
        if (attempts <= 2) throw new Error(`disk failure ${attempts}`);
      }
      return originalSetItem.call(this, key, value);
    });

    await expect(saveCollection("notes", [{ id: "note-1" }])).rejects.toThrow("disk failure 1");
    await expect(retryLastSave()).rejects.toThrow("disk failure 2");
    expect(getPersistenceSnapshot()).toMatchObject({ error: expect.stringContaining("disk failure 2"), canRetry: true, pendingWrites: 0 });

    await retryLastSave();
    expect(JSON.parse(localStorage.getItem("tradejournal.notes.v1") ?? "null")).toEqual([{ id: "note-1" }]);
    expect(getPersistenceSnapshot()).toMatchObject({ error: null, canRetry: false, pendingWrites: 0 });
  });
});

describe("Tauri local repository", () => {
  beforeEach(() => {
    clearPersistenceError();
    vi.restoreAllMocks();
    sqlMocks.load.mockReset();
    sqlMocks.invoke.mockReset();
    (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
  });

  it("loads an initialized empty collection without inserting fallback rows", async () => {
    const select = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "trades" }]);
    const execute = vi.fn();
    sqlMocks.load.mockResolvedValue({ select, execute });

    await expect(loadCollection("trades", [{ id: "sample" }])).resolves.toEqual([]);
    expect(select).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
  });

  it("delegates a multi-collection save to the single-connection Rust command", async () => {
    sqlMocks.load.mockResolvedValue({ select: vi.fn(), execute: vi.fn() });
    sqlMocks.invoke.mockResolvedValue(undefined);

    await saveCollectionsAtomically([
      { collection: "stocks", values: [{ id: "stock-1" }] },
      { collection: "trades", values: [] },
    ]);

    expect(sqlMocks.load).toHaveBeenCalledWith("sqlite:tradejournal.db");
    expect(sqlMocks.invoke).toHaveBeenCalledWith("save_collections_atomically", {
      writes: [
        { collection: "stocks", records: [expect.objectContaining({ id: "stock-1", data: JSON.stringify({ id: "stock-1" }) })] },
        { collection: "trades", records: [] },
      ],
      stateUpdatedAt: expect.any(String),
    });
  });

  it("serializes overlapping writes so an older snapshot cannot finish last", async () => {
    sqlMocks.load.mockResolvedValue({ select: vi.fn(), execute: vi.fn() });
    let finishFirst: (() => void) | undefined;
    sqlMocks.invoke
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce(undefined);

    const first = saveCollection("stocks", [{ id: "older" }]);
    await vi.waitFor(() => expect(sqlMocks.invoke).toHaveBeenCalledTimes(1));
    const second = saveCollection("stocks", [{ id: "newer" }]);
    await Promise.resolve();
    expect(sqlMocks.invoke).toHaveBeenCalledTimes(1);

    finishFirst?.();
    await first;
    await second;
    expect(sqlMocks.invoke).toHaveBeenCalledTimes(2);
    expect(sqlMocks.invoke.mock.calls[1]?.[1]).toMatchObject({ writes: [{ records: [expect.objectContaining({ id: "newer" })] }] });
  });

  it("keeps queue order and prevents a queued newer save from yielding to an older failure", async () => {
    sqlMocks.load.mockResolvedValue({ select: vi.fn(), execute: vi.fn() });
    sqlMocks.invoke.mockRejectedValueOnce(new Error("older failed")).mockResolvedValueOnce(undefined);

    const older = saveCollection("stocks", [{ id: "older" }]);
    const newer = saveCollection("stocks", [{ id: "newer" }]);
    expect(getPersistenceSnapshot().pendingWrites).toBe(2);

    await expect(older).rejects.toThrow("older failed");
    await newer;
    expect(sqlMocks.invoke.mock.calls.map((call) => ((call[1] as { writes: Array<{ records: Array<{ id: string }> }> }).writes[0]?.records[0]?.id))).toEqual(["older", "newer"]);
    expect(getPersistenceSnapshot()).toMatchObject({ error: null, canRetry: false, pendingWrites: 0 });

    await retryLastSave();
    expect(sqlMocks.invoke).toHaveBeenCalledTimes(2);
  });
});
