export const observationScopes = ["stock", "market"] as const;
export type ObservationScope = (typeof observationScopes)[number];
export const marketTargets = ["global", "nasdaq", "sp500", "dow", "kospi", "kosdaq", "fx", "rates", "commodities", "crypto", "other"] as const;
export type MarketTarget = (typeof marketTargets)[number];

export type Observation = {
  id: string; scope?: ObservationScope; stockId: string | null; stockName: string; marketTargets?: MarketTarget[]; observedAt: string; title: string; content: string;
  marketCondition: string; stockView: "강세" | "중립" | "약세" | "판단 보류"; tags: string[];
  attachmentUrls: string[]; createdAt: string; updatedAt: string; deletedAt: string | null;
};

export type NormalizedObservation = Observation & { scope: ObservationScope; marketTargets: MarketTarget[] };

export function normalizeObservation(value: Observation): NormalizedObservation {
  const scope = value.scope === "market" ? "market" : "stock";
  return { ...value, scope, stockId: scope === "market" ? null : value.stockId, stockName: scope === "market" ? "" : value.stockName, marketTargets: scope === "market" ? value.marketTargets ?? [] : [] };
}

export const marketTargetLabels: Record<MarketTarget, string> = { global: "전체 시장", nasdaq: "NASDAQ", sp500: "S&P 500", dow: "DOW", kospi: "KOSPI", kosdaq: "KOSDAQ", fx: "환율", rates: "금리", commodities: "원자재", crypto: "가상자산", other: "기타" };

export function filterObservations(values: Observation[], scope: "all" | ObservationScope, target = "all", stockId = "all") {
  return values.map(normalizeObservation).filter((item) => scope === "all" || item.scope === scope).filter((item) => scope !== "market" || target === "all" || item.marketTargets.includes(target as MarketTarget)).filter((item) => scope !== "stock" || stockId === "all" || item.stockId === stockId).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
}

export function stockObservationsFor(values: Observation[], stockId: string) {
  return values.map(normalizeObservation).filter((item) => item.scope === "stock" && item.stockId === stockId).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
}
