import { beforeEach, describe, expect, it, vi } from "vitest";
import { fallbackCurrencyPreference } from "@/domain/currency";
import { migrateLegacyAccounts } from "@/features/accounts/migrate-accounts";
import { emptyDashboardNote } from "@/features/dashboard/dashboard-note";
import { sampleObservations } from "@/features/observations/sample-data";
import { samplePlans } from "@/features/plans/sample-data";
import { sampleReviews } from "@/features/reviews/sample-data";
import { sampleRules } from "@/features/rules/sample-data";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { Stock } from "@/features/stocks/types";
import { sampleTrades } from "@/features/trades/sample-data";
import { fallbackLanguagePreference } from "@/i18n/i18n-provider";
import { automaticBackupSourceCollections, createBackupCandidate, createBackupPayload } from "./backup-service";

const repositoryMocks = vi.hoisted(() => ({ loadCollection: vi.fn(), getCorruptionSnapshot: vi.fn() }));
vi.mock("@/lib/local-repository", () => ({
  loadCollection: repositoryMocks.loadCollection,
  getCorruptionSnapshot: repositoryMocks.getCorruptionSnapshot,
  saveCollectionsAtomically: vi.fn(),
}));

const exportedAt = "2026-08-16T00:00:00.000Z";

function sourceCollections() {
  const migrated = migrateLegacyAccounts([], sampleTrades, exportedAt);
  return {
    accounts: migrated.accounts,
    stocks: sampleStocks,
    plans: samplePlans,
    trades: migrated.trades,
    observations: sampleObservations,
    reviews: sampleReviews,
    rules: sampleRules,
    notes: [],
    "language-preferences": [fallbackLanguagePreference],
    "dashboard-notes": [emptyDashboardNote],
    "earnings-events": [],
    preferences: [fallbackCurrencyPreference],
  };
}

function useSources(overrides: Partial<ReturnType<typeof sourceCollections>> = {}) {
  const values = { ...sourceCollections(), ...overrides };
  repositoryMocks.loadCollection.mockImplementation(async (collection: keyof typeof values) => values[collection]);
  return values;
}

describe("automatic backup candidate", () => {
  beforeEach(() => {
    repositoryMocks.loadCollection.mockReset();
    repositoryMocks.getCorruptionSnapshot.mockReset().mockReturnValue({ collections: [] });
    useSources();
  });

  it("contains every allowed source collection exactly once and excludes device-local caches", async () => {
    const candidate = await createBackupCandidate("en");
    expect(candidate.sourceCounts.map((item) => item.collection)).toEqual(automaticBackupSourceCollections);
    expect(new Set(candidate.sourceCounts.map((item) => item.collection)).size).toBe(automaticBackupSourceCollections.length);
    for (const excluded of ["restore-snapshots", "import-mapping-profiles", "exchange-rates", "corrupt-records"]) {
      expect(candidate.sourceCounts.map((item) => item.collection)).not.toContain(excluded);
    }
    expect(candidate.sourceCounts.every((item) => Number.isInteger(item.count) && item.count >= 0)).toBe(true);
  });

  it("captures source counts before account and trade migration changes output", async () => {
    useSources({ accounts: [], trades: sampleTrades });
    const candidate = await createBackupCandidate("en");
    expect(candidate.sourceCounts.find((item) => item.collection === "accounts")?.count).toBe(0);
    expect(candidate.backup.accounts.length).toBeGreaterThan(0);
    expect(candidate.sourceCounts.find((item) => item.collection === "trades")?.count).toBe(sampleTrades.length);
  });

  it("counts soft-deleted records because the backup preserves them", async () => {
    const deleted = { ...sampleStocks[0], id: "deleted-stock", deletedAt: exportedAt };
    useSources({ stocks: [sampleStocks[0], deleted] });
    const candidate = await createBackupCandidate("en");
    expect(candidate.sourceCounts.find((item) => item.collection === "stocks")?.count).toBe(2);
    expect(candidate.backup.stocks).toHaveLength(2);
  });

  it("refuses a candidate when any source collection has unresolved corruption", async () => {
    repositoryMocks.getCorruptionSnapshot.mockReturnValue({ collections: [{ collection: "stocks" }] });
    await expect(createBackupCandidate("en")).rejects.toThrow("AUTOMATIC_BACKUP_SOURCE_CORRUPTED");
  });

  it("runtime-validates the completed payload", async () => {
    useSources({ stocks: [{ ...sampleStocks[0], priceSource: "future-provider" }] as unknown as Stock[] });
    await expect(createBackupCandidate("en")).rejects.toThrow("AUTOMATIC_BACKUP_VALIDATION_FAILED");
  });

  it("keeps createBackupPayload API-compatible and preserves EODHD metadata", async () => {
    const eodhdStock = { ...sampleStocks[0], providerRefs: [{ provider: "eodhd" as const, symbol: "005930.KO" }], quotePreference: "auto" as const, priceSource: "eodhd" as const, priceFreshness: "eod" as const, priceStatus: "online" as const };
    useSources({ stocks: [eodhdStock] });
    const candidate = await createBackupCandidate("en");
    const payload = await createBackupPayload("en");
    expect(payload).toMatchObject({ version: 5, stocks: [eodhdStock] });
    expect(candidate.backup.stocks[0]).toEqual(eodhdStock);
  });
});
