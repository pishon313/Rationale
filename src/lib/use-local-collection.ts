"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadCollection, saveCollection } from "./local-repository";

export type LocalRecord = { id: string; updatedAt?: string; deletedAt?: string | null };

export function useLocalCollection<T extends LocalRecord>(name: string, fallback: T[]) {
  const initialItems = useRef(fallback);
  const [items, setItems] = useState<T[]>(fallback);
  const latestItems = useRef(fallback);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let active = true;
    loadCollection(name, initialItems.current)
      .then((value) => { if (active) { latestItems.current = value; setItems(value); setReady(true); setLoadError(""); } })
      .catch(() => { if (active) setLoadError("기록을 불러오지 못했습니다."); });
    return () => { active = false; };
  }, [name]);
  const commit = useCallback((update: (current: T[]) => T[]) => {
    const next = update(latestItems.current);
    latestItems.current = next;
    setItems(next);
    void saveCollection(name, next).catch(() => undefined);
  }, [name]);
  const replaceAsync = useCallback(async (next: T[]) => {
    await saveCollection(name, next);
    latestItems.current = next;
    setItems(next);
  }, [name]);
  const applyCommitted = useCallback((next: T[]) => {
    latestItems.current = next;
    setItems(next);
  }, []);
  const updateManyAsync = useCallback(async (updates: ReadonlyMap<string, T>) => {
    const next = latestItems.current.map((item) => updates.get(item.id) ?? item);
    await saveCollection(name, next); latestItems.current = next; setItems(next);
  }, [name]);
  return {
    items: items.filter((item) => !item.deletedAt), allItems: items, ready, loadError,
    add: (item: T) => commit((current) => [item, ...current]),
    update: (item: T) => commit((current) => current.map((value) => value.id === item.id ? item : value)),
    remove: (id: string) => commit((current) => current.map((value) => value.id === id ? { ...value, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : value)),
    replaceAsync, applyCommitted, updateManyAsync,
  };
}
