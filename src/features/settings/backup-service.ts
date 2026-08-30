import { fallbackCurrencyPreference, type CurrencyPreference } from "@/domain/currency";
import { normalizeTrade } from "@/domain/trading-ledger";
import { emptyDashboardNote } from "@/features/dashboard/dashboard-note";
import type { Note } from "@/features/notes/types";
import { normalizeObservation, type Observation } from "@/features/observations/types";
import type { BuyPlan } from "@/features/plans/types";
import type { Review } from "@/features/reviews/types";
import type { InvestmentRule } from "@/features/rules/types";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import type { InvestmentAccount } from "@/features/accounts/types";
import type {
  LegacyPortfolioAllocationTargetV6,
  LegacyPortfolioPlanRevisionV6,
  LegacyPortfolioPlanStateV6,
  PortfolioAllocationGroup,
  PortfolioAllocationTarget,
  PortfolioPlanRevision,
  PortfolioPlanState,
} from "@/features/portfolio-plan/types";
import { isLegacyPortfolioPlanV6Data, migratePortfolioPlanV6 } from "@/features/portfolio-plan/portfolio-plan-migration";
import { migrateLegacyAccounts } from "@/features/accounts/migrate-accounts";
import { fallbackLanguagePreference, type LanguagePreference } from "@/i18n/i18n-provider";
import type { Locale } from "@/i18n/types";
import { getCorruptionSnapshot, loadCollection, saveCollectionsAtomically, type CollectionWrite } from "@/lib/local-repository";
import { validateBackupPayload, type DashboardNoteBackup, type EarningsEventBackup, type ValidatedBackup } from "./backup";

export const automaticBackupSourceCollections = [
  "accounts",
  "stocks",
  "plans",
  "trades",
  "observations",
  "reviews",
  "rules",
  "notes",
  "language-preferences",
  "dashboard-notes",
  "earnings-events",
  "preferences",
  "portfolio-plan-state",
  "portfolio-plan-revisions",
  "portfolio-allocation-groups",
  "portfolio-allocation-targets",
] as const;

export type AutomaticBackupSourceCollection = (typeof automaticBackupSourceCollections)[number];
export type AutomaticBackupSourceCount = { collection: AutomaticBackupSourceCollection; count: number };
export type BackupCandidate = { backup: BackupV7; sourceCounts: AutomaticBackupSourceCount[] };

export type BackupV5 = {
  version: 5;
  exportedAt: string;
  accounts: InvestmentAccount[];
  stocks: Stock[];
  plans: BuyPlan[];
  trades: Trade[];
  observations: Observation[];
  reviews: Review[];
  rules: InvestmentRule[];
  notes: Note[];
  language: Locale;
  dashboardNotes: DashboardNoteBackup[];
  earningsEvents: EarningsEventBackup[];
  displayCurrency: CurrencyPreference["displayCurrency"];
};

export type BackupV6 = Omit<BackupV5, "version"> & {
  version: 6;
  portfolioPlanState: LegacyPortfolioPlanStateV6[];
  portfolioPlanRevisions: LegacyPortfolioPlanRevisionV6[];
  portfolioAllocationTargets: LegacyPortfolioAllocationTargetV6[];
};

export type BackupV7 = Omit<BackupV5, "version"> & {
  version: 7;
  portfolioPlanState: PortfolioPlanState[];
  portfolioPlanRevisions: PortfolioPlanRevision[];
  portfolioAllocationGroups: PortfolioAllocationGroup[];
  portfolioAllocationTargets: PortfolioAllocationTarget[];
};

export type RestoreSnapshot = { id: "latest"; content: string; createdAt: string; updatedAt: string };
export const restoreSnapshotCollection = "restore-snapshots";

