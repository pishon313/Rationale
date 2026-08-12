import { aggregatePositions, buildTradingLedger, normalizeTrade } from "@/domain/trading-ledger";
import { fallbackRatesToKrw } from "@/domain/currency";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "./types";

export type TradeMigration = { trades: Trade[]; addedOpeningPositions: number; initializedStockIds: string[]; unresolvedStockIds: string[]; warnings: string[] };

export function migrateTrades(stocks: Stock[], input: Trade[]): TradeMigration {
  const trades = input.map(normalizeTrade);
  const active = trades.filter((trade) => !trade.deletedAt);
  const stockTrades = new Set(active.filter((trade) => trade.stockId && (trade.tradeType === "매수" || trade.tradeType === "매도")).map((trade) => trade.stockId as string));
  const ledger = buildTradingLedger(active);
  const projected = aggregatePositions(ledger);
  const opening: Trade[] = [];
  const existingIds = new Set(trades.map((trade) => trade.id));
  const initializedStockIds: string[] = [];
  const unresolvedStockIds: string[] = [];
  const warnings: string[] = [];

  for (const stock of stocks.filter((item) => !item.ledgerInitializedAt && (!item.deletedAt || item.quantity > 0 || stockTrades.has(item.id)))) {
    const position = projected.get(stock.id);
    const ledgerQuantity = position?.quantity ?? 0;
    if (!stockTrades.has(stock.id)) {
      if (stock.quantity > 0) {
        const createdAt = stock.createdAt || new Date(0).toISOString();
        const id = nextOpeningPositionId(stock.id, existingIds);
        existingIds.add(id);
        opening.push({
          id, stockId: stock.id, stockName: stock.name, planId: null,
          tradeType: "매수", tradedAt: createdAt, quantity: stock.quantity, price: stock.averagePrice,
          currency: stock.currency, exchangeRate: fallbackRatesToKrw[stock.currency], fee: 0, tax: 0,
          accountName: stock.openingAccountName?.trim() || "기본 계좌", memo: "기존 보유 포지션 자동 이관", emotion: "평온", emotionIntensity: 1,
          confidenceScore: 3, ruleComplianceScore: 3, isOpeningPosition: true,
          journalStatus: "unreviewed", origin: { kind: "system" },
          createdAt, updatedAt: createdAt, deletedAt: null,
        });
      }
      initializedStockIds.push(stock.id);
    } else {
      const stockHasLedgerError = active.some((trade) => trade.stockId === stock.id && isSecurityTrade(trade) && ledger.calculations[trade.id]?.error);
      const quantityDiffers = Math.abs(ledgerQuantity - stock.quantity) > 1e-8;
      const currencyDiffers = Boolean(position && position.currency !== stock.currency);
      const costDiffers = !quantityDiffers && !currencyDiffers && hasMaterialCostDifference(stock, position?.investedAmount ?? 0, active, ledger);
      if (stockHasLedgerError || quantityDiffers || currencyDiffers || costDiffers) {
        unresolvedStockIds.push(stock.id);
        if (stockHasLedgerError) warnings.push(`${stock.name}: 오류가 있는 매매 기록을 먼저 확인해 주세요.`);
        else if (quantityDiffers) warnings.push(`${stock.name}: 종목 보유 수량 ${stock.quantity}주와 매매 원장 ${ledgerQuantity}주가 다릅니다.`);
        else if (currencyDiffers) warnings.push(`${stock.name}: 종목 통화 ${stock.currency}와 매매 원장 통화 ${position?.currency}가 다릅니다.`);
        else warnings.push(`${stock.name}: 종목 평균단가 ${stock.averagePrice}와 매매 원장 평균단가 ${position?.averagePrice ?? 0}가 다릅니다.`);
      } else {
        initializedStockIds.push(stock.id);
      }
    }
  }
  return { trades: [...opening, ...trades], addedOpeningPositions: opening.length, initializedStockIds, unresolvedStockIds, warnings };
}

function isSecurityTrade(trade: Trade) {
  return trade.tradeType === "매수" || trade.tradeType === "매도";
}

function hasMaterialCostDifference(stock: Stock, ledgerCost: number, trades: Trade[], ledger: ReturnType<typeof buildTradingLedger>) {
  if (stock.quantity <= 1e-8) return false;
  const rawCost = stock.averagePrice * stock.quantity;
  const openCycleTradeIds = new Set(ledger.cycles.filter((cycle) => cycle.stockId === stock.id && !cycle.closedAt).flatMap((cycle) => cycle.tradeIds));
  const buyCosts = trades
    .filter((trade) => trade.stockId === stock.id && trade.tradeType === "매수" && openCycleTradeIds.has(trade.id))
    .reduce((sum, trade) => sum + trade.fee + trade.tax, 0);
  const priceRounding = stock.quantity * (stock.currency === "KRW" || stock.currency === "JPY" ? 0.5 : 0.005);
  const floatingPointTolerance = Math.max(Math.abs(rawCost), Math.abs(ledgerCost), 1) * 1e-8;
  return Math.abs(rawCost - ledgerCost) > buyCosts + priceRounding + floatingPointTolerance;
}

function nextOpeningPositionId(stockId: string, existingIds: Set<string>) {
  const base = `opening-position:${stockId}`;
  if (!existingIds.has(base)) return base;
  let sequence = 2;
  while (existingIds.has(`${base}:${sequence}`)) sequence += 1;
  return `${base}:${sequence}`;
}

export function projectStocksFromTrades(stocks: Stock[], input: Trade[]) {
  const migration = migrateTrades(stocks, input);
  const trades = migration.trades;
  const positions = aggregatePositions(buildTradingLedger(trades));
  const touched = new Set([
    ...stocks.filter((stock) => stock.ledgerInitializedAt).map((stock) => stock.id),
    ...migration.initializedStockIds,
  ]);
  return stocks.map((stock) => {
    if (!touched.has(stock.id)) return stock;
    const position = positions.get(stock.id);
    return { ...stock, quantity: position?.quantity ?? 0, averagePrice: position?.averagePrice ?? 0 };
  });
}
