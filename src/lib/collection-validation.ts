import { currencies } from "@/domain/currency";
import { validateBackupCollectionRecord, validateBackupPayload } from "@/features/settings/backup";
import { isLocale } from "@/i18n/types";
import { importFields, type ColumnReference, type ImportMappingProfile } from "@/features/import/import-types";
import type { TradeLedgerResetSnapshotV1 } from "@/features/trades/trade-ledger-reset";

export type CollectionValidationErrorType = "INVALID_COLLECTION_SHAPE" | "INVALID_RECORD";
export type CollectionValidationResult = { valid: true } | { valid: false; errorType: CollectionValidationErrorType; index?: number };

const backupCollections = new Set(["accounts", "stocks", "plans", "trades", "observations", "reviews", "rules", "notes", "dashboard-notes", "earnings-events", "portfolio-plan-state", "portfolio-plan-revisions", "portfolio-allocation-targets"]);

export function validateStoredCollection(collection: string, value: unknown): CollectionValidationResult {
  if (!Array.isArray(value)) return { valid: false, errorType: "INVALID_COLLECTION_SHAPE" };
  if (collection === "trade-ledger-reset-snapshots" && value.length > 1) return { valid: false, errorType: "INVALID_COLLECTION_SHAPE" };
  const ids = new Set<string>();
  for (const [index, item] of value.entries()) {
    try {
      validateStoredRecord(collection, item, index);
      const id = (item as { id: string }).id;
      if (ids.has(id)) throw new Error("duplicate id");
      ids.add(id);
    } catch {
      return { valid: false, errorType: "INVALID_RECORD", index };
    }
  }
  return { valid: true };
}

export function validateStoredRecord(collection: string, value: unknown, index: number): void {
  requireRecordWithId(value);
  if (backupCollections.has(collection)) {
    validateBackupCollectionRecord(collection, value, index);
    return;
  }
  const record = value as Record<string, unknown>;
  switch (collection) {
    case "language-preferences":
      if (record.id !== "language" || !isLocale(record.locale) || !isTimestampOrEmpty(record.updatedAt)) throw new Error("invalid language preference");
      break;
    case "preferences":
      if (record.id !== "currency" || !currencies.includes(record.displayCurrency as typeof currencies[number]) || !isTimestampOrEmpty(record.updatedAt)) throw new Error("invalid currency preference");
      break;
    case "exchange-rates":
      validateExchangeRates(record);
      break;
    case "restore-snapshots":
      if (record.id !== "latest" || typeof record.content !== "string" || !isTimestamp(record.createdAt) || !isTimestamp(record.updatedAt)) throw new Error("invalid restore snapshot");
      validateBackupPayload(JSON.parse(record.content));
      break;
    case "import-mapping-profiles":
      validateImportMappingProfile(record as ImportMappingProfile);
      break;
    case "trade-ledger-reset-snapshots":
      validateTradeLedgerResetSnapshot(record as TradeLedgerResetSnapshotV1);
      break;
  }
}

function validateTradeLedgerResetSnapshot(snapshot: TradeLedgerResetSnapshotV1) {
  const allowedKeys = new Set(["id", "version", "resetAt", "tradeIds", "createdAt", "updatedAt"]);
  if (Object.keys(snapshot).some((key) => !allowedKeys.has(key))) throw new Error("invalid trade ledger reset snapshot field");
  if (snapshot.id !== "latest" || snapshot.version !== 1 || !isTimestamp(snapshot.resetAt) || !isTimestamp(snapshot.createdAt) || !isTimestamp(snapshot.updatedAt)) throw new Error("invalid trade ledger reset snapshot");
  if (!Array.isArray(snapshot.tradeIds) || snapshot.tradeIds.length === 0 || snapshot.tradeIds.length > 100_000) throw new Error("invalid trade ledger reset trade ids");
  if (snapshot.tradeIds.some((id) => typeof id !== "string" || !id.trim()) || new Set(snapshot.tradeIds).size !== snapshot.tradeIds.length) throw new Error("invalid trade ledger reset trade ids");
}

function validateImportMappingProfile(profile: ImportMappingProfile) {
  const allowedProfileKeys = new Set(["id", "name", "version", "bindings", "headerSignature", "createdAt", "updatedAt"]);
  if (Object.keys(profile).some((key) => !allowedProfileKeys.has(key))) throw new Error("invalid import mapping profile field");
  if (!profile.name.trim() || profile.version !== 1 || !profile.headerSignature || !isTimestamp(profile.createdAt) || !isTimestamp(profile.updatedAt) || !profile.bindings || typeof profile.bindings !== "object" || Array.isArray(profile.bindings)) throw new Error("invalid import mapping profile");
  for (const [field, reference] of Object.entries(profile.bindings)) {
    if (!(importFields as readonly string[]).includes(field) || !validColumnReference(reference as ColumnReference)) throw new Error("invalid import mapping binding");
  }
}

function validColumnReference(value: ColumnReference) {
  return Boolean(value && Object.keys(value).every((key) => key === "normalizedHeader" || key === "occurrence") && typeof value.normalizedHeader === "string" && value.normalizedHeader && Number.isInteger(value.occurrence) && value.occurrence >= 0);
}

function validateExchangeRates(record: Record<string, unknown>) {
  if (record.id !== "latest" || !isTimestamp(record.updatedAt) || !["fallback", "frankfurter"].includes(String(record.source))) throw new Error("invalid exchange rates");
  if (record.rateDate !== null && !isTimestamp(record.rateDate)) throw new Error("invalid rate date");
  if (record.fetchedAt !== null && !isTimestamp(record.fetchedAt)) throw new Error("invalid fetched date");
  if (!record.ratesToKrw || typeof record.ratesToKrw !== "object" || Array.isArray(record.ratesToKrw)) throw new Error("invalid rates");
  for (const currency of currencies) {
    const rate = (record.ratesToKrw as Record<string, unknown>)[currency];
    if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) throw new Error("invalid rate");
  }
}

function requireRecordWithId(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as { id?: unknown }).id !== "string" || !(value as { id: string }).id.trim()) throw new Error("invalid id");
}

function isTimestamp(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function isTimestampOrEmpty(value: unknown) {
  return value === "" || isTimestamp(value);
}