export async function createBackupCandidate(localeOverride?: Locale, options: { allowCorrupted?: boolean } = {}): Promise<BackupCandidate> {
  const [accounts, stocks, plans, trades, observations, reviews, rules, notes, languages, dashboardNotes, earningsEvents, preferences, portfolioPlanState, portfolioPlanRevisions, portfolioAllocationGroups, portfolioAllocationTargets] = await Promise.all([
    loadCollection<InvestmentAccount>("accounts", []),
    loadCollection<Stock>("stocks", []),
    loadCollection<BuyPlan>("plans", []),
    loadCollection<Trade>("trades", []),
    loadCollection<Observation>("observations", []),
    loadCollection<Review>("reviews", []),
    loadCollection<InvestmentRule>("rules", []),
    loadCollection<Note>("notes", []),
    loadCollection<LanguagePreference>("language-preferences", [fallbackLanguagePreference]),
    loadCollection<DashboardNoteBackup>("dashboard-notes", [emptyDashboardNote]),
    loadCollection<EarningsEventBackup>("earnings-events", []),
    loadCollection<CurrencyPreference>("preferences", [fallbackCurrencyPreference]),
    loadCollection<PortfolioPlanState | LegacyPortfolioPlanStateV6>("portfolio-plan-state", []),
    loadCollection<PortfolioPlanRevision | LegacyPortfolioPlanRevisionV6>("portfolio-plan-revisions", []),
    loadCollection<PortfolioAllocationGroup>("portfolio-allocation-groups", []),
    loadCollection<PortfolioAllocationTarget | LegacyPortfolioAllocationTargetV6>("portfolio-allocation-targets", []),
  ]);
  const sourceValues = [accounts, stocks, plans, trades, observations, reviews, rules, notes, languages, dashboardNotes, earningsEvents, preferences, portfolioPlanState, portfolioPlanRevisions, portfolioAllocationGroups, portfolioAllocationTargets] as const;
  const sourceCounts = automaticBackupSourceCollections.map((collection, index) => ({ collection, count: sourceValues[index].length }));
  const sourceCollectionSet = new Set<string>(automaticBackupSourceCollections);
  if (!options.allowCorrupted && getCorruptionSnapshot().collections.some((item) => sourceCollectionSet.has(item.collection))) {
    throw new Error("AUTOMATIC_BACKUP_SOURCE_CORRUPTED");
  }
  const exportedAt = new Date().toISOString();
  const migrated = migrateLegacyAccounts(accounts, trades, exportedAt);
  const portfolio = isLegacyPortfolioPlanV6Data({ states: portfolioPlanState, revisions: portfolioPlanRevisions, targets: portfolioAllocationTargets })
    ? migratePortfolioPlanV6({
        states: portfolioPlanState as LegacyPortfolioPlanStateV6[],
        revisions: portfolioPlanRevisions as LegacyPortfolioPlanRevisionV6[],
        targets: portfolioAllocationTargets as LegacyPortfolioAllocationTargetV6[],
        stocks,
        accounts: migrated.accounts,
        trades: migrated.trades,
      })
    : {
        states: portfolioPlanState as PortfolioPlanState[],
        revisions: portfolioPlanRevisions as PortfolioPlanRevision[],
        groups: portfolioAllocationGroups,
        targets: portfolioAllocationTargets as PortfolioAllocationTarget[],
      };
  const backup: BackupV7 = {
    version: 7,
    exportedAt,
    accounts: migrated.accounts,
    stocks,
    plans,
    trades: migrated.trades.map(normalizeTrade),
    observations: observations.map(normalizeObservation),
    reviews,
    rules,
    notes,
    language: localeOverride ?? languages[0]?.locale ?? fallbackLanguagePreference.locale,
    dashboardNotes,
    earningsEvents,
    displayCurrency: preferences[0]?.displayCurrency ?? fallbackCurrencyPreference.displayCurrency,
    portfolioPlanState: portfolio.states,
    portfolioPlanRevisions: portfolio.revisions,
    portfolioAllocationGroups: portfolio.groups,
    portfolioAllocationTargets: portfolio.targets,
  };
  for (const collection of ["accounts", "stocks", "plans", "trades", "observations", "reviews", "rules", "notes", "dashboardNotes", "earningsEvents", "portfolioPlanState", "portfolioPlanRevisions", "portfolioAllocationGroups", "portfolioAllocationTargets"] as const) {
    if (!Array.isArray(backup[collection])) throw new Error("AUTOMATIC_BACKUP_VALIDATION_FAILED");
  }
  let validated: ValidatedBackup;
  try { validated = validateBackupPayload(backup); }
  catch { throw new Error("AUTOMATIC_BACKUP_VALIDATION_FAILED"); }
  if (validated.version !== 7) throw new Error("AUTOMATIC_BACKUP_VALIDATION_FAILED");
  return { backup: validated, sourceCounts };
}

export async function createBackupPayload(localeOverride?: Locale, options: { allowCorrupted?: boolean } = {}): Promise<BackupV7> {
  return (await createBackupCandidate(localeOverride, options)).backup;
}

