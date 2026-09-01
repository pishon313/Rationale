export const markets = ["한국", "미국", "일본", "홍콩", "캐나다", "기타"] as const;
import { currencies, type Currency } from "@/domain/currency";
import type { MarketSectorId } from "./market-sectors";
export { currencies };
export const stockStatuses = ["보유", "매수 대기", "관찰", "매도 완료", "재진입 대기", "아이디어 폐기"] as const;
export const investmentTypes = ["장기 코어", "중기 투자", "스윙", "단기", "관찰 전용"] as const;
export const stockViews = ["강세", "중립", "약세", "판단 보류"] as const;

export const remoteMarketDataProviders = ["eodhd", "twelve-data"] as const;
export const marketDataProviders = ["manual", ...remoteMarketDataProviders] as const;
export const quotePreferences = ["auto", ...marketDataProviders] as const;
export const quoteFreshnessValues = ["realtime", "delayed", "eod", "manual", "unknown"] as const;
export const priceStatuses = ["manual", "online", "offline", "error"] as const;
export const securityAssetClasses = ["equity", "bond"] as const;
export type MarketDataProvider = (typeof marketDataProviders)[number];
export type RemoteMarketDataProvider = (typeof remoteMarketDataProviders)[number];
export type ProviderInstrumentRef = { provider: RemoteMarketDataProvider; symbol: string; exchangeCode?: string | null };
export type QuotePreference = (typeof quotePreferences)[number];
export type QuoteFreshness = (typeof quoteFreshnessValues)[number];
export type PriceStatus = (typeof priceStatuses)[number];
export type SecurityAssetClass = (typeof securityAssetClasses)[number];

export type Stock = {
  id: string;
  ticker: string;
  name: string;
  market: (typeof markets)[number];
  currency: Currency;
  countryCode?: string | null;
  exchangeCode?: string | null;
  exchangeMic?: string | null;
  exchangeName?: string | null;
  isin?: string | null;
  providerRefs?: ProviderInstrumentRef[];
  quotePreference?: QuotePreference;
  assetType: string;
  /** Stable Allocation classification; older records fall back to assetType inference. */
  assetClass?: SecurityAssetClass;
  marketSector?: MarketSectorId | null;
  sector: string;
  status: (typeof stockStatuses)[number];
  investmentType: (typeof investmentTypes)[number];
  currentPrice: number;
  priceUpdatedAt?: string | null;
  priceQuotedAt?: string | null;
  priceSource?: MarketDataProvider;
  priceFreshness?: QuoteFreshness;
  priceDelayMinutes?: number | null;
  priceStatus?: PriceStatus;
  targetPrice: number | null;
  averagePrice: number;
  quantity: number;
  openingAccountName?: string;
  thesisSummary: string;
  currentView: (typeof stockViews)[number];
  currentViewMemo: string;
  nextReviewDate: string | null;
  reviewNote?: string;
  nextEarningsDate?: string | null;
  ledgerInitializedAt?: string | null;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type StockComputed = Stock & {
  investedAmount: number;
  marketValue: number;
  unrealizedProfit: number;
  unrealizedProfitRate: number | null;
};

export function withComputed(stock: Stock): StockComputed {
  const investedAmount = stock.averagePrice * stock.quantity;
  const marketValue = stock.currentPrice * stock.quantity;
  const unrealizedProfit = marketValue - investedAmount;
  return {
    ...stock,
    investedAmount,
    marketValue,
    unrealizedProfit,
    unrealizedProfitRate: investedAmount === 0 ? null : (unrealizedProfit / investedAmount) * 100,
  };
}
