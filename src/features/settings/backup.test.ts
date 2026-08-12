import { beforeEach, describe, expect, it, vi } from "vitest";
import { fallbackCurrencyPreference } from "@/domain/currency";
import { emptyDashboardNote } from "@/features/dashboard/dashboard-note";
import { sampleObservations } from "@/features/observations/sample-data";
import { normalizeObservation } from "@/features/observations/types";
import { samplePlans } from "@/features/plans/sample-data";
import { sampleReviews } from "@/features/reviews/sample-data";
import { sampleRules } from "@/features/rules/sample-data";
import { sampleStocks } from "@/features/stocks/sample-data";
import { sampleTrades } from "@/features/trades/sample-data";
import { fallbackLanguagePreference } from "@/i18n/i18n-provider";
import { validateBackupPayload } from "./backup";
import { migrateLegacyAccounts } from "@/features/accounts/migrate-accounts";
import { buildAccountTransfer } from "@/features/accounts/account-transfer";
import { backupCounts, backupWrites, restoreBackup, snapshotWrite, type BackupV5 } from "./backup-service";

const repositoryMocks = vi.hoisted(() => ({ saveCollectionsAtomically: vi.fn() }));
vi.mock("@/lib/local-repository", () => ({ loadCollection: vi.fn(), saveCollectionsAtomically: repositoryMocks.saveCollectionsAtomically }));

const valid = {
  version: 1,
  exportedAt: "2026-08-01T00:00:00.000Z",
  stocks: sampleStocks,
  plans: samplePlans,
  trades: sampleTrades,
};

