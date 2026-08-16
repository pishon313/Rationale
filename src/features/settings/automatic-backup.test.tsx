import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutomaticBackup, automaticBackupDebounceMs, automaticBackupStatusEvent, type AutomaticBackupStatus } from "./automatic-backup";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  createBackupCandidate: vi.fn(),
  tauri: true,
  snapshot: { pendingWrites: 0, error: null as string | null, canRetry: false, lastSavedAt: null as string | null },
  listeners: new Set<() => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/local-repository", () => ({
  isTauriApp: () => mocks.tauri,
  getPersistenceSnapshot: () => mocks.snapshot,
  subscribePersistence: (listener: () => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener); },
}));
vi.mock("./backup-service", () => ({ createBackupCandidate: mocks.createBackupCandidate }));

const counts = { accounts: 1, stocks: 2, plans: 3, trades: 4, observations: 5, reviews: 6, rules: 7, notes: 8 };
const due: AutomaticBackupStatus = { path: null, createdAtMs: null, backupNeeded: true, created: false, verified: false, counts: null, ignoredInvalidFileCount: 0, errorCode: null };
const recent: AutomaticBackupStatus = { path: "/app/backups/tradejournal-auto-100.json", createdAtMs: 100_000, backupNeeded: false, created: false, verified: true, counts, ignoredInvalidFileCount: 0, errorCode: null };
const created: AutomaticBackupStatus = { ...recent, created: true };
const candidate = { backup: { version: 5 }, sourceCounts: [{ collection: "stocks", count: 2 }] };

function emitPersistence(next: Partial<typeof mocks.snapshot>) {
  Object.assign(mocks.snapshot, next);
  for (const listener of mocks.listeners) listener();
}

