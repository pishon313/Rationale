import type { InvestmentAccount } from "@/features/accounts/types";
import { normalizeTrade } from "@/domain/trading-ledger";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { syncSchemaVersion, type AccountSyncPayloadV1, type StockSyncPayloadV1, type SyncEntityType, type SyncEnvelopeV1, type SyncPayloadV1, type TradeSyncPayloadV1 } from "./sync-types";

export function recordNameFor(entityType: SyncEntityType, logicalId: string) { return `v1|${entityType}|${logicalId}`; }
export function isSyncableRecord(record: { id: string }) { return !record.id.startsWith("sample:v1:"); }

export function toAccountSyncPayload(account: InvestmentAccount): AccountSyncPayloadV1 {
  return { id: account.id, name: account.name, institution: account.institution, kind: account.kind, subtype: account.subtype, baseCurrency: account.baseCurrency, archivedAt: account.archivedAt, memo: account.memo, ...(account.feePolicy === undefined ? {} : { feePolicy: account.feePolicy }), createdAt: account.createdAt, updatedAt: account.updatedAt };
}
export function fromAccountSyncPayload(payload: AccountSyncPayloadV1, local?: InvestmentAccount): InvestmentAccount {
  return { ...payload, isDefault: local?.isDefault ?? false };
}
export function toStockSyncPayload(stock: Stock): StockSyncPayloadV1 {
  return { id: stock.id, ticker: stock.ticker, name: stock.name, market: stock.market, currency: stock.currency, ...(stock.countryCode === undefined ? {} : { countryCode: stock.countryCode }), ...(stock.exchangeCode === undefined ? {} : { exchangeCode: stock.exchangeCode }), ...(stock.exchangeMic === undefined ? {} : { exchangeMic: stock.exchangeMic }), ...(stock.exchangeName === undefined ? {} : { exchangeName: stock.exchangeName }), ...(stock.isin === undefined ? {} : { isin: stock.isin }), ...(stock.providerRefs === undefined ? {} : { providerRefs: stock.providerRefs }), ...(stock.quotePreference === undefined ? {} : { quotePreference: stock.quotePreference }), assetType: stock.assetType, ...(stock.marketSector === undefined ? {} : { marketSector: stock.marketSector }), sector: stock.sector, status: stock.status, investmentType: stock.investmentType, targetPrice: stock.targetPrice, thesisSummary: stock.thesisSummary, currentView: stock.currentView, currentViewMemo: stock.currentViewMemo, nextReviewDate: stock.nextReviewDate, ...(stock.reviewNote === undefined ? {} : { reviewNote: stock.reviewNote }), ...(stock.nextEarningsDate === undefined ? {} : { nextEarningsDate: stock.nextEarningsDate }), ...(stock.ledgerInitializedAt === undefined ? {} : { ledgerInitializedAt: stock.ledgerInitializedAt }), tags: stock.tags, createdAt: stock.createdAt, updatedAt: stock.updatedAt, deletedAt: stock.deletedAt };
}
export function fromStockSyncPayload(payload: StockSyncPayloadV1, local?: Stock): Stock {
  return { ...payload, quantity: local?.quantity ?? 0, averagePrice: local?.averagePrice ?? 0, currentPrice: local?.currentPrice ?? 0, priceUpdatedAt: local?.priceUpdatedAt ?? null, priceQuotedAt: local?.priceQuotedAt ?? null, priceSource: local?.priceSource ?? "manual", priceFreshness: local?.priceFreshness ?? "manual", priceDelayMinutes: local?.priceDelayMinutes ?? null, priceStatus: local?.priceStatus ?? "manual", ...(local?.openingAccountName ? { openingAccountName: local.openingAccountName } : {}) };
}
export function toTradeSyncPayload(trade: Trade): TradeSyncPayloadV1 { return normalizeTrade(trade); }

export function toSyncEnvelope(entityType: "accounts", value: InvestmentAccount): SyncEnvelopeV1<AccountSyncPayloadV1>;
export function toSyncEnvelope(entityType: "stocks", value: Stock): SyncEnvelopeV1<StockSyncPayloadV1>;
export function toSyncEnvelope(entityType: "trades", value: Trade): SyncEnvelopeV1<TradeSyncPayloadV1>;
export function toSyncEnvelope(entityType: SyncEntityType, value: InvestmentAccount | Stock | Trade): SyncEnvelopeV1 {
  const payload: SyncPayloadV1 = entityType === "accounts" ? toAccountSyncPayload(value as InvestmentAccount) : entityType === "stocks" ? toStockSyncPayload(value as Stock) : toTradeSyncPayload(value as Trade);
  const deletedAt = entityType === "accounts" ? null : (value as Stock | Trade).deletedAt ?? null;
  return { recordName: recordNameFor(entityType, value.id), entityType, logicalId: value.id, schemaVersion: syncSchemaVersion, updatedAt: value.updatedAt ?? value.createdAt, deletedAt, payload };
}
