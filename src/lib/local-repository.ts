import { validateStoredCollection, validateStoredRecord, type CollectionValidationErrorType } from "./collection-validation";
import { migrateStoredCollection } from "./stored-data-migration";
import { isSyncableRecord, toSyncEnvelope } from "@/features/sync/sync-projection";
import type { SyncConflictV1, SyncEntityType, SyncEnvelopeV1, SyncWriteSource } from "@/features/sync/sync-types";

type Identifiable = { id: string; updatedAt?: string };
export type CollectionWrite = { collection: string; values: readonly Identifiable[] };
export type SaveFailurePolicy = "global-retry" | "caller-managed";
export type SaveCollectionsOptions = {
  resolveCorruption?: boolean;
  source?: SyncWriteSource;
  conflicts?: readonly SyncConflictV1[];
  acknowledgedRecordNames?: readonly string[];
  queuedEnvelopes?: readonly SyncEnvelopeV1[];
  failurePolicy?: SaveFailurePolicy;
};
export type PersistenceSnapshot = { pendingWrites: number; error: string | null; canRetry: boolean; lastSavedAt: string | null };
export type CorruptionSource = "localStorage" | "sqlite";
export type CorruptionErrorType = "JSON_PARSE_ERROR" | CollectionValidationErrorType;
export type CorruptedCollection = {
  collection: string;
  source: CorruptionSource;
  detectedAt: string;
  affectedRecordCount: number;
  validRecordCount: number;
  quarantineIds: string[];
  errorType: CorruptionErrorType;
  invalidIndexes: number[];
};
export type CorruptionSnapshot = { collections: CorruptedCollection[] };
type VersionedWrite = CollectionWrite & { generation: number };
type FailedWrite = VersionedWrite & { error: string; failureOrder: number; source: SyncWriteSource; conflicts: readonly SyncConflictV1[]; acknowledgedRecordNames: readonly string[]; queuedEnvelopes: readonly SyncEnvelopeV1[] };

const COLLECTION_STATE = "__tradejournal_collection_state__";
const browserKey = (collection: string) => `tradejournal.${collection}.v1`;
const listeners = new Set<() => void>();
const corruptionListeners = new Set<() => void>();
let persistenceSnapshot: PersistenceSnapshot = { pendingWrites: 0, error: null, canRetry: false, lastSavedAt: null };
let corruptionSnapshot: CorruptionSnapshot = { collections: [] };
let writeQueue: Promise<void> = Promise.resolve();
const collectionGenerations = new Map<string, number>();
const failedWrites = new Map<string, FailedWrite>();
let failureOrder = 0;

