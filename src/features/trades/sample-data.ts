import type { Trade } from "./types";
export const sampleTrades: Trade[] = [
  { id: "t1", stockId: "samsung", stockName: "삼성전자", planId: null, tradeType: "매수", tradedAt: "2026-07-12T10:10", quantity: 120, price: 64100, currency: "KRW", exchangeRate: 1, fee: 1200, tax: 0, accountName: "기본 계좌", memo: "계획 비중 내 진입", emotion: "평온", emotionIntensity: 2, confidenceScore: 4, ruleComplianceScore: 5, createdAt: "2026-07-12T10:10:00Z" },
  { id: "t2", stockId: "micron", stockName: "Micron Technology", planId: "plan-mu-1", tradeType: "매수", tradedAt: "2026-07-21T23:40", quantity: 35, price: 132.6, currency: "USD", exchangeRate: 1380, fee: 1.2, tax: 0, accountName: "기본 계좌", memo: "1차 분할매수", emotion: "확신", emotionIntensity: 3, confidenceScore: 4, ruleComplianceScore: 4, createdAt: "2026-07-21T14:40:00Z" },
];
