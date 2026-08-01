export const markets = ["한국", "미국", "기타"] as const;
export const currencies = ["KRW", "USD"] as const;
export const stockStatuses = ["보유", "매수 대기", "관찰", "매도 완료", "재진입 대기", "아이디어 폐기"] as const;
export const investmentTypes = ["장기 코어", "중기 투자", "스윙", "단기", "관찰 전용"] as const;
export const stockViews = ["강세", "중립", "약세", "판단 보류"] as const;

export type Stock = {
  id: string;
  ticker: string;
  name: string;
  market: (typeof markets)[number];
  currency: (typeof currencies)[number];
  assetType: string;
  sector: string;
  status: (typeof stockStatuses)[number];
  investmentType: (typeof investmentTypes)[number];
  currentPrice: number;
  priceUpdatedAt?: string | null;
  priceQuotedAt?: string | null;
  priceSource?: "manual" | "twelve-data";
  priceStatus?: "manual" | "online" | "offline" | "error";
  targetPrice: number | null;
  averagePrice: number;
  quantity: number;
  thesisSummary: string;
  currentView: (typeof stockViews)[number];
  currentViewMemo: string;
  nextReviewDate: string | null;
  nextEarningsDate?: string | null;
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
