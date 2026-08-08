"use client";

import type { Stock } from "./types";
import type { Trade } from "@/features/trades/types";
import { migrateTrades, projectStocksFromTrades } from "@/features/trades/migrate-trades";
import { buildTradingLedger } from "@/domain/trading-ledger";
import { useLocalCollection } from "@/lib/use-local-collection";

export function useStockStore() {
  const stockStore = useLocalCollection<Stock>("stocks", []);
  const tradeStore = useLocalCollection<Trade>("trades", []);
  const stocks = stockStore.allItems;
  const trades = tradeStore.allItems;

  const projectedStocks = projectStocksFromTrades(stocks, trades);
  const openStockIds = new Set(buildTradingLedger(migrateTrades(stocks, trades).trades).positions.filter((position) => position.quantity > 0).map((position) => position.stockId));
  const visibleStocks = projectedStocks.filter((stock) => !stock.deletedAt || stock.quantity > 0 || openStockIds.has(stock.id));
  const accountNames = [...new Set(migrateTrades(stocks, trades).trades.map((trade) => trade.accountName?.trim()).filter((name): name is string => Boolean(name)))];

  return {
    stocks: visibleStocks, accountNames, ready: stockStore.ready && tradeStore.ready,
    addStock: stockStore.add,
    updateStock: stockStore.update,
    deleteStock: (id: string) => {
      if ((projectedStocks.find((stock) => stock.id === id)?.quantity ?? 0) > 0 || openStockIds.has(id)) return false;
      const stock = stocks.find((item) => item.id === id);
      if (stock) stockStore.update({ ...stock, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      return true;
    },
  };
}
