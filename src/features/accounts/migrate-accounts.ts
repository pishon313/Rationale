import type { Currency } from "@/domain/currency";
import type { Trade } from "@/features/trades/types";
import { saveCollectionsAtomically, type CollectionWrite } from "@/lib/local-repository";
import { normalizeLegacyAccountName, type InvestmentAccount } from "./types";

type SaveMigration = (writes: readonly CollectionWrite[]) => Promise<void>;
export type AccountMigration = { accounts: InvestmentAccount[]; trades: Trade[]; changed: boolean };

export function migrateLegacyAccounts(inputAccounts: InvestmentAccount[], inputTrades: Trade[], now = new Date().toISOString()): AccountMigration {
  const accounts = inputAccounts.map((account) => ({ ...account }));
  const byName = new Map<string, InvestmentAccount[]>();
  for (const account of accounts) {
    const name = normalizeLegacyAccountName(account.name);
    byName.set(name, [...(byName.get(name) ?? []), account]);
  }
  const names = [...new Set(inputTrades.filter((trade) => !trade.accountId?.trim()).map((trade) => normalizeLegacyAccountName(trade.accountName)))].sort();
  let changed = false;
  const defaultExists = accounts.some((account) => account.isDefault && !account.archivedAt);
  for (const name of names) {
    const matches = byName.get(name) ?? [];
    if (matches.length > 1) throw new Error(`동일한 이름의 계좌가 여러 개라 기존 거래를 연결할 수 없습니다: ${name}`);
    if (matches.length === 1) continue;
    const id = deterministicLegacyAccountId(name);
    const collision = accounts.find((account) => account.id === id);
    if (collision && normalizeLegacyAccountName(collision.name) !== name) throw new Error(`계좌 ID 충돌을 해결할 수 없습니다: ${name}`);
    const trade = inputTrades.find((item) => normalizeLegacyAccountName(item.accountName) === name);
    const account: InvestmentAccount = {
      id, name, institution: "", kind: "brokerage", subtype: "", baseCurrency: trade?.currency ?? ("KRW" as Currency),
      isDefault: !defaultExists && accounts.length === 0 && name === (names.includes("기본 계좌") ? "기본 계좌" : names[0]),
      archivedAt: null, memo: "", createdAt: now, updatedAt: now,
    };
    accounts.push(account);
    byName.set(name, [account]);
    changed = true;
  }
  const trades = inputTrades.map((trade) => {
    if (trade.accountId?.trim()) return trade;
    const name = normalizeLegacyAccountName(trade.accountName);
    const account = byName.get(name)?.[0];
    if (!account) throw new Error(`기존 거래의 계좌를 생성하지 못했습니다: ${name}`);
    changed = true;
    return { ...trade, accountId: account.id, accountName: name, updatedAt: trade.updatedAt ?? trade.createdAt };
  });
  return { accounts, trades, changed };
}

export async function persistLegacyAccountMigration(accounts: InvestmentAccount[], trades: Trade[], save: SaveMigration = saveCollectionsAtomically) {
  const migration = migrateLegacyAccounts(accounts, trades);
  if (!migration.changed) return migration;
  await save([{ collection: "accounts", values: migration.accounts }, { collection: "trades", values: migration.trades }]);
  return migration;
}

export function deterministicLegacyAccountId(name: string) {
  const value = normalizeLegacyAccountName(name);
  let first = 2166136261;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  return `account-legacy-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}
