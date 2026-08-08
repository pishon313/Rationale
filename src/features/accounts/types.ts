import { currencies, type Currency } from "@/domain/currency";
import type { Trade } from "@/features/trades/types";

export const accountKinds = ["brokerage", "taxAdvantaged", "retirement", "cash", "other"] as const;
export type AccountKind = (typeof accountKinds)[number];

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
  createdAt: string;
  updatedAt: string;
};

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
