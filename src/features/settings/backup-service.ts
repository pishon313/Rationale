import { fallbackCurrencyPreference, type CurrencyPreference } from "@/domain/currency";
import { normalizeTrade } from "@/domain/trading-ledger";
import { emptyDashboardNote } from "@/features/dashboard/dashboard-note";
import type { Note } from "@/features/notes/types";
import type { Observation } from "@/features/observations/types";
import type { BuyPlan } from "@/features/plans/types";
import type { Review } from "@/features/reviews/types";
import type { InvestmentRule } from "@/features/rules/types";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { fallbackLanguagePreference, type LanguagePreference } from "@/i18n/i18n-provider";
import type { Locale } from "@/i18n/types";
import { getCorruptionSnapshot, loadCollection, saveCollectionsAtomically, type CollectionWrite } from "@/lib/local-repository";
import type { DashboardNoteBackup, EarningsEventBackup, ValidatedBackup } from "./backup";

export type BackupV4 = {
  version: 4;
  exportedAt: string;
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

export type RestoreSnapshot = { id: "latest"; content: string; createdAt: string; updatedAt: string };
export const restoreSnapshotCollection = "restore-snapshots";

export async function createBackupPayload(localeOverride?: Locale, options: { allowCorrupted?: boolean } = {}): Promise<BackupV4> {
  const [stocks, plans, trades, observations, reviews, rules, notes, languages, dashboardNotes, earningsEvents, preferences] = await Promise.all([
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
  ]);
  const backupCollections = new Set(["stocks", "plans", "trades", "observations", "reviews", "rules", "notes", "language-preferences", "dashboard-notes", "earnings-events", "preferences"]);
  if (!options.allowCorrupted && getCorruptionSnapshot().collections.some((item) => backupCollections.has(item.collection))) {
    throw new Error("손상된 컬렉션을 복구하기 전에는 불완전한 백업을 만들 수 없습니다.");
  }
  return {
    version: 4,
    exportedAt: new Date().toISOString(),
    stocks,
    plans,
    trades: trades.map(normalizeTrade),
    observations,
    reviews,
    rules,
    notes,
    language: localeOverride ?? languages[0]?.locale ?? fallbackLanguagePreference.locale,
    dashboardNotes,
    earningsEvents,
    displayCurrency: preferences[0]?.displayCurrency ?? fallbackCurrencyPreference.displayCurrency,
  };
}

export function backupWrites(parsed: ValidatedBackup): CollectionWrite[] {
  const extended = parsed.version === 1 ? null : parsed;
  const current = parsed.version === 4 ? parsed : null;
  return [
    { collection: "stocks", values: parsed.stocks },
    { collection: "plans", values: parsed.plans },
    { collection: "trades", values: parsed.trades.map(normalizeTrade) },
    { collection: "observations", values: extended?.observations ?? [] },
    { collection: "reviews", values: extended?.reviews ?? [] },
    { collection: "rules", values: extended?.rules ?? [] },
    { collection: "notes", values: current?.notes ?? [] },
    { collection: "language-preferences", values: current ? [{ ...fallbackLanguagePreference, locale: current.language, updatedAt: new Date().toISOString() }] as LanguagePreference[] : [fallbackLanguagePreference] },
    { collection: "dashboard-notes", values: current?.dashboardNotes ?? [emptyDashboardNote] },
    { collection: "earnings-events", values: current?.earningsEvents ?? [] },
    { collection: "preferences", values: current?.displayCurrency !== undefined ? [{ ...fallbackCurrencyPreference, displayCurrency: current.displayCurrency, updatedAt: new Date().toISOString() }] as CurrencyPreference[] : [fallbackCurrencyPreference] },
  ];
}

export async function restoreBackup(current: BackupV4, backup: ValidatedBackup) {
  await saveCollectionsAtomically([snapshotWrite(current), ...backupWrites(backup)], { resolveCorruption: true });
}

export function snapshotWrite(backup: BackupV4): CollectionWrite {
  const now = new Date().toISOString();
  return { collection: restoreSnapshotCollection, values: [{ id: "latest", content: JSON.stringify(backup), createdAt: now, updatedAt: now } as RestoreSnapshot] };
}

export function backupCounts(backup: ValidatedBackup) {
  return {
    stocks: backup.stocks.length,
    plans: backup.plans.length,
    trades: backup.trades.length,
    observations: backup.version === 1 ? 0 : backup.observations.length,
    reviews: backup.version === 1 ? 0 : backup.reviews.length,
    notes: backup.version === 4 ? backup.notes.length : 0,
  };
}