export function subscribePersistence(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPersistenceSnapshot() {
  return persistenceSnapshot;
}

export function subscribeCorruption(listener: () => void) {
  corruptionListeners.add(listener);
  return () => corruptionListeners.delete(listener);
}

export function getCorruptionSnapshot() {
  return corruptionSnapshot;
}

export function clearPersistenceError() {
  failedWrites.clear();
  updatePersistence({ error: null, canRetry: false });
}

export function reportPersistenceError(error: unknown, fallback: string) {
  updatePersistence({ error: persistenceErrorMessage(error, fallback), canRetry: false });
}

export async function retryLastSave() {
  discardSupersededFailures();
  const failures = [...failedWrites.values()];
  const retry = failures.map(({ collection, values }) => ({ collection, values }));
  if (!retry.length) {
    updatePersistence({ error: null, canRetry: false });
    return;
  }
  for (const { collection } of retry) failedWrites.delete(collection);
  syncFailureSnapshot();
  const metadata = failures.sort((a, b) => b.failureOrder - a.failureOrder)[0];
  await saveCollectionsAtomically(retry, { source: metadata.source, conflicts: metadata.conflicts, acknowledgedRecordNames: metadata.acknowledgedRecordNames, queuedEnvelopes: metadata.queuedEnvelopes });
}

export function isTauriApp() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function database() {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  return Database.load("sqlite:tradejournal.db");
}

export async function loadCollection<T extends Identifiable>(collection: string, fallback: T[]): Promise<T[]> {
  try {
    if (!isTauriApp()) {
      const saved = localStorage.getItem(browserKey(collection));
      if (saved === null) return fallback;
      let parsed: unknown;
      try { parsed = JSON.parse(saved); }
      catch {
        const quarantineId = quarantineBrowser(collection, saved, "JSON_PARSE_ERROR");
        registerCorruption({ collection, source: "localStorage", affectedRecordCount: 1, validRecordCount: 0, quarantineIds: [quarantineId], errorType: "JSON_PARSE_ERROR", invalidIndexes: [] });
        return fallback;
      }
      parsed = migrateStoredCollection(collection, parsed);
      const validation = validateStoredCollection(collection, parsed);
      if (!validation.valid) {
        const quarantineId = quarantineBrowser(collection, saved, validation.errorType, validation.index);
        registerCorruption({ collection, source: "localStorage", affectedRecordCount: 1, validRecordCount: 0, quarantineIds: [quarantineId], errorType: validation.errorType, invalidIndexes: validation.index === undefined ? [] : [validation.index] });
        return fallback;
      }
      return parsed as T[];
    }
    const db = await database();
    const rows = await db.select<Array<{ id: string; data: string; updated_at: string }>>("SELECT id, data, updated_at FROM app_records WHERE collection = $1 ORDER BY updated_at DESC", [collection]);
    if (rows.length) {
      const valid: T[] = [];
      const corrupt: SqliteQuarantineInput[] = [];
      const invalidIndexes: number[] = [];
      let summaryType: CorruptionErrorType = "INVALID_RECORD";
      for (const [index, row] of rows.entries()) {
        let parsed: unknown;
        let errorType: CorruptionErrorType = "INVALID_RECORD";
        try { parsed = JSON.parse(row.data); }
        catch { errorType = "JSON_PARSE_ERROR"; }
        try {
          if (errorType === "JSON_PARSE_ERROR") throw new Error("parse");
          const migrated = migrateStoredCollection(collection, [parsed]);
          parsed = Array.isArray(migrated) ? migrated[0] : parsed;
          validateStoredRecord(collection, parsed, index);
          if ((parsed as Identifiable).id !== row.id) throw new Error("record id mismatch");
          valid.push(parsed as T);
          continue;
        } catch {
          summaryType = errorType;
          invalidIndexes.push(index);
          corrupt.push({ quarantineId: quarantineIdentifier("sqlite", collection, row.id, row.data), collection, recordId: row.id, rawData: row.data, originalUpdatedAt: row.updated_at, detectedAt: new Date().toISOString(), errorType, itemIndex: index });
        }
      }
      if (corrupt.length) {
        await quarantineSqlite(corrupt);
        registerCorruption({ collection, source: "sqlite", affectedRecordCount: corrupt.length, validRecordCount: valid.length, quarantineIds: corrupt.map((item) => item.quarantineId), errorType: summaryType, invalidIndexes });
      }
      return valid;
    }
    const state = await db.select<Array<{ id: string }>>("SELECT id FROM app_records WHERE collection = $1 AND id = $2 LIMIT 1", [COLLECTION_STATE, collection]);
    if (state.length) return [];
    await saveCollection(collection, fallback);
    return fallback;
  } catch (error) {
    updatePersistence({ error: persistenceErrorMessage(error, "기록을 불러오지 못했습니다."), canRetry: false });
    throw error;
  }
}

export async function saveCollection<T extends Identifiable>(collection: string, values: T[]) {
  await saveCollectionsAtomically([{ collection, values }]);
}

export function saveCollectionsAtomically(writes: readonly CollectionWrite[], options: SaveCollectionsOptions = {}) {
  assertUniqueCollections(writes);
  const failurePolicy = options.failurePolicy ?? "global-retry";
  const blocked = writes.map((write) => write.collection).filter(hasUnresolvedCorruption);
  if (blocked.length && !options.resolveCorruption) {
    const error = new Error(`손상된 데이터의 복구 방법을 선택하기 전에는 저장할 수 없습니다: ${blocked.join(", ")}`);
    if (failurePolicy === "global-retry") updatePersistence({ error: error.message, canRetry: false });
    return Promise.reject(error);
  }
  const prepared = versionWrites(cloneWrites(writes));
  updatePersistence({ pendingWrites: persistenceSnapshot.pendingWrites + 1 });
  const task = writeQueue.catch(() => undefined).then(() => performSave(prepared, options.source ?? "localUser", options.conflicts ?? [], options.acknowledgedRecordNames ?? [], options.queuedEnvelopes ?? []));
  writeQueue = task.then(() => undefined, () => undefined);
  return task.then(
    () => {
      updatePersistence({ lastSavedAt: new Date().toISOString() });
      clearFailuresCoveredBy(prepared);
      if (options.resolveCorruption) resolveCorruption(prepared.map((write) => write.collection));
    },
    (error) => {
      if (failurePolicy === "global-retry") {
        recordFailure(prepared, error, { source: options.source ?? "localUser", conflicts: options.conflicts ?? [], acknowledgedRecordNames: options.acknowledgedRecordNames ?? [], queuedEnvelopes: options.queuedEnvelopes ?? [] });
      }
      throw error;
    },
  ).finally(() => updatePersistence({ pendingWrites: Math.max(0, persistenceSnapshot.pendingWrites - 1) }));
}

export async function resetCorruptedCollection(collection: string) {
  if (!hasUnresolvedCorruption(collection)) return;
  await saveCollectionsAtomically([{ collection, values: [] }], { resolveCorruption: true });
}

export async function resetCorruptedCollections(collections: readonly string[]) {
  const unresolved = [...new Set(collections)].filter(hasUnresolvedCorruption);
  if (!unresolved.length) return;
  await saveCollectionsAtomically(unresolved.map((collection) => ({ collection, values: [] })), { resolveCorruption: true });
}

export function resolveCorruption(collections: readonly string[]) {
  const names = new Set(collections);
  const next = corruptionSnapshot.collections.filter((item) => !names.has(item.collection));
  if (next.length !== corruptionSnapshot.collections.length) updateCorruption({ collections: next });
}

export async function exportQuarantinedData() {
  if (!isTauriApp()) {
    const entries = Object.keys(localStorage)
      .filter((key) => key.startsWith("tradejournal.corrupt."))
      .map((key) => JSON.parse(localStorage.getItem(key) ?? "null"))
      .filter(Boolean);
    return JSON.stringify({ format: "rationale-corrupt-data", exportedAt: new Date().toISOString(), entries }, null, 2);
  }
  const db = await database();
  const entries = await db.select<Array<Record<string, unknown>>>("SELECT quarantine_id, collection, record_id, raw_data, original_updated_at, detected_at, error_type, item_index FROM corrupt_records ORDER BY detected_at DESC");
  return JSON.stringify({ format: "rationale-corrupt-data", exportedAt: new Date().toISOString(), entries }, null, 2);
}

async function performSave(writes: readonly CollectionWrite[], source: SyncWriteSource, conflicts: readonly SyncConflictV1[], acknowledgedRecordNames: readonly string[], queuedEnvelopes: readonly SyncEnvelopeV1[]) {
  if (!isTauriApp()) {
    const previous = new Map(writes.map(({ collection }) => [browserKey(collection), localStorage.getItem(browserKey(collection))]));
    try {
      for (const { collection, values } of writes) localStorage.setItem(browserKey(collection), JSON.stringify(values));
    } catch (error) {
      for (const [key, value] of previous) {
        try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); }
        catch { /* Best-effort rollback when storage itself is unavailable. */ }
      }
      throw error;
    }
    return;
  }
  await database();
  const { invoke } = await import("@tauri-apps/api/core");
  const now = new Date().toISOString();
  const payload = writes.map(({ collection, values }) => ({
    collection,
    records: values.map((value) => ({ id: value.id, data: JSON.stringify(value), updatedAt: value.updatedAt ?? now })),
  }));
  const envelopes = writes.flatMap(({ collection, values }) => !isSyncEntityType(collection) ? [] : values.filter(isSyncableRecord).map((value) => {
    if (collection === "accounts") return toSyncEnvelope(collection, value as never);
    if (collection === "stocks") return toSyncEnvelope(collection, value as never);
    return toSyncEnvelope(collection, value as never);
  }));
  await invoke("save_collections_atomically", { writes: payload, stateUpdatedAt: now, source, envelopes, conflicts, acknowledgedRecordNames, queuedEnvelopes });
}

