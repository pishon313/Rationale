"use client";
import { useCallback, useEffect, useState } from "react";
import { currencies, fallbackCurrencyPreference, fallbackExchangeRates, fetchLatestRates, type Currency } from "@/domain/currency";
import { useLocalCollection } from "./use-local-collection";

export function useExchangeRates() {
  const store = useLocalCollection("exchange-rates", [fallbackExchangeRates]);
  const replaceAsync = store.replaceAsync;
  const snapshot = store.items[0] ?? fallbackExchangeRates;
  const [refreshing, setRefreshing] = useState(false);
  const [onlineError, setOnlineError] = useState("");
  const refresh = useCallback(async () => {
    setRefreshing(true); setOnlineError("");
    try { const next = await fetchLatestRates(); await replaceAsync([next]); return next; }
    catch { setOnlineError("인터넷 연결이 없어 마지막 저장 환율을 사용합니다."); return null; }
    finally { setRefreshing(false); }
  }, [replaceAsync]);
  useEffect(() => {
    if (!store.ready || refreshing || typeof navigator !== "undefined" && !navigator.onLine) return;
    const age = snapshot.fetchedAt ? Date.now() - Date.parse(snapshot.fetchedAt) : Number.POSITIVE_INFINITY;
    if (age <= 6 * 60 * 60 * 1000) return;
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timeout);
  }, [refresh, refreshing, snapshot.fetchedAt, store.ready]);
  return { snapshot, ready: store.ready, refreshing, onlineError, refresh };
}

export function useCurrencyPreference() {
  const store = useLocalCollection("preferences", [fallbackCurrencyPreference]);
  const preference = store.items[0] ?? fallbackCurrencyPreference;
  async function setDisplayCurrency(displayCurrency: Currency) { if (!currencies.includes(displayCurrency)) return; await store.replaceAsync([{ id: "currency", displayCurrency, updatedAt: new Date().toISOString() }]); }
  return { displayCurrency: preference.displayCurrency, ready: store.ready, setDisplayCurrency };
}
