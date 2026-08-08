import { buildTradingLedger } from "@/domain/trading-ledger";
import type { Trade } from "@/features/trades/types";
import { saveCollectionsAtomically, type CollectionWrite } from "@/lib/local-repository";
import type { InvestmentAccount } from "./types";

export function withSingleDefault(accounts: InvestmentAccount[], account: InvestmentAccount) {
  return [account, ...accounts.filter((item) => item.id !== account.id)].map((item) => ({
    ...item,
    isDefault: item.archivedAt ? false : account.isDefault ? item.id === account.id : item.isDefault,
  }));
}

export function archiveAccount(accounts: InvestmentAccount[], accountId: string, now = new Date().toISOString()) {
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
  const ledger = buildTradingLedger(nextTrades, nextAccounts);
  if (ledger.errors.length) throw new Error(ledger.errors[0].message);
  return [{ collection: "accounts", values: nextAccounts }, { collection: "trades", values: nextTrades }];
}

export async function mergeAccounts(accounts: InvestmentAccount[], trades: Trade[], sourceAccountId: string, targetAccountId: string) {
  await saveCollectionsAtomically(buildAccountMerge(accounts, trades, sourceAccountId, targetAccountId));
}
