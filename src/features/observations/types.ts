export const observationScopes = ["stock", "market"] as const;
export type ObservationScope = (typeof observationScopes)[number];
export const marketTargetGroups = [
  { id: "global", label: "글로벌", targets: [{ id: "global", label: "전체 시장" }] },
  { id: "us", label: "미국", targets: [{ id: "sp500", label: "S&P 500" }, { id: "nasdaq", label: "NASDAQ" }, { id: "dow", label: "DOW" }] },
  { id: "europe", label: "유럽", targets: [{ id: "stoxx600", label: "STOXX Europe 600" }, { id: "eurostoxx50", label: "EURO STOXX 50" }, { id: "dax", label: "DAX" }, { id: "cac40", label: "CAC 40" }, { id: "ftse100", label: "FTSE 100" }] },
  { id: "japan", label: "일본", targets: [{ id: "nikkei225", label: "Nikkei 225" }, { id: "topix", label: "TOPIX" }] },
  { id: "korea", label: "한국", targets: [{ id: "kospi", label: "KOSPI" }, { id: "kosdaq", label: "KOSDAQ" }] },
  { id: "macro", label: "매크로 / 기타", targets: [{ id: "fx", label: "환율" }, { id: "rates", label: "금리" }, { id: "commodities", label: "원자재" }, { id: "crypto", label: "가상자산" }, { id: "other", label: "기타" }] },
] as const;
export type MarketTarget = (typeof marketTargetGroups)[number]["targets"][number]["id"];
export const marketTargets = marketTargetGroups.flatMap((group) => group.targets.map((target) => target.id)) as MarketTarget[];
export const marketTargetLabels = Object.fromEntries(marketTargetGroups.flatMap((group) => group.targets.map((target) => [target.id, target.label]))) as Record<MarketTarget, string>;

export function isMarketTarget(value: unknown): value is MarketTarget { return typeof value === "string" && marketTargets.includes(value as MarketTarget); }
export function normalizeMarketTargets(values: readonly MarketTarget[]) { const selected = new Set(values); return marketTargets.filter((target) => selected.has(target)); }

export type Observation = {
  id: string; scope?: ObservationScope; stockId: string | null; stockName: string; marketTargets?: MarketTarget[]; observedAt: string; title: string; content: string;
  marketCondition: string; stockView: "강세" | "중립" | "약세" | "판단 보류"; tags: string[];
  attachmentUrls: string[]; createdAt: string; updatedAt: string; deletedAt: string | null;
};

export type NormalizedObservation = Observation & { scope: ObservationScope; marketTargets: MarketTarget[] };

export function normalizeObservation(value: Observation): NormalizedObservation {
  const scope = value.scope === "market" ? "market" : "stock";
  return { ...value, scope, stockId: scope === "market" ? null : value.stockId, stockName: scope === "market" ? "" : value.stockName, marketTargets: scope === "market" ? normalizeMarketTargets(value.marketTargets ?? []) : [] };
}

export function filterObservations(values: Observation[], scope: "all" | ObservationScope, target = "all", stockId = "all") {
  return values.map(normalizeObservation).filter((item) => scope === "all" || item.scope === scope).filter((item) => scope !== "market" || target === "all" || item.marketTargets.includes(target as MarketTarget)).filter((item) => scope !== "stock" || stockId === "all" || item.stockId === stockId).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
}

export function stockObservationsFor(values: Observation[], stockId: string) {
  return values.map(normalizeObservation).filter((item) => item.scope === "stock" && item.stockId === stockId).sort((a, b) => b.observedAt.localeCompare(a.observedAt));
}
