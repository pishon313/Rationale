import { buildTradingLedger, normalizeTrade, type TradingLedger } from "@/domain/trading-ledger";
import { deleteAccountTransfer, validateTransferPairs } from "@/features/accounts/account-transfer";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Trade } from "./types";

export type TradeMutationResult = { ok: true; ledger: TradingLedger } | { ok: false; error: string };

type CommitInput = {
  currentTrades: Trade[];
  nextTrades: Trade[];
  accounts: InvestmentAccount[];
  changedId?: string;
  replaceTrades: (trades: Trade[]) => Promise<void>;
};

export async function commitTradeMutation({ currentTrades, nextTrades, accounts, changedId, replaceTrades }: CommitInput): Promise<TradeMutationResult> {
  const validation = validateTradeMutation(currentTrades, nextTrades, accounts, changedId);
  if (!validation.ok) return validation;
  try {
    await replaceTrades(nextTrades.map(normalizeTrade));
    return validation;
  } catch {
    return { ok: false, error: "원장 기록을 저장하지 못했습니다. 다시 시도해 주세요." };
  }
}

export function validateTradeMutation(currentTrades: Trade[], nextTrades: Trade[], accounts: InvestmentAccount[], changedId?: string): TradeMutationResult {
  if (new Set(nextTrades.map((trade) => trade.id)).size !== nextTrades.length) return { ok: false, error: "중복된 거래 ID가 있어 저장할 수 없습니다." };
  try {
    validateTransferPairs(nextTrades);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "이체 기록이 올바르지 않습니다." };
  }
  const previous = buildTradingLedger(currentTrades, accounts);
  const candidate = buildTradingLedger(nextTrades, accounts);
  const direct = changedId ? candidate.calculations[changedId]?.error : null;
  const previousErrors = new Set(previous.errors.map((item) => `${item.tradeId}:${item.message}`));
  const introduced = candidate.errors.find((item) => !previousErrors.has(`${item.tradeId}:${item.message}`));
  const error = direct || (introduced ? `${introduced.tradeId}: ${introduced.message}` : "");
  return error ? { ok: false, error } : { ok: true, ledger: candidate };
}

export function buildSoftDeletedTrades(trades: Trade[], trade: Trade, now = new Date().toISOString()) {
  if (trade.cashFlowKind === "transfer") return deleteAccountTransfer(trades, trade.transferId ?? "", now);
  return trades.map((item) => item.id === trade.id ? { ...item, deletedAt: now, updatedAt: now } : item);
}
