import type { InvestmentRule } from "./types";
const now = "2026-07-30T00:00:00Z";
export const sampleRules: InvestmentRule[] = [
  { id: "rule-cash", title: "최소 현금 비중 30% 유지", description: "매수 후에도 전체 자산의 현금 비중을 유지한다.", ruleType: "최소 현금 비중", thresholdValue: 30, thresholdUnit: "%", isActive: true, severity: "경고", createdAt: now, updatedAt: now, deletedAt: null },
  { id: "rule-position", title: "단일 종목 최대 비중 25%", description: "한 종목에 과도하게 집중하지 않는다.", ruleType: "최대 종목 비중", thresholdValue: 25, thresholdUnit: "%", isActive: true, severity: "경고", createdAt: now, updatedAt: now, deletedAt: null },
  { id: "rule-unplanned", title: "계획되지 않은 매수 금지", description: "매수 전에 반드시 계획과 무효화 조건을 작성한다.", ruleType: "필수 체크리스트", thresholdValue: null, thresholdUnit: "", isActive: true, severity: "주의", createdAt: now, updatedAt: now, deletedAt: null },
  { id: "rule-open", title: "본장 시작 후 30분 관찰", description: "초반 변동성에 휩쓸리지 않도록 충분히 관찰한다.", ruleType: "사용자 정의", thresholdValue: 30, thresholdUnit: "분", isActive: true, severity: "안내", createdAt: now, updatedAt: now, deletedAt: null },
];
