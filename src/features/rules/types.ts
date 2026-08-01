export const ruleTypes = ["최소 현금 비중", "최대 종목 비중", "최대 섹터 비중", "최대 거래 금액", "레버리지 제한", "필수 체크리스트", "사용자 정의"] as const;
export const severities = ["안내", "주의", "경고"] as const;
export type InvestmentRule = { id: string; title: string; description: string; ruleType: (typeof ruleTypes)[number]; thresholdValue: number | null; thresholdUnit: string; isActive: boolean; severity: (typeof severities)[number]; createdAt: string; updatedAt: string; deletedAt: string | null };
