import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";

export const syncSchemaVersion = 1 as const;
export const syncZoneName = "RationaleDataV1";
export const syncRecordType = "RationaleItemV1";
export const syncEntityTypes = ["accounts", "stocks", "trades"] as const;
export type SyncEntityType = (typeof syncEntityTypes)[number];
export type SyncWriteSource = "localUser" | "remoteSync" | "backupRestore" | "sampleData" | "systemDerived";
export type SyncStatus = "disabled" | "checkingAccount" | "signedOut" | "ready" | "syncing" | "offline" | "needsReconciliation" | "error";

export type AccountSyncPayloadV1 = Omit<InvestmentAccount, "isDefault">;
export type StockSyncPayloadV1 = Omit<Stock, "quantity" | "averagePrice" | "currentPrice" | "priceUpdatedAt" | "priceQuotedAt" | "priceSource" | "priceStatus" | "openingAccountName">;
export type TradeSyncPayloadV1 = Trade;
export type SyncPayloadV1 = AccountSyncPayloadV1 | StockSyncPayloadV1 | TradeSyncPayloadV1;
export type SyncEnvelopeV1<T extends SyncPayloadV1 = SyncPayloadV1> = {
  recordName: string; entityType: SyncEntityType; logicalId: string; schemaVersion: 1;
  updatedAt: string; deletedAt: string | null; payload: T;
};
export type SyncConflictV1 = { recordName: string; entityType: SyncEntityType; logicalId: string; localPayload: string; remotePayload: string; detectedAt: string; chosenSide: "local" | "remote"; reason: "newer-local" | "newer-remote" | "equal-timestamp-server-wins" };
export type SyncCollections = { accounts: InvestmentAccount[]; stocks: Stock[]; trades: Trade[] };
export type SyncOutboxEntry = SyncEnvelopeV1 & { operation: "upsert"; queuedAt: string };

export interface SyncTransport {
  fetchChanges(): Promise<SyncEnvelopeV1[]>;
  sendChanges(changes: readonly SyncEnvelopeV1[]): Promise<void>;
}
