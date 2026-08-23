import { buildTradingLedger, normalizeTrade } from "@/domain/trading-ledger";
import { validateTransferPairs } from "@/features/accounts/account-transfer";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import { validateStoredCollection } from "@/lib/collection-validation";
import { saveCollectionsAtomically, type CollectionWrite } from "@/lib/local-repository";
import { migrateTrades } from "./migrate-trades";
import { validateTradeMutation } from "./trade-mutations";
import type { Trade } from "./types";

export const tradeLedgerResetSnapshotCollection = "trade-ledger-reset-snapshots";

export type TradeLedgerResetSnapshotV1 = {
  id: "latest";
  version: 1;
  resetAt: string;
  tradeIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type TradeLedgerResetImpact = {
  totalRecords: number;
  securityRecords: number;
  dividendRecords: number;
  cashFlowRecords: number;
  transferPairs: number;
  openingPositions: number;
  importedRecords: number;
};

export type TradeLedgerResetPlan = {
  resetAt: string;
  impact: TradeLedgerResetImpact;
  nextTrades: Trade[];
  nextStocks: Stock[];
  snapshot: TradeLedgerResetSnapshotV1 | null;
  writes: CollectionWrite[];
  stocksChanged: boolean;
};

export type TradeLedgerResetUndoPlan = {
  resetAt: string;
  undoAt: string;
  restoredCount: number;
  nextTrades: Trade[];
  writes: CollectionWrite[];
};

export type TradeLedgerResetErrorCode =
  | "INVALID_TIMESTAMP"
  | "UNRESOLVED_LEGACY_STATE"
  | "INVALID_CANDIDATE"
  | "INVALID_SNAPSHOT"
  | "STALE_SNAPSHOT"
  | "UNDO_LEDGER_INVALID";

export class TradeLedgerResetError extends Error {
  constructor(public readonly code: TradeLedgerResetErrorCode) {
    super(code);
    this.name = "TradeLedgerResetError";
  }
}

type ResetInput = {
  trades: Trade[];
  stocks: Stock[];
  accounts: InvestmentAccount[];
  now?: string;
};

type UndoInput = {
  currentTrades: Trade[];
  accounts: InvestmentAccount[];
  snapshot: TradeLedgerResetSnapshotV1;
  now?: string;
};

export function summarizeTradeLedgerReset(trades: readonly Trade[]): TradeLedgerResetImpact {
  const active = trades.filter((trade) => !trade.deletedAt);
  const transferIds = new Set(active.filter((trade) => trade.cashFlowKind === "transfer" && trade.transferId).map((trade) => trade.transferId as string));
  return {
    totalRecords: active.length,
    securityRecords: active.filter((trade) => trade.tradeType === "매수" || trade.tradeType === "매도").length,
    dividendRecords: active.filter((trade) => trade.tradeType === "배당").length,
    cashFlowRecords: active.filter((trade) => trade.tradeType === "입금" || trade.tradeType === "출금").length,
    transferPairs: transferIds.size,
    openingPositions: active.filter((trade) => trade.isOpeningPosition).length,
    importedRecords: active.filter((trade) => trade.origin?.kind === "fileImport" || trade.origin?.kind === "brokerApi").length,
  };
}

export function buildTradeLedgerReset({ trades, stocks, accounts, now = new Date().toISOString() }: ResetInput): TradeLedgerResetPlan {
  requireTimestamp(now);
  const migration = migrateTrades(stocks, trades);
  if (migration.unresolvedStockIds.length) throw new TradeLedgerResetError("UNRESOLVED_LEGACY_STATE");

  const originalTombstones = new Map(trades.filter((trade) => trade.deletedAt).map((trade) => [trade.id, trade]));
  const canonicalTrades = migration.trades.map((trade) => originalTombstones.get(trade.id) ?? normalizeTrade(trade));
  assertValidCollection("accounts", accounts);
  assertValidCollection("stocks", stocks);
  assertValidCollection("trades", canonicalTrades);
  validateTransfers(canonicalTrades);
  const impact = summarizeTradeLedgerReset(canonicalTrades);
  if (impact.totalRecords === 0) {
    return { resetAt: now, impact, nextTrades: canonicalTrades, nextStocks: stocks, snapshot: null, writes: [], stocksChanged: false };
  }

  const affectedIds = new Set(canonicalTrades.filter((trade) => !trade.deletedAt).map((trade) => trade.id));
  const nextTrades = canonicalTrades.map((trade) => affectedIds.has(trade.id)
    ? { ...trade, deletedAt: now, updatedAt: now }
    : trade);
  const initializedIds = new Set(migration.initializedStockIds);
  const nextStocks = stocks.map((stock) => initializedIds.has(stock.id)
    ? { ...stock, ledgerInitializedAt: now, quantity: 0, averagePrice: 0, updatedAt: now }
    : stock);
  const stocksChanged = initializedIds.size > 0;
  const snapshot: TradeLedgerResetSnapshotV1 = {
    id: "latest",
    version: 1,
    resetAt: now,
    tradeIds: [...affectedIds],
    createdAt: now,
    updatedAt: now,
  };

  assertValidCollection("trades", nextTrades);
  if (stocksChanged) assertValidCollection("stocks", nextStocks);
  assertValidCollection(tradeLedgerResetSnapshotCollection, [snapshot]);
  validateTransfers(nextTrades);
  const mutation = validateTradeMutation(canonicalTrades, nextTrades, accounts);
  if (!mutation.ok) throw new TradeLedgerResetError("INVALID_CANDIDATE");

  const writes: CollectionWrite[] = [{ collection: "trades", values: nextTrades }];
  if (stocksChanged) writes.push({ collection: "stocks", values: nextStocks });
  writes.push({ collection: tradeLedgerResetSnapshotCollection, values: [snapshot] });
  return { resetAt: now, impact, nextTrades, nextStocks, snapshot, writes, stocksChanged };
}

export function buildTradeLedgerResetUndo({ currentTrades, accounts, snapshot, now = new Date().toISOString() }: UndoInput): TradeLedgerResetUndoPlan {
  requireTimestamp(now);
  assertValidCollection(tradeLedgerResetSnapshotCollection, [snapshot]);
  assertValidCollection("accounts", accounts);
  assertValidCollection("trades", currentTrades);

  const affectedIds = new Set(snapshot.tradeIds);
  const byId = new Map(currentTrades.map((trade) => [trade.id, trade]));
  for (const id of affectedIds) {
    const trade = byId.get(id);
    if (!trade || trade.deletedAt !== snapshot.resetAt || trade.updatedAt !== snapshot.resetAt) {
      throw new TradeLedgerResetError("STALE_SNAPSHOT");
    }
  }

  const nextTrades = currentTrades.map((trade) => affectedIds.has(trade.id)
    ? { ...trade, deletedAt: null, updatedAt: now }
    : trade);
  assertValidCollection("trades", nextTrades);
  validateTransfers(nextTrades);
  assertUndoLedgerSafety(currentTrades, nextTrades, affectedIds, accounts);

  return {
    resetAt: snapshot.resetAt,
    undoAt: now,
    restoredCount: affectedIds.size,
    nextTrades,
    writes: [
      { collection: "trades", values: nextTrades },
      { collection: tradeLedgerResetSnapshotCollection, values: [] },
    ],
  };
}

export async function persistTradeLedgerReset(
  plan: Pick<TradeLedgerResetPlan | TradeLedgerResetUndoPlan, "writes">,
  save: typeof saveCollectionsAtomically = saveCollectionsAtomically,
) {
  if (!plan.writes.length) return;
  await save(plan.writes);
}

function assertUndoLedgerSafety(currentTrades: Trade[], nextTrades: Trade[], affectedIds: ReadonlySet<string>, accounts: InvestmentAccount[]) {
  const restoredOnly = nextTrades.filter((trade) => affectedIds.has(trade.id));
  const currentOnly = currentTrades.filter((trade) => !affectedIds.has(trade.id));
  const allowedErrors = new Set([
    ...ledgerErrorKeys(restoredOnly, accounts),
    ...ledgerErrorKeys(currentOnly, accounts),
  ]);
  const introduced = ledgerErrorKeys(nextTrades, accounts).find((error) => !allowedErrors.has(error));
  if (introduced) throw new TradeLedgerResetError("UNDO_LEDGER_INVALID");
}

function ledgerErrorKeys(trades: Trade[], accounts: InvestmentAccount[]) {
  return buildTradingLedger(trades, accounts).errors.map((error) => `${error.tradeId}:${error.message}`);
}

function validateTransfers(trades: Trade[]) {
  try {
    validateTransferPairs(trades);
  } catch {
    throw new TradeLedgerResetError("INVALID_CANDIDATE");
  }
}

function assertValidCollection(collection: string, values: unknown) {
  if (!validateStoredCollection(collection, values).valid) {
    throw new TradeLedgerResetError(collection === tradeLedgerResetSnapshotCollection ? "INVALID_SNAPSHOT" : "INVALID_CANDIDATE");
  }
}

function requireTimestamp(value: string) {
  if (!value.trim() || !Number.isFinite(Date.parse(value))) throw new TradeLedgerResetError("INVALID_TIMESTAMP");
}
