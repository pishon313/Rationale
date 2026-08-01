type Identifiable = { id: string; updatedAt?: string };

export function isTauriApp() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function database() {
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  return Database.load("sqlite:tradejournal.db");
}

export async function loadCollection<T extends Identifiable>(collection: string, fallback: T[]): Promise<T[]> {
  if (!isTauriApp()) {
    try { const saved = localStorage.getItem(`tradejournal.${collection}.v1`); return saved ? JSON.parse(saved) as T[] : fallback; }
    catch { return fallback; }
  }
  const db = await database();
  const rows = await db.select<Array<{ data: string }>>("SELECT data FROM app_records WHERE collection = $1 ORDER BY updated_at DESC", [collection]);
  if (rows.length) return rows.map((row) => JSON.parse(row.data) as T);
  await saveCollection(collection, fallback);
  return fallback;
}

export async function saveCollection<T extends Identifiable>(collection: string, values: T[]) {
  if (!isTauriApp()) { localStorage.setItem(`tradejournal.${collection}.v1`, JSON.stringify(values)); return; }
  const db = await database();
  await db.execute("BEGIN");
  try {
    await db.execute("DELETE FROM app_records WHERE collection = $1", [collection]);
    for (const value of values) await db.execute("INSERT INTO app_records (collection, id, data, updated_at) VALUES ($1, $2, $3, $4)", [collection, value.id, JSON.stringify(value), value.updatedAt ?? new Date().toISOString()]);
    await db.execute("COMMIT");
  } catch (error) { await db.execute("ROLLBACK"); throw error; }
}