function isSyncEntityType(value: string): value is SyncEntityType { return value === "accounts" || value === "stocks" || value === "trades"; }

function cloneWrites(writes: readonly CollectionWrite[]): CollectionWrite[] {
  return writes.map(({ collection, values }) => ({ collection, values: JSON.parse(JSON.stringify(values)) as Identifiable[] }));
}

function versionWrites(writes: readonly CollectionWrite[]): VersionedWrite[] {
  return writes.map((write) => {
    const generation = (collectionGenerations.get(write.collection) ?? 0) + 1;
    collectionGenerations.set(write.collection, generation);
    return { ...write, generation };
  });
}

function recordFailure(writes: readonly VersionedWrite[], error: unknown, metadata: Pick<FailedWrite, "source" | "conflicts" | "acknowledgedRecordNames" | "queuedEnvelopes">) {
  const message = persistenceErrorMessage(error, "기록을 저장하지 못했습니다.");
  const order = ++failureOrder;
  for (const write of writes) {
    if (collectionGenerations.get(write.collection) !== write.generation) continue;
    failedWrites.set(write.collection, { ...write, ...metadata, error: message, failureOrder: order });
  }
  syncFailureSnapshot();
}

function clearFailuresCoveredBy(writes: readonly VersionedWrite[]) {
  let changed = false;
  for (const write of writes) {
    const failed = failedWrites.get(write.collection);
    if (failed && failed.generation <= write.generation) {
      failedWrites.delete(write.collection);
      changed = true;
    }
  }
  if (changed) syncFailureSnapshot();
}