export function backupWrites(parsed: ValidatedBackup): CollectionWrite[] {
  const extended = parsed.version === 1 ? null : parsed;
  const current = parsed.version === 4 || parsed.version === 5 || parsed.version === 6 || parsed.version === 7 ? parsed : null;
  const migrated = parsed.version === 5 || parsed.version === 6 || parsed.version === 7
    ? { accounts: parsed.accounts, trades: parsed.trades }
    : migrateLegacyAccounts([], parsed.trades, migrationTimestamp(parsed.exportedAt));
  const portfolio = parsed.version === 7
    ? { states: parsed.portfolioPlanState, revisions: parsed.portfolioPlanRevisions, groups: parsed.portfolioAllocationGroups, targets: parsed.portfolioAllocationTargets }
    : parsed.version === 6
      ? migratePortfolioPlanV6({ states: parsed.portfolioPlanState, revisions: parsed.portfolioPlanRevisions, targets: parsed.portfolioAllocationTargets, stocks: parsed.stocks, accounts: migrated.accounts, trades: migrated.trades })
      : { states: [], revisions: [], groups: [], targets: [] };
  return [
    { collection: "accounts", values: migrated.accounts },
    { collection: "stocks", values: parsed.stocks },
    { collection: "plans", values: parsed.plans },
    { collection: "trades", values: migrated.trades.map(normalizeTrade) },
    { collection: "observations", values: (extended?.observations ?? []).map(normalizeObservation) },
    { collection: "reviews", values: extended?.reviews ?? [] },
    { collection: "rules", values: extended?.rules ?? [] },
    { collection: "notes", values: current?.notes ?? [] },
    { collection: "language-preferences", values: current ? [{ ...fallbackLanguagePreference, locale: current.language, updatedAt: new Date().toISOString() }] as LanguagePreference[] : [fallbackLanguagePreference] },
    { collection: "dashboard-notes", values: current?.dashboardNotes ?? [emptyDashboardNote] },
    { collection: "earnings-events", values: current?.earningsEvents ?? [] },
    { collection: "preferences", values: current?.displayCurrency !== undefined ? [{ ...fallbackCurrencyPreference, displayCurrency: current.displayCurrency, updatedAt: new Date().toISOString() }] as CurrencyPreference[] : [fallbackCurrencyPreference] },
    { collection: "portfolio-plan-state", values: portfolio.states },
    { collection: "portfolio-plan-revisions", values: portfolio.revisions },
    { collection: "portfolio-allocation-groups", values: portfolio.groups },
    { collection: "portfolio-allocation-targets", values: portfolio.targets },
  ];
}

export async function restoreBackup(current: BackupV5 | BackupV6 | BackupV7, backup: ValidatedBackup) {
  await saveCollectionsAtomically([snapshotWrite(current), ...backupWrites(backup)], { resolveCorruption: true, source: "backupRestore" });
}

export function snapshotWrite(backup: BackupV5 | BackupV6 | BackupV7): CollectionWrite {
  const now = new Date().toISOString();
  return { collection: restoreSnapshotCollection, values: [{ id: "latest", content: JSON.stringify(backup), createdAt: now, updatedAt: now } as RestoreSnapshot] };
}

export function backupCounts(backup: ValidatedBackup) {
  const accounts = backup.version === 5 || backup.version === 6 || backup.version === 7
    ? backup.accounts.length
    : migrateLegacyAccounts([], backup.trades, migrationTimestamp(backup.exportedAt)).accounts.length;
  return {
    accounts,
    stocks: backup.stocks.length,
    plans: backup.plans.length,
    trades: backup.trades.length,
    observations: backup.version === 1 ? 0 : backup.observations.length,
    reviews: backup.version === 1 ? 0 : backup.reviews.length,
    notes: backup.version === 4 || backup.version === 5 || backup.version === 6 || backup.version === 7 ? backup.notes.length : 0,
    portfolioPlan: backup.version === 6 || backup.version === 7 ? backup.portfolioPlanRevisions.length : 0,
    portfolioAllocationGroups: backup.version === 7 ? backup.portfolioAllocationGroups.length : 0,
  };
}

function migrationTimestamp(exportedAt: string) {
  return Number.isFinite(Date.parse(exportedAt)) ? new Date(exportedAt).toISOString() : "1970-01-01T00:00:00.000Z";
}
