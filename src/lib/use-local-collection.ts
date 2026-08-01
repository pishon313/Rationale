"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadCollection, saveCollection } from "./local-repository";

export type LocalRecord = { id: string; updatedAt?: string; deletedAt?: string | null };

export function useLocalCollection<T extends LocalRecord>(name: string, fallback: T[]) {
  const initialItems = useRef(fallback);
  const [items, setItems] = useState<T[]>(fallback);
  const [ready, setReady] = useState(false);
  useEffect(() => { let active = true; loadCollection(name, initialItems.current).then((value) => { if (active) { setItems(value); setReady(true); } }); return () => { active = false; }; }, [name]);
  const commit = useCallback((update: (current: T[]) => T[]) => setItems((current) => { const next = update(current); void saveCollection(name, next); return next; }), [name]);
  const replaceAsync = useCallback(async (next: T[]) => {
    await saveCollection(name, next);
    setItems(next);
  }, [name]);
  return {
    items: items.filter((item) => !item.deletedAt), allItems: items, ready,
    add: (item: T) => commit((current) => [item, ...current]),
    update: (item: T) => commit((current) => current.map((value) => value.id === item.id ? item : value)),
    remove: (id: string) => commit((current) => current.map((value) => value.id === id ? { ...value, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : value)),
    replaceAsync,
  };
}
