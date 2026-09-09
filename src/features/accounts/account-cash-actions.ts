import { currencies, type Currency } from "@/domain/currency";
import type { Trade } from "@/features/trades/types";
import { normalizeCashBalance, validateAccountCashTracking } from "./account-cash-tracking";
import { cashTrackingOf, type AccountCashBaselineV1, type InvestmentAccount } from "./types";

export type AccountCashCandidate = {
  accountId: string;
  currency: Currency;
};

export type AccountCashBaselineInput = AccountCashCandidate & {
  balance: string;
  asOf: string;
};

export function cashBaselineFor(account: Pick<InvestmentAccount, "cashTracking">, currency: Currency) {
  return cashTrackingOf(account).baselines.find((baseline) => baseline.currency === currency) ?? null;
}

export function hasCashBaseline(account: Pick<InvestmentAccount, "cashTracking"> | undefined, currency: Currency) {
  return Boolean(account && cashBaselineFor(account, currency));
}

export function candidateAccountCashCurrencies(
  accounts: readonly InvestmentAccount[],
  trades: readonly Trade[],
): AccountCashCandidate[] {
  const activeAccounts = accounts.filter((account) => !account.archivedAt);
  const activeById = new Map(activeAccounts.map((account) => [account.id, account]));
  const candidateKeys = new Set<string>();

  for (const account of activeAccounts) {
    candidateKeys.add(candidateKey(account.id, account.baseCurrency));
    for (const baseline of cashTrackingOf(account).baselines) {
      candidateKeys.add(candidateKey(account.id, baseline.currency));
    }
  }
  for (const trade of trades) {
    if (trade.deletedAt || !trade.accountId || !activeById.has(trade.accountId)) continue;
    candidateKeys.add(candidateKey(trade.accountId, trade.currency));
  }

  return [...candidateKeys]
    .map((key) => {
      const [accountId, currency] = JSON.parse(key) as [string, Currency];
      return { accountId, currency };
    })
    .sort((left, right) => {
      const leftAccount = activeById.get(left.accountId)!;
      const rightAccount = activeById.get(right.accountId)!;
      return Number(rightAccount.isDefault) - Number(leftAccount.isDefault)
        || leftAccount.name.localeCompare(rightAccount.name)
        || left.accountId.localeCompare(right.accountId)
        || Number(right.currency === rightAccount.baseCurrency) - Number(left.currency === leftAccount.baseCurrency)
        || left.currency.localeCompare(right.currency);
    });
}

export function upsertAccountCashBaseline(
  accounts: readonly InvestmentAccount[],
  input: AccountCashBaselineInput,
  now = new Date().toISOString(),
): InvestmentAccount[] {
  const account = requireActiveAccount(accounts, input.accountId);
  if (!currencies.includes(input.currency)) throw new Error("지원하지 않는 통화입니다.");
  const balance = normalizeCashBalance(input.balance);
  if (balance === null) throw new Error("현재 현금은 0 이상의 숫자로 입력해 주세요.");
  const asOf = normalizedTimestamp(input.asOf, "기준 일시를 확인해 주세요.");
  const updatedAt = normalizedTimestamp(now, "수정 일시를 확인해 주세요.");
  const currentTracking = validatedTracking(account);
  const existing = currentTracking.baselines.find((baseline) => baseline.currency === input.currency);
  const nextBaseline: AccountCashBaselineV1 = {
    currency: input.currency,
    balance,
    asOf,
    createdAt: existing?.createdAt ?? updatedAt,
    updatedAt,
  };
  const baselines = existing
    ? currentTracking.baselines.map((baseline) => baseline.currency === input.currency ? nextBaseline : baseline)
    : [...currentTracking.baselines, nextBaseline];
  const tracking = validateAccountCashTracking({ version: 1, baselines });
  if (!tracking.valid) throw new Error(tracking.issues[0]?.message ?? "현재 현금을 저장할 수 없습니다.");

  return accounts.map((item) => item.id === account.id
    ? { ...item, cashTracking: tracking.tracking, updatedAt }
    : item);
}

export function removeAccountCashBaseline(
  accounts: readonly InvestmentAccount[],
  accountId: string,
  currency: Currency,
  now = new Date().toISOString(),
): InvestmentAccount[] {
  const account = requireActiveAccount(accounts, accountId);
  const currentTracking = validatedTracking(account);
  if (!currentTracking.baselines.some((baseline) => baseline.currency === currency)) {
    throw new Error("중단할 현금 추적 정보를 찾을 수 없습니다.");
  }
  const updatedAt = normalizedTimestamp(now, "수정 일시를 확인해 주세요.");
  const result = validateAccountCashTracking({
    version: 1,
    baselines: currentTracking.baselines.filter((baseline) => baseline.currency !== currency),
  });
  if (!result.valid) throw new Error(result.issues[0]?.message ?? "현금 추적을 중단할 수 없습니다.");
  return accounts.map((item) => item.id === account.id
    ? { ...item, cashTracking: result.tracking, updatedAt }
    : item);
}

function validatedTracking(account: Pick<InvestmentAccount, "cashTracking">) {
  const result = validateAccountCashTracking(cashTrackingOf(account));
  if (!result.valid) throw new Error(result.issues[0]?.message ?? "현금 추적 정보를 확인해 주세요.");
  return result.tracking;
}

function requireActiveAccount(accounts: readonly InvestmentAccount[], accountId: string) {
  const account = accounts.find((item) => item.id === accountId && !item.archivedAt);
  if (!account) throw new Error("활성 계좌를 선택해 주세요.");
  return account;
}

function normalizedTimestamp(value: string, message: string) {
  const timestamp = Date.parse(value);
  if (!value || !Number.isFinite(timestamp)) throw new Error(message);
  return new Date(timestamp).toISOString();
}

function candidateKey(accountId: string, currency: Currency) {
  return JSON.stringify([accountId, currency]);
}