const note = { id: "n1", title: "Memo", content: "Text", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", deletedAt: null };
const dashboardNote = { id: "dashboard-note", content: "Next week", updatedAt: "2026-08-01T00:00:00.000Z" };
const earningsEvent = { id: "e1", name: "NVIDIA", ticker: "NVDA", date: "2026-08-20", updatedAt: "2026-08-01T00:00:00.000Z", deletedAt: null };

function version4(overrides: Record<string, unknown> = {}) {
  return { ...valid, version: 4, observations: sampleObservations, reviews: sampleReviews, rules: sampleRules, notes: [note], language: "en", dashboardNotes: [dashboardNote], earningsEvents: [earningsEvent], displayCurrency: "USD", ...overrides };
}

function version5(overrides: Record<string, unknown> = {}) {
  const migrated = migrateLegacyAccounts([], sampleTrades, valid.exportedAt);
  return { ...version4(), version: 5, accounts: migrated.accounts, trades: migrated.trades, ...overrides };
}

function writesByCollection(backup: ReturnType<typeof validateBackupPayload>) {
  return new Map(backupWrites(backup).map((write) => [write.collection, write.values]));
}

beforeEach(() => repositoryMocks.saveCollectionsAtomically.mockReset());

describe("validateBackupPayload", () => {
  it("accepts a valid legacy backup", () => {
    expect(validateBackupPayload(valid).version).toBe(1);
  });

  it("accepts a complete version 3 backup", () => {
    const backup = { ...valid, version: 3, observations: sampleObservations, reviews: sampleReviews, rules: sampleRules };
    expect(validateBackupPayload(backup).version).toBe(3);
  });

  it("accepts a complete version 2 backup", () => {
    const backup = { ...valid, version: 2, observations: sampleObservations, reviews: sampleReviews, rules: sampleRules };
    expect(validateBackupPayload(backup).version).toBe(2);
  });

  it("accepts notes and language in a version 4 backup", () => {
    const backup = version4();
    const parsed = validateBackupPayload(backup);
    expect(parsed.version).toBe(4);
    if (parsed.version === 4) {
      expect(parsed.language).toBe("en");
      expect(parsed.dashboardNotes?.[0].content).toBe("Next week");
      expect(parsed.earningsEvents?.[0].ticker).toBe("NVDA");
      expect(parsed.displayCurrency).toBe("USD");
    }
  });

  it("keeps compatibility with early version 4 backups", () => {
    const backup = { ...valid, version: 4, observations: sampleObservations, reviews: sampleReviews, rules: sampleRules, notes: [], language: "ja" };
    const parsed = validateBackupPayload(backup);
    expect(parsed.version).toBe(4);
    if (parsed.version === 4) expect(parsed.dashboardNotes).toBeUndefined();
  });

  it("accepts a version 5 backup and preserves account identity", () => {
    const parsed = validateBackupPayload(version5());
    expect(parsed.version).toBe(5);
    if (parsed.version !== 5) throw new Error("expected version 5");
    expect(parsed.accounts.length).toBeGreaterThan(0);
    expect(parsed.trades.every((trade) => parsed.accounts.some((account) => account.id === trade.accountId))).toBe(true);
  });

  it("preserves imported Trade provenance and journal status in Backup V5", () => {
    const backup = version5();
    const imported = { ...backup.trades[0], journalStatus: "recorded" as const, memo: "restored journal", deletedAt: null, origin: { kind: "fileImport" as const, sourceKey: "file:v2:abc", importBatchId: "file:v1:batch:abc", provider: "broker-renamed", externalExecutionId: "exec-1", importedAt: valid.exportedAt, sourceRow: 2, timePrecision: "second" as const } };
    const parsed = validateBackupPayload({ ...backup, trades: [imported, ...backup.trades.slice(1)] });
    expect(parsed.trades[0]).toMatchObject({ journalStatus: "recorded", memo: "restored journal", deletedAt: null, origin: imported.origin });
  });

  it("rejects malformed provided import metadata while accepting old V5 Trades", () => {
    expect(validateBackupPayload(version5()).version).toBe(5);
    const backup = version5();
    expect(() => validateBackupPayload({ ...backup, trades: backup.trades.map((trade, index) => index ? trade : { ...trade, journalStatus: "pending" }) })).toThrow("저널 상태");
    expect(() => validateBackupPayload({ ...backup, trades: backup.trades.map((trade, index) => index ? trade : { ...trade, origin: { kind: "fileImport", sourceKey: "file:v1:x" } }) })).toThrow("가져오기 출처");
  });

  it("keeps mapping profiles out of Backup V5 writes", () => {
    expect(backupWrites(validateBackupPayload(version5())).map((write) => write.collection)).not.toContain("import-mapping-profiles");
  });

  it("accepts legacy, stock, and market observation shapes in version 5", () => {
    const stock = { ...sampleObservations[0], id: "new-stock-observation", scope: "stock", marketTargets: [] };
    const market = { ...sampleObservations[0], id: "market-observation", scope: "market", stockId: null, stockName: "", marketTargets: ["nasdaq", "sp500"] };
    expect(validateBackupPayload(version5({ observations: [sampleObservations[0], stock, market] })).version).toBe(5);
  });

  it("accepts Japanese and European market targets in version 5", () => {
    const base = { ...sampleObservations[0], scope: "market", stockId: null, stockName: "" };
    const japan = { ...base, id: "japan-market", marketTargets: ["nikkei225", "topix"] };
    const europe = { ...base, id: "europe-market", marketTargets: ["stoxx600", "eurostoxx50", "dax"] };
    expect(validateBackupPayload(version5({ observations: [japan, europe] })).version).toBe(5);
  });

  it("rejects unknown market target IDs", () => {
    const base = { ...sampleObservations[0], scope: "market", stockId: null, stockName: "" };
    for (const target of ["nikkei", "eurostoxx", "random-index"]) expect(() => validateBackupPayload(version5({ observations: [{ ...base, marketTargets: [target] }] }))).toThrow("시장 대상");
  });

  it("rejects invalid observation scope combinations", () => {
    const observation = sampleObservations[0];
    const invalid = [
      { ...observation, scope: "stock", stockId: null, marketTargets: [] },
      { ...observation, scope: "stock", marketTargets: ["nasdaq"] },
      { ...observation, scope: "market", marketTargets: ["nasdaq"] },
      { ...observation, scope: "market", stockId: null, stockName: "", marketTargets: [] },
    ];
    for (const value of invalid) expect(() => validateBackupPayload(version5({ observations: [value] }))).toThrow();
  });

  it("rejects a version 5 trade that references an unknown account", () => {
    const backup = version5();
    expect(() => validateBackupPayload({ ...backup, trades: backup.trades.map((trade, index) => index === 0 ? { ...trade, accountId: "missing" } : trade) })).toThrow("존재하지 않는 계좌");
  });

  it("rejects broken transfer pairs in version 5 backups", () => {
    const backup = version5();
    const second = { ...backup.accounts[0], id: "second-account", name: "Second", isDefault: false };
    const accounts = [...backup.accounts, second];
    const pair = buildAccountTransfer(accounts, { sourceAccountId: accounts[0].id, targetAccountId: second.id, amount: 100, currency: "KRW", tradedAt: valid.exportedAt, memo: "" }, valid.exportedAt, "transfer-test");
    expect(() => validateBackupPayload({ ...backup, accounts, trades: [...backup.trades, pair[0]] })).toThrow("두 건");
    expect(() => validateBackupPayload({ ...backup, accounts, trades: [...backup.trades, pair[0], { ...pair[1], amount: 101 }] })).toThrow("일치");
    expect(() => validateBackupPayload({ ...backup, accounts, trades: [...backup.trades, pair[0], { ...pair[1], currency: "USD", exchangeRate: 1400 }] })).toThrow("일치");
    expect(validateBackupPayload({ ...backup, accounts, trades: [...backup.trades, ...pair] }).version).toBe(5);
  });

  it("rejects duplicate record IDs before restore", () => {
    expect(() => validateBackupPayload({ ...valid, trades: [sampleTrades[0], sampleTrades[0]] })).toThrow("중복 ID");
  });

  it("rejects a stock record that only has an ID", () => {
    expect(() => validateBackupPayload({ ...valid, stocks: [{ id: "broken-stock" }] })).toThrow("종목 1번째 항목");
  });

  it("rejects a plan with a non-numeric amount", () => {
    expect(() => validateBackupPayload({ ...valid, plans: [{ ...samplePlans[0], plannedAmount: "many" }] })).toThrow("plannedAmount");
  });

  it("rejects an unsupported trade type", () => {
    expect(() => validateBackupPayload({ ...valid, trades: [{ ...sampleTrades[0], tradeType: "환전" }] })).toThrow("거래 유형");
  });

  it("requires all extended collections for version 3", () => {
    expect(() => validateBackupPayload({ ...valid, version: 3 })).toThrow("관찰 기록 목록");
  });

  it("rejects an initialized holding without any security history", () => {
    const stock = { ...sampleStocks[0], id: "orphan", ledgerInitializedAt: "2026-08-01", quantity: 3 };
    expect(() => validateBackupPayload({ ...valid, stocks: [stock], trades: [] })).toThrow("매매 기록이 없습니다");
  });

  it("prepares every version 4 collection for an atomic restore", () => {
    const parsed = validateBackupPayload({ ...valid, version: 4, observations: sampleObservations, reviews: sampleReviews, rules: sampleRules, notes: [], language: "ko", dashboardNotes: [], earningsEvents: [], displayCurrency: "KRW" });
    const names = backupWrites(parsed).map((write) => write.collection);
    expect(names).toEqual(["accounts", "stocks", "plans", "trades", "observations", "reviews", "rules", "notes", "language-preferences", "dashboard-notes", "earnings-events", "preferences"]);
    expect(backupCounts(parsed)).toMatchObject({ stocks: sampleStocks.length, trades: sampleTrades.length, notes: 0 });
  });

  it("fully replaces version 1 missing collections with empty or default values", () => {
    const parsed = validateBackupPayload(valid);
    const writes = backupWrites(parsed);
    const byCollection = writesByCollection(parsed);

    expect(writes.map((write) => write.collection)).toEqual(["accounts", "stocks", "plans", "trades", "observations", "reviews", "rules", "notes", "language-preferences", "dashboard-notes", "earnings-events", "preferences"]);
    expect(byCollection.get("stocks")).toEqual(sampleStocks);
    expect(byCollection.get("plans")).toEqual(samplePlans);
    expect(byCollection.get("trades")).toHaveLength(sampleTrades.length);
    expect(byCollection.get("accounts")).not.toEqual([]);
    expect((byCollection.get("trades") as readonly { id: string; accountId?: string }[]).every((trade) => Boolean(trade.accountId))).toBe(true);
    for (const collection of ["observations", "reviews", "rules", "notes", "earnings-events"]) expect(byCollection.get(collection)).toEqual([]);
    expect(byCollection.get("language-preferences")).toEqual([fallbackLanguagePreference]);
    expect(byCollection.get("dashboard-notes")).toEqual([emptyDashboardNote]);
    expect(byCollection.get("preferences")).toEqual([fallbackCurrencyPreference]);
  });

  it.each([2, 3])("restores version %s extended data and resets newer fields", (version) => {
    const parsed = validateBackupPayload({ ...valid, version, observations: sampleObservations, reviews: sampleReviews, rules: sampleRules });
    const byCollection = writesByCollection(parsed);

    expect(byCollection.size).toBe(12);
    expect(byCollection.get("observations")).toEqual(sampleObservations.map(normalizeObservation));
    expect(byCollection.get("reviews")).toEqual(sampleReviews);
    expect(byCollection.get("rules")).toEqual(sampleRules);
    expect(byCollection.get("notes")).toEqual([]);
    expect(byCollection.get("earnings-events")).toEqual([]);
    expect(byCollection.get("language-preferences")).toEqual([fallbackLanguagePreference]);
    expect(byCollection.get("dashboard-notes")).toEqual([emptyDashboardNote]);
    expect(byCollection.get("preferences")).toEqual([fallbackCurrencyPreference]);
  });

  it("restores all version 4 values", () => {
    const parsed = validateBackupPayload(version4());
    const byCollection = writesByCollection(parsed);

    expect(byCollection.size).toBe(12);
    expect(byCollection.get("notes")).toEqual([note]);
    expect(byCollection.get("language-preferences")).toEqual([expect.objectContaining({ id: "language", locale: "en" })]);
    expect(byCollection.get("dashboard-notes")).toEqual([dashboardNote]);
    expect(byCollection.get("earnings-events")).toEqual([earningsEvent]);
    expect(byCollection.get("preferences")).toEqual([expect.objectContaining({ id: "currency", displayCurrency: "USD" })]);
  });

  it("resets optional version 4 fields when an early backup omits them", () => {
    const parsed = validateBackupPayload(version4({ dashboardNotes: undefined, earningsEvents: undefined, displayCurrency: undefined }));
    const byCollection = writesByCollection(parsed);

    expect(byCollection.size).toBe(12);
    expect(byCollection.get("dashboard-notes")).toEqual([emptyDashboardNote]);
    expect(byCollection.get("earnings-events")).toEqual([]);
    expect(byCollection.get("preferences")).toEqual([fallbackCurrencyPreference]);
  });

  it("stores the current backup as an undo snapshot before restore", () => {
    const backup = version5() as BackupV5;
    const write = snapshotWrite(backup);
    expect(write.collection).toBe("restore-snapshots");
    const saved = JSON.parse(String((write.values[0] as unknown as { content: string }).content));
    expect(saved).toMatchObject({ version: 5, accounts: backup.accounts, stocks: sampleStocks, notes: [note], language: "en", dashboardNotes: [dashboardNote], earningsEvents: [earningsEvent], displayCurrency: "USD" });
    const undoWrites = backupWrites(validateBackupPayload(saved));
    expect(undoWrites.map((item) => item.collection)).toHaveLength(12);
    expect(undoWrites.find((item) => item.collection === "accounts")?.values).toEqual(backup.accounts);
    expect(undoWrites.some((item) => item.collection === "restore-snapshots")).toBe(false);
  });

  it("saves the undo snapshot and complete replacement in one atomic call", async () => {
    repositoryMocks.saveCollectionsAtomically.mockResolvedValue(undefined);
    const current = version5() as BackupV5;
    const legacy = validateBackupPayload(valid);

    await restoreBackup(current, legacy);

    expect(repositoryMocks.saveCollectionsAtomically).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.saveCollectionsAtomically).toHaveBeenCalledWith(expect.any(Array), { resolveCorruption: true, source: "backupRestore" });
    const writes = repositoryMocks.saveCollectionsAtomically.mock.calls[0]?.[0];
    expect(writes.map((write: { collection: string }) => write.collection)).toEqual(["restore-snapshots", "accounts", "stocks", "plans", "trades", "observations", "reviews", "rules", "notes", "language-preferences", "dashboard-notes", "earnings-events", "preferences"]);
  });
});
