"use client";

import { useCallback, useEffect, useState } from "react";
import { sampleStocks } from "./sample-data";
import type { Stock } from "./types";
import { loadCollection, saveCollection } from "@/lib/local-repository";
import { sampleTrades } from "@/features/trades/sample-data";
import type { Trade } from "@/features/trades/types";
import { migrateTrades, projectStocksFromTrades } from "@/features/trades/migrate-trades";
import { buildTradingLedger } from "@/domain/trading-ledger";

export function useStockStore() {
  const [stocks, setStocks] = useState<Stock[]>(sampleStocks);
  const [trades, setTrades] = useState<Trade[]>(sampleTrades);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([loadCollection("stocks", sampleStocks), loadCollection("trades", sampleTrades)]).then(([stockValues, tradeValues]) => { if (active) { setStocks(stockValues); setTrades(tradeValues); setReady(true); } });
    return () => { active = false; };
  }, []);

  const persist = useCallback((updater: (current: Stock[]) => Stock[]) => {
    setStocks((current) => {
      const next = updater(current);
      void saveCollection("stocks", next);
      return next;
    });
  }, []);

  const projectedStocks = projectStocksFromTrades(stocks, trades);
  const openStockIds = new Set(buildTradingLedger(migrateTrades(stocks, trades).trades).positions.filter((position) => position.quantity > 0).map((position) => position.stockId));
  const visibleStocks = projectedStocks.filter((stock) => !stock.deletedAt || stock.quantity > 0 || openStockIds.has(stock.id));

  return {
    stocks: visibleStocks, ready,
    addStock: (stock: Stock) => persist((current) => [stock, ...current]),
    updateStock: (stock: Stock) => persist((current) => current.map((item) => item.id === stock.id ? stock : item)),
    deleteStock: (id: string) => {
      if ((projectedStocks.find((stock) => stock.id === id)?.quantity ?? 0) > 0 || openStockIds.has(id)) return false;
      persist((current) => current.map((item) => item.id === id ? { ...item, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : item));
      return true;
    },
  };
}
