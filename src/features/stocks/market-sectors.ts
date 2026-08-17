export const marketSectors = [
  "energy",
  "materials",
  "industrials",
  "consumer-discretionary",
  "consumer-staples",
  "health-care",
  "financials",
  "information-technology",
  "communication-services",
  "utilities",
  "real-estate",
] as const;

export type MarketSectorId = (typeof marketSectors)[number];

export const marketSectorMessageKeys: Record<MarketSectorId, string> = {
  energy: "에너지",
  materials: "소재",
  industrials: "산업재",
  "consumer-discretionary": "임의소비재",
  "consumer-staples": "필수소비재",
  "health-care": "헬스케어",
  financials: "금융",
  "information-technology": "정보기술",
  "communication-services": "커뮤니케이션 서비스",
  utilities: "유틸리티",
  "real-estate": "부동산",
};

export function isMarketSectorId(value: unknown): value is MarketSectorId {
  return typeof value === "string" && (marketSectors as readonly string[]).includes(value);
}

export function marketSectorLabel(id: MarketSectorId, translate: (key: string) => string) {
  return translate(marketSectorMessageKeys[id]);
}
