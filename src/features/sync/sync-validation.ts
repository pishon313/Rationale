import { buildTradingLedger } from "@/domain/trading-ledger";
import { validateTransferPairs } from "@/features/accounts/account-transfer";
import { validateBackupCollectionRecord } from "@/features/settings/backup";
import type { SyncCollections } from "./sync-types";
import { recordNameFor } from "./sync-projection";
import { syncEntityTypes, type SyncEnvelopeV1 } from "./sync-types";

export function validateSyncEnvelope(envelope: SyncEnvelopeV1) {
  if (envelope.schemaVersion !== 1 || !syncEntityTypes.includes(envelope.entityType) || !envelope.logicalId || envelope.recordName !== recordNameFor(envelope.entityType, envelope.logicalId) || !Number.isFinite(Date.parse(envelope.updatedAt)) || typeof envelope.payload !== "object" || envelope.payload === null) throw new Error("SYNC_INVALID_ENVELOPE");
  if ((envelope.payload as { id?: unknown }).id !== envelope.logicalId) throw new Error("SYNC_ID_MISMATCH");
}

export function validateSyncCandidate(candidate: SyncCollections) {
  candidate.accounts.forEach((item, index) => validateBackupCollectionRecord("accounts", item, index));
  candidate.stocks.forEach((item, index) => validateBackupCollectionRecord("stocks", item, index));
  candidate.trades.forEach((item, index) => validateBackupCollectionRecord("trades", item, index));
  const accountIds = new Set(candidate.accounts.map((item) => item.id)); const stockIds = new Set(candidate.stocks.map((item) => item.id));
  for (const trade of candidate.trades.filter((item) => !item.deletedAt)) {
    if (!trade.accountId || !accountIds.has(trade.accountId)) throw new Error(`SYNC_INVALID_ACCOUNT_REFERENCE:${trade.id}`);
    if ((trade.tradeType === "매수" || trade.tradeType === "매도") && (!trade.stockId || !stockIds.has(trade.stockId))) throw new Error(`SYNC_INVALID_STOCK_REFERENCE:${trade.id}`);
  }
  validateTransferPairs(candidate.trades);
  const ledger = buildTradingLedger(candidate.trades, candidate.accounts);
  if (ledger.errors.length) throw new Error(`SYNC_INVALID_LEDGER:${ledger.errors[0].tradeId}:${ledger.errors[0].message}`);
  return ledger;
}
