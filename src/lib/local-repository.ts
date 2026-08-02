type Identifiable = { id: string; updatedAt?: string };
export type CollectionWrite = { collection: string; values: readonly Identifiable[] };
export type PersistenceSnapshot = { pendingWrites: number; error: string | null; canRetry: boolean; lastSavedAt: string | null };

const COLLECTION_STATE = "__tradejournal_collection_state__";
const browserKey = (collection: string) => `tradejournal.${collection}.v1`;
const listeners = new Set<() => void>();
let persistenceSnapshot: PersistenceSnapshot = { pendingWrites: 0, error: null, canRetry: false, lastSavedAt: null };
let writeQueue: Promise<void> = Promise.resolve();
let failedWrites: CollectionWrite[] | null = null;

export function subscribePersistence(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPersistenceSnapshot() {
  return persistenceSnapshot;
}

export function clearPersistenceError() {
  failedWrites = null;
  updatePersistence({ error: null, canRetry: false });
}

export function reportPersistenceError(error: unknown, fallback: string) {
  updatePersistence({ error: persistenceErrorMessage(error, fallback), canRetry: false });
}

export async function retryLastSave() {
  if (!failedWrites) return;
  const retry = failedWrites;
  failedWrites = null;
  updatePersistence({ error: null, canRetry: false });
  await saveCollectionsAtomically(retry);
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
      return saved !== null ? JSON.parse(saved) as T[] : fallback;
    }
    const db = await database();
    const rows = await db.select<Array<{ data: string }>>("SELECT data FROM app_records WHERE collection = $1 ORDER BY updated_at DESC", [collection]);
    if (rows.length) return rows.map((row) => JSON.parse(row.data) as T);
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

export function saveCollectionsAtomically(writes: readonly CollectionWrite[]) {
  assertUniqueCollections(writes);
  const prepared = cloneWrites(writes);
  updatePersistence({ pendingWrites: persistenceSnapshot.pendingWrites + 1 });
  const task = writeQueue.catch(() => undefined).then(() => performSave(prepared));
  writeQueue = task.then(() => undefined, () => undefined);
  return task.then(
    () => {
      updatePersistence({ lastSavedAt: new Date().toISOString() });
      if (failedWrites === prepared) {
        failedWrites = null;
        updatePersistence({ error: null, canRetry: false });
      }
    },
    (error) => {
      failedWrites = prepared;
      updatePersistence({ error: persistenceErrorMessage(error, "기록을 저장하지 못했습니다."), canRetry: true });
      throw error;
    },
  ).finally(() => updatePersistence({ pendingWrites: Math.max(0, persistenceSnapshot.pendingWrites - 1) }));
}

async function performSave(writes: readonly CollectionWrite[]) {
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
  await invoke("save_collections_atomically", { writes: payload, stateUpdatedAt: now });
}

function cloneWrites(writes: readonly CollectionWrite[]): CollectionWrite[] {
  return writes.map(({ collection, values }) => ({ collection, values: JSON.parse(JSON.stringify(values)) as Identifiable[] }));
}

function updatePersistence(next: Partial<PersistenceSnapshot>) {
  persistenceSnapshot = { ...persistenceSnapshot, ...next };
  listeners.forEach((listener) => listener());
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
