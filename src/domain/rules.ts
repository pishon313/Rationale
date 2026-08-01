import type { InvestmentRule } from "@/features/rules/types";

export type TradeDraftForRules = { amount: number; planId: string | null; resultingPositionPercent?: number; resultingCashPercent?: number };
export type RuleWarning = { ruleId: string; title: string; severity: InvestmentRule["severity"]; message: string };

export function evaluateTradeRules(rules: InvestmentRule[], draft: TradeDraftForRules): RuleWarning[] {
  return rules.filter((rule) => rule.isActive).flatMap((rule) => {
    let violated = false; let message = rule.description;
    if (rule.ruleType === "최대 거래 금액" && rule.thresholdValue != null) { violated = draft.amount > rule.thresholdValue; message = `거래금액 ${draft.amount.toLocaleString()}이 한도 ${rule.thresholdValue.toLocaleString()}을 초과합니다.`; }
    if (rule.ruleType === "최소 현금 비중" && rule.thresholdValue != null && draft.resultingCashPercent != null) { violated = draft.resultingCashPercent < rule.thresholdValue; message = `거래 후 현금 비중이 최소 ${rule.thresholdValue}% 아래로 내려갑니다.`; }
    if (rule.ruleType === "최대 종목 비중" && rule.thresholdValue != null && draft.resultingPositionPercent != null) { violated = draft.resultingPositionPercent > rule.thresholdValue; message = `거래 후 종목 비중이 최대 ${rule.thresholdValue}%를 초과합니다.`; }
    if (rule.ruleType === "필수 체크리스트" && rule.title.includes("계획되지 않은") && !draft.planId) { violated = true; message = "연결된 매수 계획이 없는 매매입니다."; }
    return violated ? [{ ruleId: rule.id, title: rule.title, severity: rule.severity, message }] : [];
  });
}
