import { fetchHistoricalRateToKrw, type Currency } from "@/domain/currency";
import { aggregatePositions, buildTradingLedger } from "@/domain/trading-ledger";
import { validateTransferPairs } from "@/features/accounts/account-transfer";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Trade } from "@/features/trades/types";
import { saveCollectionsAtomically, type CollectionWrite } from "@/lib/local-repository";
import type { Stock } from "./types";

export type StockCurrencyCorrectionAnalysis = {
  oldCurrency: Currency;
  newCurrency: Currency;
  securityTrades: Trade[];
  securityTradeCount: number;
  affectedAccountIds: string[];
  uniqueTradeDates: string[];
  hasMixedCurrencyConflict: boolean;
};

export type StockCurrencyCorrectionResult = {
  changed: boolean;
  analysis: StockCurrencyCorrectionAnalysis;
  stocks: Stock[];
  trades: Trade[];
  stock: Stock;
};

type FetchHistoricalRate = typeof fetchHistoricalRateToKrw;
type SaveAtomically = (writes: readonly CollectionWrite[]) => Promise<void>;

export class StockCurrencyCorrectionError extends Error {
  constructor(public readonly code: "MIXED_CURRENCY" | "HISTORICAL_FX" | "LEDGER_INVALID" | "INVARIANT", message: string, public readonly tradeDate?: string) {
    super(message);
    this.name = "StockCurrencyCorrectionError";
  }
}

export function analyzeStockCurrencyCorrection({ stock, trades, newCurrency }: { stock: Stock; trades: readonly Trade[]; newCurrency: Currency }): StockCurrencyCorrectionAnalysis {
  const securityTrades = trades.filter((trade) => !trade.deletedAt && trade.stockId === stock.id && isSecurityTrade(trade));
  return {
    oldCurrency: stock.currency,
    newCurrency,
    securityTrades,
    securityTradeCount: securityTrades.length,
    affectedAccountIds: [...new Set(securityTrades.map((trade) => trade.accountId ?? trade.accountName))],
    uniqueTradeDates: [...new Set(securityTrades.map(tradeDate))].sort(),
    hasMixedCurrencyConflict: securityTrades.some((trade) => trade.currency !== stock.currency),
  };
}

export async function correctStockCurrency({
  stock,
  desiredStock,
  stocks,
  trades,
  accounts,
  fetchRate = fetchHistoricalRateToKrw,
  saveAtomically = saveCollectionsAtomically,
  now = new Date().toISOString(),
}: {
  stock: Stock;
  desiredStock: Stock;
  stocks: readonly Stock[];
  trades: readonly Trade[];
  accounts: readonly InvestmentAccount[];
  fetchRate?: FetchHistoricalRate;
  saveAtomically?: SaveAtomically;
  now?: string;
}): Promise<StockCurrencyCorrectionResult> {
  const analysis = analyzeStockCurrencyCorrection({ stock, trades, newCurrency: desiredStock.currency });
  if (analysis.oldCurrency === analysis.newCurrency) return { changed: false, analysis, stocks: [...stocks], trades: [...trades], stock: desiredStock };
  if (analysis.hasMixedCurrencyConflict) {
    throw new StockCurrencyCorrectionError("MIXED_CURRENCY", "이 종목에는 서로 다른 통화의 매매 기록이 있어 통화를 자동으로 변경할 수 없습니다. 매매 기록의 통화를 먼저 확인해 주세요.");
  }

  const rates = new Map<string, number>();
  if (analysis.newCurrency === "KRW") {
    for (const date of analysis.uniqueTradeDates) rates.set(date, 1);
  } else {
    for (const date of analysis.uniqueTradeDates) {
      try {
        const result = await fetchRate(analysis.newCurrency, date);
        if (!Number.isFinite(result.rate) || result.rate <= 0) throw new Error("invalid historical rate");
        rates.set(date, result.rate);
      } catch {
        throw new StockCurrencyCorrectionError("HISTORICAL_FX", `${date} 거래의 과거 환율을 확인하지 못해 통화를 변경하지 않았습니다.`, date);
      }
    }
  }

  const targetIds = new Set(analysis.securityTrades.map((trade) => trade.id));
  const candidateTrades = trades.map((trade) => targetIds.has(trade.id) ? {
    ...trade,
    currency: analysis.newCurrency,
    exchangeRate: rates.get(tradeDate(trade)) ?? 1,
    updatedAt: now,
  } : trade);
  validateTransferPairs(candidateTrades);

  const previousLedger = buildTradingLedger([...trades], accounts);
  const candidateLedger = buildTradingLedger(candidateTrades, accounts);
  const previousErrors = new Set(previousLedger.errors.map((error) => `${error.tradeId}\u0000${error.message}`));
  const introducedError = candidateLedger.errors.find((error) => !previousErrors.has(`${error.tradeId}\u0000${error.message}`));
  if (introducedError) throw new StockCurrencyCorrectionError("LEDGER_INVALID", introducedError.message);
  assertSecurityEconomicsPreserved(stock.id, previousLedger, candidateLedger);

  const position = aggregatePositions(candidateLedger).get(stock.id);
  const candidateStock: Stock = {
    ...desiredStock,
    currency: analysis.newCurrency,
    quantity: analysis.securityTradeCount ? position?.quantity ?? 0 : desiredStock.quantity,
    averagePrice: analysis.securityTradeCount ? position?.averagePrice ?? 0 : desiredStock.averagePrice,
    updatedAt: now,
  };
  const candidateStocks = stocks.map((item) => item.id === stock.id ? candidateStock : item);
  await saveAtomically([
    { collection: "stocks", values: candidateStocks },
    { collection: "trades", values: candidateTrades },
  ]);
  return { changed: true, analysis, stocks: candidateStocks, trades: candidateTrades, stock: candidateStock };
}

function assertSecurityEconomicsPreserved(stockId: string, before: ReturnType<typeof buildTradingLedger>, after: ReturnType<typeof buildTradingLedger>) {
  const summarize = (ledger: ReturnType<typeof buildTradingLedger>) => {
    const result = new Map<string, { quantity: number; investedAmount: number }>();
    for (const position of ledger.positions.filter((item) => item.stockId === stockId)) {
      const current = result.get(position.accountId) ?? { quantity: 0, investedAmount: 0 };
      current.quantity += position.quantity;
      current.investedAmount += position.investedAmount;
      result.set(position.accountId, current);
    }
    return result;
  };
  const beforePositions = summarize(before);
  const afterPositions = summarize(after);
  if (beforePositions.size !== afterPositions.size) throw new StockCurrencyCorrectionError("INVARIANT", "통화 변경 전후의 포지션 구성이 일치하지 않습니다.");
  for (const [accountId, previous] of beforePositions) {
    const next = afterPositions.get(accountId);
    if (!next || !nearlyEqual(previous.quantity, next.quantity) || !nearlyEqual(previous.investedAmount, next.investedAmount)) {
      throw new StockCurrencyCorrectionError("INVARIANT", "통화 변경 전후의 수량 또는 평균단가가 일치하지 않습니다.");
    }
  }
}

function isSecurityTrade(trade: Trade) {
  return trade.tradeType === "매수" || trade.tradeType === "매도";
}

function tradeDate(trade: Trade) {
  return trade.tradedAt.slice(0, 10);
}

function nearlyEqual(left: number, right: number) {
  return Math.abs(left - right) <= Math.max(Math.abs(left), Math.abs(right), 1) * 1e-9;
}
