export const planStatuses = ["아이디어", "관찰 중", "조건 접근", "매수 준비", "일부 실행", "완료", "취소", "무효화"] as const;
export const kanbanStatuses = planStatuses.slice(0, 6);
export const scenarioTypes = ["하락 지속", "눌림목", "반등 확인", "추세 전환", "전고점 돌파", "실적 확인 후 진입", "기타"] as const;
export const conditionTypes = ["특정 가격 도달", "가격 범위 진입", "거래량 증가", "이동평균선 회복", "전고점 돌파", "시장 추세 회복", "실적 발표 후", "사용자 정의"] as const;

export type BuyPlanCondition = { id: string; label: string; isRequired: boolean; isSatisfied: boolean | null };
export type BuyPlan = {
  id: string; stockId: string; stockName: string; ticker: string; title: string;
  scenarioType: (typeof scenarioTypes)[number]; conditionType: (typeof conditionTypes)[number]; conditionDescription: string;
  targetPrice: number | null; priceRangeMin: number | null; priceRangeMax: number | null;
  plannedAmount: number; plannedQuantity: number; plannedPortfolioPercent: number | null;
  priority: number; status: (typeof planStatuses)[number]; invalidationCondition: string;
  expectedHoldingPeriod: string; memo: string; conditions: BuyPlanCondition[];
  createdAt: string; updatedAt: string; executedAt: string | null; deletedAt: string | null;
};