function discardSupersededFailures() {
  let changed = false;
  for (const [collection, failed] of failedWrites) {
    if (collectionGenerations.get(collection) !== failed.generation) {
      failedWrites.delete(collection);
      changed = true;
    }
  }
  if (changed) syncFailureSnapshot();
}

function syncFailureSnapshot() {
  const latest = [...failedWrites.values()].sort((a, b) => b.failureOrder - a.failureOrder)[0];
  updatePersistence({ error: latest?.error ?? null, canRetry: Boolean(latest) });
}

function updatePersistence(next: Partial<PersistenceSnapshot>) {
  persistenceSnapshot = { ...persistenceSnapshot, ...next };
  listeners.forEach((listener) => listener());
}

function updateCorruption(next: CorruptionSnapshot) {
  corruptionSnapshot = next;
  corruptionListeners.forEach((listener) => listener());
}

function hasUnresolvedCorruption(collection: string) {
  return corruptionSnapshot.collections.some((item) => item.collection === collection);
}

function registerCorruption(item: Omit<CorruptedCollection, "detectedAt">) {
  const next = corruptionSnapshot.collections.filter((current) => !(current.collection === item.collection && current.source === item.source));
  next.push({ ...item, detectedAt: new Date().toISOString() });
  updateCorruption({ collections: next });
}

type BrowserQuarantine = { quarantineId: string; collection: string; detectedAt: string; originalKey: string; rawData: string; errorType: CorruptionErrorType; itemIndex?: number };
type SqliteQuarantineInput = { quarantineId: string; collection: string; recordId: string; rawData: string; originalUpdatedAt: string; detectedAt: string; errorType: CorruptionErrorType; itemIndex: number };

function quarantineBrowser(collection: string, rawData: string, errorType: CorruptionErrorType, itemIndex?: number) {
  const quarantineId = quarantineIdentifier("localStorage", collection, "", rawData);
  const key = `tradejournal.corrupt.${collection}.${quarantineId}`;
  if (localStorage.getItem(key) === null) {
    const entry: BrowserQuarantine = { quarantineId, collection, detectedAt: new Date().toISOString(), originalKey: browserKey(collection), rawData, errorType, itemIndex };
    localStorage.setItem(key, JSON.stringify(entry));
  }
  return quarantineId;
}

async function quarantineSqlite(entries: SqliteQuarantineInput[]) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("quarantine_corrupt_records", { entries });
}

function quarantineIdentifier(source: CorruptionSource, collection: string, recordId: string, rawData: string) {
  const input = `${source}\u0000${collection}\u0000${recordId}\u0000${rawData}`;
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}${input.length.toString(16)}`;
}

function persistenceErrorMessage(error: unknown, fallback: string) {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  return detail && detail !== "[object Object]" ? `${fallback} ${detail}` : fallback;
}

function assertUniqueCollections(writes: readonly CollectionWrite[]) {
  const names = new Set<string>();
  for (const { collection } of writes) {
    if (!collection.trim()) throw new Error("컬렉션 이름이 비어 있습니다.");
    if (collection === COLLECTION_STATE) throw new Error("예약된 컬렉션 이름입니다.");
    if (names.has(collection)) throw new Error(`중복된 컬렉션 저장 요청입니다: ${collection}`);
    names.add(collection);
  }
}
