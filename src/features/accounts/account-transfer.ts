import type { Currency } from "@/domain/currency";
import type { Trade } from "@/features/trades/types";
import { saveCollection } from "@/lib/local-repository";
import type { InvestmentAccount } from "./types";

export type AccountTransferInput = { sourceAccountId: string; targetAccountId: string; amount: number; currency: Currency; tradedAt: string; memo: string };
export type AccountTransferPair = { outgoing: Trade; incoming: Trade };

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

export function getTransferPair(trades: Trade[], transferId: string): AccountTransferPair {
  if (!transferId) throw new Error("이체 ID가 없어 이체 기록을 처리할 수 없습니다.");
  const active = trades.filter((trade) => trade.cashFlowKind === "transfer" && trade.transferId === transferId && !trade.deletedAt);
  if (active.length !== 2) throw new Error("이체 기록은 출금과 입금 두 건이 함께 있어야 합니다.");
  const outgoing = active.find((trade) => trade.tradeType === "출금");
  const incoming = active.find((trade) => trade.tradeType === "입금");
  if (!outgoing || !incoming || outgoing.accountId === incoming.accountId
    || outgoing.amount !== incoming.amount || outgoing.currency !== incoming.currency
    || outgoing.tradedAt !== incoming.tradedAt || outgoing.exchangeRate !== incoming.exchangeRate) {
    throw new Error("이체의 출금·입금 기록이 서로 일치하지 않습니다.");
  }
  return { outgoing, incoming };
}

export function validateTransferPairs(trades: Trade[]) {
  const ids = new Set<string>();
  for (const trade of trades) {
    if (trade.cashFlowKind !== "transfer" || trade.deletedAt) continue;
    if (!trade.transferId) throw new Error("이체 ID가 없는 활성 이체 기록이 있습니다.");
    ids.add(trade.transferId);
  }
  for (const transferId of ids) getTransferPair(trades, transferId);
}

export function updateAccountTransfer(trades: Trade[], accounts: InvestmentAccount[], transferId: string, input: AccountTransferInput, now = new Date().toISOString()) {
  const current = getTransferPair(trades, transferId);
  const [outgoing, incoming] = buildAccountTransfer(accounts, input, now, transferId);
  const replacements = new Map([[current.outgoing.id, { ...outgoing, id: current.outgoing.id, createdAt: current.outgoing.createdAt }], [current.incoming.id, { ...incoming, id: current.incoming.id, createdAt: current.incoming.createdAt }]]);
  const next = trades.map((trade) => replacements.get(trade.id) ?? trade);
  validateTransferPairs(next);
  return next;
}

export function deleteAccountTransfer(trades: Trade[], transferId: string, now = new Date().toISOString()) {
  const pair = getTransferPair(trades, transferId);
  const ids = new Set([pair.outgoing.id, pair.incoming.id]);
  const next = trades.map((trade) => ids.has(trade.id) ? { ...trade, deletedAt: now, updatedAt: now } : trade);
  validateTransferPairs(next);
  return next;
}