describe("AutomaticBackup", () => {
  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    mocks.invoke.mockReset();
    mocks.createBackupCandidate.mockReset().mockResolvedValue(candidate);
    mocks.tauri = true;
    Object.assign(mocks.snapshot, { pendingWrites: 0, error: null, canRetry: false, lastSavedAt: null });
    mocks.listeners.clear();
  });

  afterEach(() => vi.useRealTimers());

  it("uses native status and builds no payload when a recent verified backup exists", async () => {
    localStorage.setItem("tradejournal.last-automatic-backup-at", "stale");
    mocks.invoke.mockResolvedValue(recent);
    render(<AutomaticBackup />);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("get_automatic_backup_status"));
    expect(mocks.createBackupCandidate).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("tradejournal.last-automatic-backup-at")).toBeNull();
  });

  it("passes runtime-validated content and source counts when startup status is due", async () => {
    mocks.invoke.mockImplementation((command: string) => command === "get_automatic_backup_status" ? Promise.resolve(due) : Promise.resolve(created));
    render(<AutomaticBackup />);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("ensure_automatic_backup", { content: JSON.stringify(candidate.backup, null, 2), sourceCounts: candidate.sourceCounts }));
    expect(mocks.createBackupCandidate).toHaveBeenCalledTimes(1);
  });

  it("checks again after a successful save once persistence becomes idle", async () => {
    vi.useFakeTimers();
    mocks.invoke.mockResolvedValue(recent);
    render(<AutomaticBackup />);
    await act(async () => { await Promise.resolve(); });
    act(() => emitPersistence({ pendingWrites: 1, lastSavedAt: "2026-08-16T01:00:00Z" }));
    await vi.advanceTimersByTimeAsync(automaticBackupDebounceMs);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    act(() => emitPersistence({ pendingWrites: 0 }));
    await vi.advanceTimersByTimeAsync(automaticBackupDebounceMs);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("debounces multiple rapid successful saves into one attempt", async () => {
    vi.useFakeTimers();
    mocks.invoke.mockResolvedValue(recent);
    render(<AutomaticBackup />);
    await act(async () => { await Promise.resolve(); });
    act(() => emitPersistence({ lastSavedAt: "2026-08-16T01:00:00Z" }));
    await vi.advanceTimersByTimeAsync(automaticBackupDebounceMs - 1);
    act(() => emitPersistence({ lastSavedAt: "2026-08-16T01:00:01Z" }));
    await vi.advanceTimersByTimeAsync(automaticBackupDebounceMs);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("never overlaps an in-flight startup attempt", async () => {
    vi.useFakeTimers();
    let resolveStatus: ((status: AutomaticBackupStatus) => void) | undefined;
    mocks.invoke.mockImplementationOnce(() => new Promise<AutomaticBackupStatus>((resolve) => { resolveStatus = resolve; })).mockResolvedValue(recent);
    render(<AutomaticBackup />);
    await act(async () => { await Promise.resolve(); });
    act(() => emitPersistence({ lastSavedAt: "2026-08-16T01:00:00Z" }));
    await vi.advanceTimersByTimeAsync(automaticBackupDebounceMs);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await act(async () => { resolveStatus?.(recent); await Promise.resolve(); await Promise.resolve(); });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it("shows a dedicated error for source-count mismatch without changing persistence state", async () => {
    mocks.invoke.mockImplementation((command: string) => command === "get_automatic_backup_status" ? Promise.resolve(due) : Promise.reject(new Error("AUTOMATIC_BACKUP_SOURCE_COUNT_MISMATCH")));
    render(<AutomaticBackup />);
    expect(await screen.findByText("자동 백업 오류")).toBeInTheDocument();
    expect(screen.getByText("저장 원본과 백업 항목 수가 달라 자동 백업을 중단했습니다.")).toBeInTheDocument();
    expect(mocks.snapshot.error).toBeNull();
  });

  it("shows status lookup failure as an automatic-backup error", async () => {
    mocks.invoke.mockRejectedValue(new Error("status unavailable"));
    render(<AutomaticBackup />);
    expect(await screen.findByText("자동 백업 상태를 확인하지 못했습니다.")).toBeInTheDocument();
    expect(mocks.createBackupCandidate).not.toHaveBeenCalled();
    expect(mocks.snapshot.error).toBeNull();
  });

  it("shows corruption separately and never invokes the native writer", async () => {
    mocks.invoke.mockResolvedValue(due);
    mocks.createBackupCandidate.mockRejectedValue(new Error("AUTOMATIC_BACKUP_SOURCE_CORRUPTED"));
    render(<AutomaticBackup />);
    expect(await screen.findByText("손상된 데이터를 먼저 복구해야 완전한 자동 백업을 만들 수 있습니다.")).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("clears a prior error after a later successful save and publishes verified counts", async () => {
    vi.useFakeTimers();
    mocks.invoke
      .mockResolvedValueOnce(due)
      .mockRejectedValueOnce(new Error("AUTOMATIC_BACKUP_SOURCE_COUNT_MISMATCH"))
      .mockResolvedValueOnce(due)
      .mockResolvedValueOnce(created);
    const statuses: AutomaticBackupStatus[] = [];
    const listener = (event: Event) => statuses.push((event as CustomEvent<AutomaticBackupStatus>).detail);
    window.addEventListener(automaticBackupStatusEvent, listener);
    render(<AutomaticBackup />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText("자동 백업 오류")).toBeInTheDocument();
    act(() => emitPersistence({ lastSavedAt: "2026-08-16T01:00:00Z" }));
    await vi.advanceTimersByTimeAsync(automaticBackupDebounceMs);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText("자동 백업 오류")).not.toBeInTheDocument();
    expect(statuses.at(-1)).toMatchObject({ verified: true, counts });
    window.removeEventListener(automaticBackupStatusEvent, listener);
  });

  it("cleans up the persistence subscription and pending timer on unmount", async () => {
    vi.useFakeTimers();
    mocks.invoke.mockResolvedValue(recent);
    const view = render(<AutomaticBackup />);
    await act(async () => { await Promise.resolve(); });
    act(() => emitPersistence({ lastSavedAt: "2026-08-16T01:00:00Z" }));
    expect(mocks.listeners.size).toBe(1);
    view.unmount();
    expect(mocks.listeners.size).toBe(0);
    await vi.advanceTimersByTimeAsync(automaticBackupDebounceMs);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not invoke native backup commands in browser preview", () => {
    mocks.tauri = false;
    render(<AutomaticBackup />);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.listeners.size).toBe(0);
  });
});
