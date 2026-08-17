"use client";

import type { Stock } from "./types";
import type { Trade } from "@/features/trades/types";
import type { InvestmentAccount } from "@/features/accounts/types";
import { migrateTrades, projectStocksFromTrades } from "@/features/trades/migrate-trades";
import { buildTradingLedger } from "@/domain/trading-ledger";
import { useLocalCollection } from "@/lib/use-local-collection";
import { buildStockAccountHoldings } from "./stock-account-holdings";
import { correctStockCurrency } from "./stock-currency-correction";

export function useStockStore() {
  const stockStore = useLocalCollection<Stock>("stocks", []);
  const tradeStore = useLocalCollection<Trade>("trades", []);
  const accountStore = useLocalCollection<InvestmentAccount>("accounts", []);
  const stocks = stockStore.allItems;
  const trades = tradeStore.allItems;

  const migratedTrades = migrateTrades(stocks, trades).trades;
  const ledger = buildTradingLedger(migratedTrades, accountStore.allItems);
  const accountHoldingsByStockId = buildStockAccountHoldings(ledger);
  const projectedStocks = projectStocksFromTrades(stocks, trades);
  const openStockIds = new Set(ledger.positions.filter((position) => position.quantity > 0).map((position) => position.stockId));
  const visibleStocks = projectedStocks.filter((stock) => !stock.deletedAt || stock.quantity > 0 || openStockIds.has(stock.id));

  return {
    stocks: visibleStocks,
    allStocks: stocks,
    trades: migratedTrades,
    storedTrades: trades,
    accounts: accountStore.allItems,
    ledger,
    accountHoldingsByStockId,
    ready: stockStore.ready && tradeStore.ready && accountStore.ready,
    addStock: stockStore.add,
    updateStock: stockStore.update,
    replaceStocksAsync: stockStore.replaceAsync,
    updateStocksAsync: stockStore.updateManyAsync,
    correctStockCurrency: async (desiredStock: Stock) => {
      const currentStock = stocks.find((item) => item.id === desiredStock.id);
      if (!currentStock) throw new Error("수정할 종목을 찾지 못했습니다.");
      const result = await correctStockCurrency({ stock: currentStock, desiredStock, stocks, trades, accounts: accountStore.allItems });
      if (result.changed) {
        stockStore.applyCommitted(result.stocks);
        tradeStore.applyCommitted(result.trades);
      }
      return result;
    },
    replaceTradesAsync: tradeStore.replaceAsync,
    deleteStock: (id: string) => {
      if ((projectedStocks.find((stock) => stock.id === id)?.quantity ?? 0) > 0 || openStockIds.has(id)) return false;
      const stock = stocks.find((item) => item.id === id);
      if (stock) stockStore.update({ ...stock, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      return true;
    },
  };
}
