import type { RatesToKrw } from "./currency";
import type { TradingLedger } from "./trading-ledger";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { accountIdentity, type InvestmentAccount } from "@/features/accounts/types";

export type AccountPerformance = {
  accountId: string;
  accountName: string;
  cashKrw: number | null;
  marketValueKrw: number;
  investedCostKrw: number;
  realizedProfitKrw: number;
  unrealizedProfitKrw: number;
  netTradeCapitalKrw: number;
  openPositionCount: number;
  totalAssetsKrw: number | null;
  netContributionsKrw: null;
  reconciliationAdjustmentKrw: null;
  performanceBasisKrw: null;
  totalProfitKrw: null;
  totalReturnPercent: null;
  xirrPercent: null;
  unpricedPositionCount: number;
};

export type LongTermPerformance = AccountPerformance & { accounts: AccountPerformance[] };

type CashFlow = { date: Date; amount: number };

export function buildLongTermPerformance(trades: Trade[], stocks: Stock[], ledger: TradingLedger, rates: RatesToKrw, _asOf = new Date(), accountEntities: readonly InvestmentAccount[] = []): LongTermPerformance {
  void _asOf;
  const active = trades.filter((trade) => !trade.deletedAt && !ledger.calculations[trade.id]?.error);
  const stockById = new Map(stocks.filter((stock) => !stock.deletedAt).map((stock) => [stock.id, stock]));
  const names = new Map(accountEntities.map((account) => [account.id, account.name]));
  const archivedAccountIds = new Set(accountEntities.filter((account) => account.archivedAt).map((account) => account.id));
  ledger.cashBalances.forEach((balance) => names.set(balance.accountId, balance.accountName));
  ledger.positions.forEach((position) => names.set(position.accountId, position.accountName));
  active.forEach((trade) => { const id = accountIdentity(trade); if (!names.has(id)) names.set(id, trade.accountName); });
  const accounts = [...names].sort(([, a], [, b]) => a.localeCompare(b)).map(([accountId, accountName]) => buildAccount(accountId, accountName, stockById, ledger, rates, archivedAccountIds.has(accountId)));
  const aggregate = aggregateAccounts(accounts);
  return { accountId: "all", accountName: "전체 계좌", ...aggregate, accounts };
}

function buildAccount(accountId: string, accountName: string, stocks: Map<string, Stock>, ledger: TradingLedger, rates: RatesToKrw, archived: boolean): AccountPerformance {
  const accountCash = ledger.cashBalances.filter((balance) => balance.accountId === accountId);
  const cashKrw = archived
    ? 0
    : accountCash.length
    ? accountCash.reduce((sum, balance) => sum + balance.balance * rates[balance.currency], 0)
    : null;
  let marketValueKrw = 0;
  let investedCostKrw = 0;
  let realizedProfitKrw = 0;
  let openPositionCount = 0;
  let unpricedPositionCount = 0;
  for (const position of ledger.positions.filter((item) => item.accountId === accountId)) {
    realizedProfitKrw += position.realizedProfitKrw;
    if (position.quantity <= 0) continue;
    investedCostKrw += position.investedAmountKrw;
    openPositionCount += 1;
    const price = stocks.get(position.stockId)?.currentPrice ?? 0;
    if (price > 0) marketValueKrw += position.quantity * price * rates[position.currency];
    else {
      marketValueKrw += position.investedAmountKrw;
      unpricedPositionCount += 1;
    }
  }
  const netTradeCapitalKrw = ledger.tradeCapitalBalances
    .filter((balance) => balance.accountId === accountId)
    .reduce((sum, balance) => sum + balance.netAmountKrw, 0);
  return {
    accountId, accountName,
    cashKrw,
    marketValueKrw,
    investedCostKrw,
    realizedProfitKrw,
    unrealizedProfitKrw: marketValueKrw - investedCostKrw,
    netTradeCapitalKrw,
    openPositionCount,
    totalAssetsKrw: cashKrw === null ? null : cashKrw + marketValueKrw,
    netContributionsKrw: null,
    reconciliationAdjustmentKrw: null,
    performanceBasisKrw: null,
    totalProfitKrw: null,
    totalReturnPercent: null,
    xirrPercent: null,
    unpricedPositionCount,
  };
}

function aggregateAccounts(accounts: AccountPerformance[]): Omit<AccountPerformance, "accountId" | "accountName"> {
  const cashKrw = accounts.length > 0 && accounts.every((account) => account.cashKrw !== null)
    ? sum(accounts.map((account) => account.cashKrw as number))
    : null;
  const marketValueKrw = sum(accounts.map((account) => account.marketValueKrw));
  const investedCostKrw = sum(accounts.map((account) => account.investedCostKrw));
  return {
    cashKrw,
    marketValueKrw,
    investedCostKrw,
    realizedProfitKrw: sum(accounts.map((account) => account.realizedProfitKrw)),
    unrealizedProfitKrw: marketValueKrw - investedCostKrw,
    netTradeCapitalKrw: sum(accounts.map((account) => account.netTradeCapitalKrw)),
    openPositionCount: sum(accounts.map((account) => account.openPositionCount)),
    totalAssetsKrw: cashKrw === null ? null : cashKrw + marketValueKrw,
    netContributionsKrw: null,
    reconciliationAdjustmentKrw: null,
    performanceBasisKrw: null,
    totalProfitKrw: null,
    totalReturnPercent: null,
    xirrPercent: null,
    unpricedPositionCount: sum(accounts.map((account) => account.unpricedPositionCount)),
  };
}

export function calculateXirr(flows: CashFlow[]): number | null {
  const valid = flows.filter((flow) => Number.isFinite(flow.amount) && Number.isFinite(flow.date.getTime()) && flow.amount !== 0).sort((a, b) => a.date.getTime() - b.date.getTime());
  if (valid.length < 2 || valid[0].date.getTime() === valid.at(-1)?.date.getTime() || !valid.some((flow) => flow.amount < 0) || !valid.some((flow) => flow.amount > 0)) return null;
  const origin = valid[0].date.getTime();
  const value = (rate: number) => valid.reduce((total, flow) => total + flow.amount / Math.pow(1 + rate, (flow.date.getTime() - origin) / 86_400_000 / 365), 0);
  let low = -0.9999;
  let high = 10;
  let lowValue = value(low);
  let highValue = value(high);
  while (lowValue * highValue > 0 && high < 1_000_000) { high *= 10; highValue = value(high); }
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) return null;
  for (let index = 0; index < 160; index += 1) {
    const middle = (low + high) / 2;
    const middleValue = value(middle);
    if (Math.abs(middleValue) < 0.000001) return middle * 100;
    if (lowValue * middleValue <= 0) { high = middle; highValue = middleValue; }
    else { low = middle; lowValue = middleValue; }
  }
  return (low + high) / 2 * 100;
}

function sum(values: number[]) { return values.reduce((total, value) => total + value, 0); }
