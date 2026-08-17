import { beforeEach, describe, expect, it, vi } from "vitest";
import { samplePlans } from "@/features/plans/sample-data";
import { sampleStocks } from "@/features/stocks/sample-data";
import { sampleTrades } from "@/features/trades/sample-data";
import { migrateLegacyAccounts } from "@/features/accounts/migrate-accounts";
import { decryptBackupPayload, encryptedBackupFormat, encryptBackupPayload, parseSelectedBackup, validateNewBackupPassword } from "./encrypted-backup";
import type { BackupV5 } from "./backup-service";
import type { AccountFeePolicyV1 } from "@/features/accounts/account-fee-policy";

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

  it("preserves EODHD Stock metadata through the encrypted restore validation path", async () => {
    const eodhdStock = { ...sampleStocks[0], providerRefs: [{ provider: "eodhd" as const, symbol: "SHOP.US" }], quotePreference: "auto" as const, priceSource: "eodhd" as const, priceFreshness: "eod" as const, priceStatus: "online" as const };
    const migrated = migrateLegacyAccounts([], sampleTrades, legacy.exportedAt);
    const backup: BackupV5 = { version: 5, exportedAt: legacy.exportedAt, accounts: migrated.accounts, stocks: [eodhdStock], plans: samplePlans, trades: migrated.trades, observations: [], reviews: [], rules: [], notes: [], language: "en", dashboardNotes: [], earningsEvents: [], displayCurrency: "KRW" };
    invokeMock.mockImplementation((command: string) => Promise.resolve(command === "encrypt_backup" ? "encrypted" : JSON.stringify(backup)));
    await expect(encryptBackupPayload(backup, "password123")).resolves.toBe("encrypted");
    expect(invokeMock).toHaveBeenCalledWith("encrypt_backup", { content: JSON.stringify(backup), password: "password123" });
    const restored = await decryptBackupPayload("encrypted", "password123");
    expect(restored.stocks[0]).toEqual(eodhdStock);
  });

  it("round-trips a valid fee policy through encrypted Backup V5", async () => {
    const migrated = migrateLegacyAccounts([], sampleTrades, legacy.exportedAt);
    const feePolicy: AccountFeePolicyV1 = { version: 1, enabled: true, rules: [{ id: "r1", name: "Fee", market: "all", currency: migrated.accounts[0].baseCurrency, side: "both", ratePercent: "0.1", fixedFee: "0", minimumFee: null, maximumFee: null, grossAmountFrom: null, grossAmountTo: null, effectiveFrom: "2026-01-01", effectiveTo: null, roundingMode: "floor", roundingUnit: "1" }] };
    const accounts = migrated.accounts.map((account, index) => index ? account : { ...account, feePolicy });
    const backup: BackupV5 = { version: 5, exportedAt: legacy.exportedAt, accounts, stocks: sampleStocks, plans: samplePlans, trades: migrated.trades, observations: [], reviews: [], rules: [], notes: [], language: "ko", dashboardNotes: [], earningsEvents: [], displayCurrency: "KRW" };
    invokeMock.mockImplementation((command: string) => Promise.resolve(command === "encrypt_backup" ? "encrypted" : JSON.stringify(backup)));
    await expect(encryptBackupPayload(backup, "password123")).resolves.toBe("encrypted");
    const restored = await decryptBackupPayload("encrypted", "password123");
    expect(restored.version).toBe(5);
    if (restored.version === 5) expect(restored.accounts[0].feePolicy).toEqual(feePolicy);
  });

  it("validates password length and exact confirmation without trimming", () => {
    expect(validateNewBackupPassword("short", "short")).toBe("PASSWORD_TOO_SHORT");
    expect(validateNewBackupPassword("password123", "password124")).toBe("PASSWORD_MISMATCH");
    expect(validateNewBackupPassword(" password1 ", " password1 ")).toBeNull();
  });
});
