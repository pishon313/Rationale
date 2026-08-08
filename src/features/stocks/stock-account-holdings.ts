import type { Currency } from "@/domain/currency";
import type { TradingLedger } from "@/domain/trading-ledger";

export type StockAccountHolding = {
  stockId: string;
  accountId: string;
  accountName: string;
  currency: Currency;
  quantity: number;
  averagePrice: number;
  investedAmount: number;
  investedAmountKrw: number;
};

const openPositionTolerance = 1e-8;

export function buildStockAccountHoldings(ledger: TradingLedger) {
  const grouped = new Map<string, StockAccountHolding>();
  for (const position of ledger.positions) {
    if (position.quantity <= openPositionTolerance) continue;
    const key = JSON.stringify([position.stockId, position.accountId]);
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        stockId: position.stockId,
        accountId: position.accountId,
        accountName: position.accountName,
        currency: position.currency,
        quantity: position.quantity,
        averagePrice: position.averagePrice,
        investedAmount: position.investedAmount,
        investedAmountKrw: position.investedAmountKrw,
      });
      continue;
    }
    const quantity = current.quantity + position.quantity;
    const investedAmount = current.investedAmount + position.investedAmount;
    grouped.set(key, {
      ...current,
      accountName: position.accountName,
      quantity,
      investedAmount,
      investedAmountKrw: current.investedAmountKrw + position.investedAmountKrw,
      averagePrice: quantity > openPositionTolerance ? investedAmount / quantity : 0,
    });
  }

  const result = new Map<string, StockAccountHolding[]>();
  const holdings = [...grouped.values()].sort((left, right) => left.stockId.localeCompare(right.stockId)
    || left.accountName.localeCompare(right.accountName)
    || left.accountId.localeCompare(right.accountId));
  for (const holding of holdings) result.set(holding.stockId, [...(result.get(holding.stockId) ?? []), holding]);
  return result;
}
