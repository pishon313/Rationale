import { currencies, type Currency } from "@/domain/currency";
import type { Trade } from "@/features/trades/types";
import type { AccountFeePolicyV1 } from "./account-fee-policy";

export const accountKinds = ["brokerage", "taxAdvantaged", "retirement", "cash", "other"] as const;
export type AccountKind = (typeof accountKinds)[number];

export type AccountCashBaselineV1 = {
  currency: Currency;
  balance: string;
  asOf: string;
  createdAt: string;
  updatedAt: string;
};

export type AccountCashTrackingV1 = {
  version: 1;
  baselines: AccountCashBaselineV1[];
};

export type InvestmentAccount = {
  id: string;
  name: string;
  institution: string;
  kind: AccountKind;
  subtype: string;
  baseCurrency: Currency;
  isDefault: boolean;
  archivedAt: string | null;
  memo: string;
  feePolicy?: AccountFeePolicyV1 | null;
  cashTracking?: AccountCashTrackingV1 | null;
  createdAt: string;
  updatedAt: string;
};

export function cashTrackingOf(account: Pick<InvestmentAccount, "cashTracking">): AccountCashTrackingV1 {
  return account.cashTracking ?? { version: 1, baselines: [] };
}

export function normalizeLegacyAccountName(value: string | null | undefined) {
  return value?.trim() || "기본 계좌";
}

export function legacyAccountIdentity(name: string | null | undefined) {
  return `legacy:${normalizeLegacyAccountName(name)}`;
}

export function accountIdentity(trade: Pick<Trade, "accountId" | "accountName">) {
  return trade.accountId?.trim() || legacyAccountIdentity(trade.accountName);
}

export function isAccountKind(value: unknown): value is AccountKind {
  return typeof value === "string" && accountKinds.includes(value as AccountKind);
}

export function isAccountCurrency(value: unknown): value is Currency {
  return typeof value === "string" && currencies.includes(value as Currency);
}
