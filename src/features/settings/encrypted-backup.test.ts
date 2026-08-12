import { beforeEach, describe, expect, it, vi } from "vitest";
import { samplePlans } from "@/features/plans/sample-data";
import { sampleStocks } from "@/features/stocks/sample-data";
import { sampleTrades } from "@/features/trades/sample-data";
import { decryptBackupPayload, encryptedBackupFormat, parseSelectedBackup, validateNewBackupPassword } from "./encrypted-backup";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

const legacy = { version: 1, exportedAt: "2026-08-05T00:00:00.000Z", stocks: sampleStocks, plans: samplePlans, trades: sampleTrades };

beforeEach(() => invokeMock.mockReset());

describe("encrypted backup routing", () => {
  it.each([1, 2, 3, 4])("keeps plaintext version %s on the existing validation path", (version) => {
    const extended = version === 1 ? {} : { observations: [], reviews: [], rules: [] };
    const current = version === 4 ? { notes: [], language: "ko" } : {};
    const result = parseSelectedBackup(JSON.stringify({ ...legacy, version, ...extended, ...current }), "backup.json");
    expect(result.kind).toBe("plaintext");
  });

  it("routes an encrypted container without exposing payload metadata", () => {
    const content = JSON.stringify({ format: encryptedBackupFormat, formatVersion: 1, kdf: {}, cipher: {}, ciphertext: "secret" });
    expect(parseSelectedBackup(content, "backup.rationale-backup")).toEqual({ kind: "encrypted", content });
  });

  it("rejects a future encrypted container version before invoking Rust", () => {
    const content = JSON.stringify({ format: encryptedBackupFormat, formatVersion: 2, kdf: {}, cipher: {}, ciphertext: "secret" });
    expect(() => parseSelectedBackup(content, "backup.rationale-backup")).toThrow("UNSUPPORTED_ENCRYPTED_BACKUP_VERSION");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("decrypts and joins the existing backup validation pipeline", async () => {
    invokeMock.mockResolvedValue(JSON.stringify(legacy));
    await expect(decryptBackupPayload("encrypted", "password123")).resolves.toMatchObject({ version: 1 });
    expect(invokeMock).toHaveBeenCalledWith("decrypt_backup", { container: "encrypted", password: "password123" });
  });

  it("preserves import provenance through the encrypted restore validation path", async () => {
    const origin = { kind: "fileImport" as const, sourceKey: "file:v1:abc", importBatchId: "file:v1:batch:abc", importedAt: legacy.exportedAt, sourceRow: 2, timePrecision: "second" as const };
    invokeMock.mockResolvedValue(JSON.stringify({ ...legacy, trades: [{ ...sampleTrades[0], journalStatus: "unreviewed", origin }, ...sampleTrades.slice(1)] }));
    const restored = await decryptBackupPayload("encrypted", "password123");
    expect(restored.trades[0]).toMatchObject({ journalStatus: "unreviewed", origin });
  });

  it("validates password length and exact confirmation without trimming", () => {
    expect(validateNewBackupPassword("short", "short")).toBe("PASSWORD_TOO_SHORT");
    expect(validateNewBackupPassword("password123", "password124")).toBe("PASSWORD_MISMATCH");
    expect(validateNewBackupPassword(" password1 ", " password1 ")).toBeNull();
  });
});
