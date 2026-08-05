import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AutomaticBackup, automaticBackupStatusEvent, type AutomaticBackupStatus } from "./automatic-backup";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), createBackupPayload: vi.fn(), reportPersistenceError: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@/lib/local-repository", () => ({ isTauriApp: () => true, reportPersistenceError: mocks.reportPersistenceError }));
vi.mock("./backup-service", () => ({ createBackupPayload: mocks.createBackupPayload }));

const missing: AutomaticBackupStatus = { path: null, createdAtMs: null, backupNeeded: true, created: false };
const created: AutomaticBackupStatus = { path: "/app/backups/tradejournal-auto-100.json", createdAtMs: 100_000, backupNeeded: false, created: true };

describe("AutomaticBackup", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.invoke.mockReset();
    mocks.createBackupPayload.mockReset().mockResolvedValue({ version: 4 });
    mocks.reportPersistenceError.mockReset();
  });

  it("uses native file status even when legacy localStorage values are missing or corrupt", async () => {
    localStorage.setItem("tradejournal.last-automatic-backup-at", "2999-01-01T00:00:00Z");
    localStorage.setItem("tradejournal.last-automatic-backup-path", "stale-path");
    mocks.invoke.mockImplementation((command: string) => command === "get_automatic_backup_status" ? Promise.resolve(missing) : Promise.resolve(created));
    const statuses: AutomaticBackupStatus[] = [];
    const listener = (event: Event) => statuses.push((event as CustomEvent<AutomaticBackupStatus>).detail);
    window.addEventListener(automaticBackupStatusEvent, listener);

    render(<AutomaticBackup />);

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("ensure_automatic_backup", { content: JSON.stringify({ version: 4 }, null, 2) }));
    expect(statuses).toEqual([missing, created]);
    expect(localStorage.getItem("tradejournal.last-automatic-backup-at")).toBeNull();
    expect(localStorage.getItem("tradejournal.last-automatic-backup-path")).toBeNull();
    window.removeEventListener(automaticBackupStatusEvent, listener);
  });

  it("does not create content when the native status reports a recent backup", async () => {
    mocks.invoke.mockResolvedValue({ ...created, created: false });
    render(<AutomaticBackup />);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("get_automatic_backup_status"));
    expect(mocks.createBackupPayload).not.toHaveBeenCalled();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("reports status lookup failures separately from backup write failures", async () => {
    mocks.invoke.mockRejectedValue(new Error("status failed"));
    render(<AutomaticBackup />);
    await waitFor(() => expect(mocks.reportPersistenceError).toHaveBeenCalledWith(expect.any(Error), "자동 백업 상태를 확인하지 못했습니다."));
    expect(mocks.createBackupPayload).not.toHaveBeenCalled();
  });
});
