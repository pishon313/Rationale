import type { Currency } from "@/domain/currency";
import type { Trade } from "@/features/trades/types";
import { saveCollection } from "@/lib/local-repository";
import type { InvestmentAccount } from "./types";

export type AccountTransferInput = { sourceAccountId: string; targetAccountId: string; amount: number; currency: Currency; tradedAt: string; memo: string };

export function buildAccountTransfer(accounts: InvestmentAccount[], input: AccountTransferInput, now = new Date().toISOString(), transferId = crypto.randomUUID()): Trade[] {
  const source = accounts.find((account) => account.id === input.sourceAccountId && !account.archivedAt);
  const target = accounts.find((account) => account.id === input.targetAccountId && !account.archivedAt);
  if (!source || !target) throw new Error("활성 계좌를 선택해 주세요.");
  if (source.id === target.id) throw new Error("서로 다른 계좌를 선택해 주세요.");
  if (!(input.amount > 0) || !Number.isFinite(input.amount)) throw new Error("이체 금액은 0보다 커야 합니다.");
  const common = { stockId: null, stockName: "", planId: null, tradedAt: input.tradedAt, quantity: 0, price: 0, amount: input.amount, currency: input.currency, exchangeRate: input.currency === "KRW" ? 1 : 1, fee: 0, tax: 0, cashFlowKind: "transfer" as const, transferId, memo: input.memo, emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 5, ruleViolations: [], createdAt: now, updatedAt: now, deletedAt: null };
  return [{ ...common, id: `${transferId}-out`, tradeType: "출금", accountId: source.id, accountName: source.name }, { ...common, id: `${transferId}-in`, tradeType: "입금", accountId: target.id, accountName: target.name }];
}

export async function saveAccountTransfer(existing: Trade[], accounts: InvestmentAccount[], input: AccountTransferInput, save: typeof saveCollection = saveCollection) {
  const pair = buildAccountTransfer(accounts, input);
  await save("trades", [...pair, ...existing]);
  return pair;
}
