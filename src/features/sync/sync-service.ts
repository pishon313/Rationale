import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { projectStocksFromTrades } from "@/features/trades/migrate-trades";
import { loadCollection, saveCollectionsAtomically } from "@/lib/local-repository";
import { invoke } from "@tauri-apps/api/core";
import { isSyncableRecord, toSyncEnvelope } from "./sync-projection";
import { mergeSyncCollections } from "./sync-merge";
import type { SyncCollections, SyncEnvelopeV1, SyncTransport } from "./sync-types";
import { validateSyncCandidate, validateSyncEnvelope } from "./sync-validation";

export async function loadSyncCollections(): Promise<SyncCollections> {
  const [accounts, stocks, trades] = await Promise.all([loadCollection<InvestmentAccount>("accounts", []), loadCollection<Stock>("stocks", []), loadCollection<Trade>("trades", [])]);
  return { accounts, stocks, trades };
}

export function localSyncEnvelopes(local: SyncCollections): SyncEnvelopeV1[] {
  return [
    ...local.accounts.filter(isSyncableRecord).map((item) => toSyncEnvelope("accounts", item)),
    ...local.stocks.filter(isSyncableRecord).map((item) => toSyncEnvelope("stocks", item)),
    ...local.trades.filter(isSyncableRecord).map((item) => toSyncEnvelope("trades", item)),
  ];
}

export async function runForegroundSync(transport: SyncTransport, dependencies: SyncDependencies = defaults) {
  const local = await dependencies.load(); const remote = (await transport.fetchChanges()).filter((item) => isSyncableRecord({ id: item.logicalId })); remote.forEach(validateSyncEnvelope);
  const merged = mergeSyncCollections(local, remote);
  normalizeDefaultAccount(merged.collections.accounts);
  merged.collections.stocks = projectStocksFromTrades(merged.collections.stocks, merged.collections.trades);
  validateSyncCandidate(merged.collections);
  const remoteNames = new Set(remote.map((item) => item.recordName));
  const outgoingByName = new Map<string, SyncEnvelopeV1>();
  for (const item of localSyncEnvelopes(merged.collections)) if (!remoteNames.has(item.recordName)) outgoingByName.set(item.recordName, item);
  for (const item of merged.localWinners) outgoingByName.set(item.recordName, item);
  const outgoing = [...outgoingByName.values()];
  await dependencies.save(merged.collections, merged.conflicts, merged.acceptedRemoteRecordNames, outgoing);
  if (outgoing.length) { await transport.sendChanges(outgoing); await dependencies.acknowledge(outgoing.map((item) => item.recordName)); }
  return { ...merged, outgoing };
}

function normalizeDefaultAccount(accounts: InvestmentAccount[]) { if (accounts.length && !accounts.some((item) => item.isDefault && !item.archivedAt)) accounts.find((item) => !item.archivedAt)!.isDefault = true; }
type SyncDependencies = { load: () => Promise<SyncCollections>; save: (collections: SyncCollections, conflicts: ReturnType<typeof mergeSyncCollections>["conflicts"], acknowledgedRecordNames: readonly string[], queuedEnvelopes: readonly SyncEnvelopeV1[]) => Promise<void>; acknowledge: (recordNames: readonly string[]) => Promise<void> };
const defaults: SyncDependencies = { load: loadSyncCollections, save: (collections, conflicts, acknowledgedRecordNames, queuedEnvelopes) => saveCollectionsAtomically([{ collection: "accounts", values: collections.accounts }, { collection: "stocks", values: collections.stocks }, { collection: "trades", values: collections.trades }], { source: "remoteSync", conflicts, acknowledgedRecordNames, queuedEnvelopes }), acknowledge: (recordNames) => invoke("acknowledge_sync_records", { recordNames }) };
