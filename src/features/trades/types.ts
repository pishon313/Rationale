export const tradeTypes = ["매수", "매도", "배당", "입금", "출금"] as const;
export const emotions = ["평온", "확신", "불안", "공포", "FOMO", "조급함", "손실 만회 심리", "과도한 자신감", "무기력", "기타"] as const;
export type Trade = { id: string; stockId: string | null; stockName: string; planId: string | null; tradeType: (typeof tradeTypes)[number]; tradedAt: string; quantity: number; price: number; currency: "KRW" | "USD"; exchangeRate: number; fee: number; tax: number; accountName: string; memo: string; emotion: string; emotionIntensity: number; confidenceScore: number; ruleComplianceScore: number; createdAt: string };
