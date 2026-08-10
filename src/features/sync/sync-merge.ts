import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { fromAccountSyncPayload, fromStockSyncPayload, toSyncEnvelope } from "./sync-projection";
import type { AccountSyncPayloadV1, StockSyncPayloadV1, SyncCollections, SyncConflictV1, SyncEntityType, SyncEnvelopeV1, TradeSyncPayloadV1 } from "./sync-types";

export type MergeResult = { collections: SyncCollections; conflicts: SyncConflictV1[]; localWinners: SyncEnvelopeV1[]; acceptedRemoteRecordNames: string[] };
export function mergeSyncCollections(local: SyncCollections, remote: readonly SyncEnvelopeV1[], detectedAt = new Date().toISOString()): MergeResult {
  const collections: SyncCollections = { accounts: [...local.accounts], stocks: [...local.stocks], trades: [...local.trades] };
  const conflicts: SyncConflictV1[] = []; const localWinners: SyncEnvelopeV1[] = []; const acceptedRemoteRecordNames: string[] = [];
  for (const incoming of remote) {
    const list = collections[incoming.entityType] as Array<InvestmentAccount | Stock | Trade>;
    const index = list.findIndex((item) => item.id === incoming.logicalId);
    const existing = index < 0 ? undefined : list[index];
    if (!existing) { list.push(materialize(incoming)); acceptedRemoteRecordNames.push(incoming.recordName); continue; }
    const localEnvelope = toEnvelope(incoming.entityType, existing);
    const localJson = canonicalJson(localEnvelope.payload); const remoteJson = canonicalJson(incoming.payload);
    if (localJson === remoteJson) { acceptedRemoteRecordNames.push(incoming.recordName); continue; }
    const localTime = Date.parse(localEnvelope.updatedAt); const remoteTime = Date.parse(incoming.updatedAt);
    const remoteWins = remoteTime >= localTime;
    conflicts.push({ recordName: incoming.recordName, entityType: incoming.entityType, logicalId: incoming.logicalId, localPayload: localJson, remotePayload: remoteJson, detectedAt, chosenSide: remoteWins ? "remote" : "local", reason: remoteTime === localTime ? "equal-timestamp-server-wins" : remoteWins ? "newer-remote" : "newer-local" });
    if (remoteWins) { list[index] = materialize(incoming, existing); acceptedRemoteRecordNames.push(incoming.recordName); } else localWinners.push(localEnvelope);
  }
  return { collections, conflicts, localWinners, acceptedRemoteRecordNames };
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function materialize(envelope: SyncEnvelopeV1, local?: InvestmentAccount | Stock | Trade): InvestmentAccount | Stock | Trade {
  if (envelope.entityType === "accounts") return fromAccountSyncPayload(envelope.payload as AccountSyncPayloadV1, local as InvestmentAccount | undefined);
  if (envelope.entityType === "stocks") return fromStockSyncPayload(envelope.payload as StockSyncPayloadV1, local as Stock | undefined);
  return envelope.payload as TradeSyncPayloadV1;
}
function toEnvelope(type: SyncEntityType, value: InvestmentAccount | Stock | Trade): SyncEnvelopeV1 {
  if (type === "accounts") return toSyncEnvelope(type, value as InvestmentAccount); if (type === "stocks") return toSyncEnvelope(type, value as Stock); return toSyncEnvelope(type, value as Trade);
}
