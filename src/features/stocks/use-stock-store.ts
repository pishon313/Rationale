"use client";

import { useCallback, useEffect, useState } from "react";
import { sampleStocks } from "./sample-data";
import type { Stock } from "./types";
import { loadCollection, saveCollection } from "@/lib/local-repository";

export function useStockStore() {
  const [stocks, setStocks] = useState<Stock[]>(sampleStocks);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    loadCollection("stocks", sampleStocks).then((value) => { if (active) { setStocks(value); setReady(true); } });
    return () => { active = false; };
  }, []);

  const persist = useCallback((updater: (current: Stock[]) => Stock[]) => {
    setStocks((current) => {
      const next = updater(current);
      void saveCollection("stocks", next);
      return next;
    });
  }, []);

  return {
    stocks: stocks.filter((stock) => !stock.deletedAt), ready,
    addStock: (stock: Stock) => persist((current) => [stock, ...current]),
    updateStock: (stock: Stock) => persist((current) => current.map((item) => item.id === stock.id ? stock : item)),
    deleteStock: (id: string) => persist((current) => current.map((item) => item.id === id ? { ...item, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : item)),
  };
}
