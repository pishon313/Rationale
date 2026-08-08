import { buildTradingLedger, type TradingLedger } from "@/domain/trading-ledger";
import type { Trade } from "@/features/trades/types";
import { saveCollectionsAtomically, type CollectionWrite } from "@/lib/local-repository";
import type { InvestmentAccount } from "./types";

export function withSingleDefault(accounts: InvestmentAccount[], account: InvestmentAccount) {
  return [account, ...accounts.filter((item) => item.id !== account.id)].map((item) => ({
    ...item,
    isDefault: item.archivedAt ? false : account.isDefault ? item.id === account.id : item.isDefault,
  }));
}

export function archiveAccount(accounts: InvestmentAccount[], accountId: string, ledger: TradingLedger, now = new Date().toISOString()) {
  const tolerance = 1e-8;
  const hasPosition = ledger.positions.some((position) => position.accountId === accountId && Math.abs(position.quantity) > tolerance);
  const hasCash = ledger.cashBalances.some((balance) => balance.accountId === accountId && Math.abs(balance.balance) > tolerance);
  if (hasPosition || hasCash) throw new Error("이 계좌에는 보유 자산 또는 현금이 남아 있어 보관할 수 없습니다. 보유 자산을 정리하고 현금 잔액을 0으로 맞춘 뒤 다시 시도해 주세요.");
  const next = accounts.map((account) => account.id === accountId ? { ...account, isDefault: false, archivedAt: now, updatedAt: now } : account);
  if (!next.some((account) => !account.archivedAt && account.isDefault)) {
    const first = next.find((account) => !account.archivedAt);
    if (first) first.isDefault = true;
  }
  return next;
}

export function buildAccountMerge(accounts: InvestmentAccount[], trades: Trade[], sourceAccountId: string, targetAccountId: string, now = new Date().toISOString()): CollectionWrite[] {
  if (!sourceAccountId || sourceAccountId === targetAccountId) throw new Error("서로 다른 계좌를 선택해 주세요.");
  const source = accounts.find((account) => account.id === sourceAccountId);
  const target = accounts.find((account) => account.id === targetAccountId && !account.archivedAt);
  if (!source || !target) throw new Error("병합할 활성 계좌를 찾을 수 없습니다.");
  const nextTrades = trades.map((trade) => trade.accountId === sourceAccountId ? { ...trade, accountId: targetAccountId, updatedAt: now } : trade);
  const nextAccounts = accounts.map((account) => account.id === sourceAccountId ? { ...account, archivedAt: now, isDefault: false, updatedAt: now } : account.id === targetAccountId && source.isDefault ? { ...account, isDefault: true, updatedAt: now } : account);
  const before = buildTradingLedger(trades, accounts);
  if (before.errors.length) throw new Error(`계좌 병합 전에 원장 오류를 먼저 해결해 주세요. ${before.errors[0].message}`);
  const after = buildTradingLedger(nextTrades, nextAccounts);
  if (after.errors.length) throw new Error(after.errors[0].message);
  if (!sameLedgerEconomics(before, after)) throw new Error("같은 종목의 거래 이력이 두 계좌에 겹쳐 있어 병합 시 원장 계산 결과가 달라집니다.");
  return [{ collection: "accounts", values: nextAccounts }, { collection: "trades", values: nextTrades }];
}

export async function mergeAccounts(accounts: InvestmentAccount[], trades: Trade[], sourceAccountId: string, targetAccountId: string) {
  await saveCollectionsAtomically(buildAccountMerge(accounts, trades, sourceAccountId, targetAccountId));
}

type EconomicPosition = { stockId: string; currency: string; quantity: number; investedAmountKrw: number; averagePrice: number };
type EconomicCycle = { stockId: string; currency: string; isClosed: boolean; realizedProfitKrw: number };
type EconomicSnapshot = { totalRealizedKrw: number; positions: EconomicPosition[]; cycles: EconomicCycle[] };
const economicTolerance = 1e-8;

export function ledgerEconomicSnapshot(ledger: TradingLedger): EconomicSnapshot {
  const positions = ledger.positions
    .filter((position) => Math.abs(position.quantity) > economicTolerance)
    .map((position) => ({ stockId: position.stockId, currency: position.currency, quantity: position.quantity, investedAmountKrw: position.investedAmountKrw, averagePrice: position.averagePrice }))
    .sort(compareEconomicIdentity);
  const cycles = ledger.cycles
    .map((cycle) => ({ stockId: cycle.stockId, currency: cycle.currency, isClosed: Boolean(cycle.closedAt), realizedProfitKrw: cycle.realizedProfitKrw }))
    .sort(compareEconomicIdentity);
  return { totalRealizedKrw: ledger.totalRealizedKrw, positions, cycles };
}

export function sameLedgerEconomics(before: TradingLedger, after: TradingLedger) {
  const left = ledgerEconomicSnapshot(before); const right = ledgerEconomicSnapshot(after);
  return nearlyEqual(left.totalRealizedKrw, right.totalRealizedKrw)
    && samePositions(left.positions, right.positions)
    && sameCycles(left.cycles, right.cycles);
}

function samePositions(left: EconomicPosition[], right: EconomicPosition[]) {
  return left.length === right.length && left.every((item, index) => item.stockId === right[index]?.stockId
    && item.currency === right[index]?.currency
    && nearlyEqual(item.quantity, right[index].quantity)
    && nearlyEqual(item.investedAmountKrw, right[index].investedAmountKrw)
    && nearlyEqual(item.averagePrice, right[index].averagePrice));
}
function sameCycles(left: EconomicCycle[], right: EconomicCycle[]) {
  return left.length === right.length && left.every((item, index) => item.stockId === right[index]?.stockId
    && item.currency === right[index]?.currency
    && item.isClosed === right[index].isClosed
    && nearlyEqual(item.realizedProfitKrw, right[index].realizedProfitKrw));
}
function nearlyEqual(left: number, right: number) { return Math.abs(left - right) <= economicTolerance; }
function compareEconomicIdentity(left: Pick<EconomicPosition, "stockId" | "currency">, right: Pick<EconomicPosition, "stockId" | "currency">) {
  return left.stockId.localeCompare(right.stockId) || left.currency.localeCompare(right.currency);
}
