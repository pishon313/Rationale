import type { RatesToKrw } from "./currency";
import type { TradingLedger } from "./trading-ledger";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { accountIdentity, type InvestmentAccount } from "@/features/accounts/types";

export type AccountPerformance = {
  accountId: string;
  accountName: string;
  cashKrw: number;
  marketValueKrw: number;
  totalAssetsKrw: number;
  netContributionsKrw: number;
  totalProfitKrw: number;
  totalReturnPercent: number | null;
  xirrPercent: number | null;
  unpricedPositionCount: number;
};

export type LongTermPerformance = AccountPerformance & { accounts: AccountPerformance[] };

type CashFlow = { date: Date; amount: number };

export function buildLongTermPerformance(trades: Trade[], stocks: Stock[], ledger: TradingLedger, rates: RatesToKrw, asOf = new Date(), accountEntities: readonly InvestmentAccount[] = []): LongTermPerformance {
  const active = trades.filter((trade) => !trade.deletedAt && !ledger.calculations[trade.id]?.error);
  const stockById = new Map(stocks.filter((stock) => !stock.deletedAt).map((stock) => [stock.id, stock]));
  const names = new Map(accountEntities.map((account) => [account.id, account.name]));
  ledger.cashBalances.forEach((balance) => names.set(balance.accountId, balance.accountName));
  ledger.positions.forEach((position) => names.set(position.accountId, position.accountName));
  active.forEach((trade) => { const id = accountIdentity(trade); if (!names.has(id)) names.set(id, trade.accountName); });
  const accounts = [...names].sort(([, a], [, b]) => a.localeCompare(b)).map(([accountId, accountName]) => buildAccount(accountId, accountName, active, stockById, ledger, rates, asOf));
  const aggregate = aggregateAccounts(accounts, active, ledger, asOf);
  return { accountId: "all", accountName: "전체 계좌", ...aggregate, accounts };
}

function buildAccount(accountId: string, accountName: string, trades: Trade[], stocks: Map<string, Stock>, ledger: TradingLedger, rates: RatesToKrw, asOf: Date): AccountPerformance {
  const cashKrw = ledger.cashBalances
    .filter((balance) => balance.accountId === accountId)
    .reduce((sum, balance) => sum + balance.balance * rates[balance.currency], 0);
  let marketValueKrw = 0;
  let unpricedPositionCount = 0;
  for (const position of ledger.positions.filter((item) => item.accountId === accountId && item.quantity > 0)) {
    const price = stocks.get(position.stockId)?.currentPrice ?? 0;
    if (price > 0) marketValueKrw += position.quantity * price * rates[position.currency];
    else {
      marketValueKrw += position.investedAmountKrw;
      unpricedPositionCount += 1;
    }
  }
  const totalAssetsKrw = cashKrw + marketValueKrw;
  const accountTrades = trades.filter((trade) => accountIdentity(trade) === accountId);
  const flows = contributionFlows(accountTrades, false);
  const netContributionsKrw = normalizeZero(-flows.reduce((sum, flow) => sum + flow.amount, 0));
  const totalProfitKrw = totalAssetsKrw - netContributionsKrw;
  return {
    accountId, accountName,
    cashKrw,
    marketValueKrw,
    totalAssetsKrw,
    netContributionsKrw,
    totalProfitKrw,
    totalReturnPercent: netContributionsKrw > 0 ? totalProfitKrw / netContributionsKrw * 100 : null,
    xirrPercent: calculateXirr([...flows, { date: asOf, amount: totalAssetsKrw }]),
    unpricedPositionCount,
  };
}

function aggregateAccounts(accounts: AccountPerformance[], trades: Trade[], ledger: TradingLedger, asOf: Date): Omit<AccountPerformance, "accountId" | "accountName"> {
  const cashKrw = sum(accounts.map((account) => account.cashKrw));
  const marketValueKrw = sum(accounts.map((account) => account.marketValueKrw));
  const totalAssetsKrw = cashKrw + marketValueKrw;
  const flows = contributionFlows(trades.filter((trade) => !ledger.calculations[trade.id]?.error), true);
  const netContributionsKrw = normalizeZero(-sum(flows.map((flow) => flow.amount)));
  const totalProfitKrw = totalAssetsKrw - netContributionsKrw;
  return {
    cashKrw,
    marketValueKrw,
    totalAssetsKrw,
    netContributionsKrw,
    totalProfitKrw,
    totalReturnPercent: netContributionsKrw > 0 ? totalProfitKrw / netContributionsKrw * 100 : null,
    xirrPercent: calculateXirr([...flows, { date: asOf, amount: totalAssetsKrw }]),
    unpricedPositionCount: sum(accounts.map((account) => account.unpricedPositionCount)),
  };
}

function contributionFlows(trades: Trade[], aggregate: boolean): CashFlow[] {
  return trades.flatMap((trade) => {
    const date = new Date(trade.tradedAt);
    if (!Number.isFinite(date.getTime())) return [];
    const kind = trade.cashFlowKind ?? (trade.isOpeningPosition ? "opening" : "external");
    if (kind === "reconciliation" || aggregate && kind === "transfer") return [];
    if (trade.tradeType === "입금") return [{ date, amount: -(trade.amount ?? 0) * trade.exchangeRate }];
    if (trade.tradeType === "출금") return [{ date, amount: (trade.amount ?? 0) * trade.exchangeRate }];
    if (trade.isOpeningPosition && trade.tradeType === "매수") {
      return [{ date, amount: -(trade.quantity * trade.price + trade.fee + trade.tax) * trade.exchangeRate }];
    }
    return [];
  });
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
function normalizeZero(value: number) { return Object.is(value, -0) ? 0 : value; }
