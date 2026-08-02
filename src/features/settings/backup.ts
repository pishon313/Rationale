import type { Observation } from "@/features/observations/types";
import { conditionTypes, planStatuses, scenarioTypes, type BuyPlan } from "@/features/plans/types";
import { reviewEvaluations, type Review } from "@/features/reviews/types";
import { ruleTypes, severities, type InvestmentRule } from "@/features/rules/types";
import { currencies, investmentTypes, markets, stockStatuses, stockViews, type Stock } from "@/features/stocks/types";
import { tradeTypes, type Trade } from "@/features/trades/types";

type CoreBackup = {
  exportedAt: string;
  stocks: Stock[];
  plans: BuyPlan[];
  trades: Trade[];
};

export type ValidatedBackup =
  | (CoreBackup & { version: 1 })
  | (CoreBackup & {
      version: 2 | 3;
      observations: Observation[];
      reviews: Review[];
      rules: InvestmentRule[];
    });

const supportedVersions = new Set([1, 2, 3]);
const supportedTradeTypes = new Set<string>(tradeTypes);
const supportedCurrencies = new Set<string>(currencies);

export function validateBackupPayload(value: unknown): ValidatedBackup {
  if (!isRecord(value) || typeof value.version !== "number" || !supportedVersions.has(value.version)) {
    throw new Error("올바른 TradeJournal 백업이 아닙니다.");
  }

  const stocks = validateRecords(value.stocks, "종목");
  const plans = validateRecords(value.plans, "매수 계획");
  const trades = validateRecords(value.trades, "매매 원장");
  stocks.forEach(validateStockRecord);
  plans.forEach(validatePlanRecord);
  for (const [index, trade] of trades.entries()) validateTradeRecord(trade, index);
  validateLedgerReferences(stocks, trades);

  const core = {
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "",
    stocks: stocks as Stock[],
    plans: plans as BuyPlan[],
    trades: trades as Trade[],
  };

  if (value.version === 1) return { version: 1, ...core };

  const observations = validateRecords(value.observations, "관찰 기록");
  const reviews = validateRecords(value.reviews, "회고");
  const rules = validateRecords(value.rules, "투자 원칙");
  observations.forEach(validateObservationRecord);
  reviews.forEach(validateReviewRecord);
  rules.forEach(validateRuleRecord);
  return {
    version: value.version as 2 | 3,
    ...core,
    observations: observations as Observation[],
    reviews: reviews as Review[],
    rules: rules as InvestmentRule[],
  };
}

function validateStockRecord(stock: Record<string, unknown>, index: number) {
  const label = `종목 ${index + 1}번째 항목`;
  requireStrings(stock, ["ticker", "name", "market", "currency", "assetType", "sector", "status", "investmentType", "thesisSummary", "currentView", "currentViewMemo", "createdAt", "updatedAt"], label);
  requireEnum(stock.market, markets, label, "시장");
  requireEnum(stock.currency, currencies, label, "통화");
  requireEnum(stock.status, stockStatuses, label, "상태");
  requireEnum(stock.investmentType, investmentTypes, label, "투자 유형");
  requireEnum(stock.currentView, stockViews, label, "현재 판단");
  requireNonNegativeNumbers(stock, ["currentPrice", "averagePrice", "quantity"], label);
  requireNullableNumber(stock.targetPrice, label, "목표 가격");
  requireStringArray(stock.tags, label, "태그");
  requireTimestamp(stock.createdAt, label, "생성 일시");
  requireTimestamp(stock.updatedAt, label, "수정 일시");
  requireNullableTimestamp(stock.nextReviewDate, label, "다음 검토일");
  requireNullableTimestamp(stock.deletedAt, label, "삭제 일시");
  if (stock.nextEarningsDate !== undefined) requireNullableTimestamp(stock.nextEarningsDate, label, "실적 발표일");
  if (stock.ledgerInitializedAt !== undefined) requireNullableTimestamp(stock.ledgerInitializedAt, label, "원장 전환 일시");
  if (stock.reviewNote !== undefined && typeof stock.reviewNote !== "string") throw new Error(`${label}의 검토 메모가 올바르지 않습니다.`);
  if (stock.priceUpdatedAt !== undefined) requireNullableTimestamp(stock.priceUpdatedAt, label, "가격 수정 일시");
  if (stock.priceQuotedAt !== undefined) requireNullableTimestamp(stock.priceQuotedAt, label, "시세 기준 일시");
  if (stock.priceSource !== undefined) requireEnum(stock.priceSource, ["manual", "twelve-data"] as const, label, "가격 출처");
  if (stock.priceStatus !== undefined) requireEnum(stock.priceStatus, ["manual", "online", "offline", "error"] as const, label, "가격 상태");
}

function validatePlanRecord(plan: Record<string, unknown>, index: number) {
  const label = `매수 계획 ${index + 1}번째 항목`;
  requireStrings(plan, ["stockId", "stockName", "ticker", "title", "scenarioType", "conditionType", "conditionDescription", "status", "invalidationCondition", "expectedHoldingPeriod", "memo", "createdAt", "updatedAt"], label);
  requireEnum(plan.scenarioType, scenarioTypes, label, "시나리오");
  requireEnum(plan.conditionType, conditionTypes, label, "조건 유형");
  requireEnum(plan.status, planStatuses, label, "상태");
  requireNonNegativeNumbers(plan, ["plannedAmount", "plannedQuantity", "priority"], label);
  requireNullableNumber(plan.targetPrice, label, "목표 가격");
  if (plan.stopLossPrice !== undefined) requireNullableNumber(plan.stopLossPrice, label, "손절가");
  if (plan.takeProfitPrice !== undefined) requireNullableNumber(plan.takeProfitPrice, label, "목표가");
  requireNullableNumber(plan.priceRangeMin, label, "최소 가격");
  requireNullableNumber(plan.priceRangeMax, label, "최대 가격");
  requireNullableNumber(plan.plannedPortfolioPercent, label, "예정 비중");
  requireTimestamp(plan.createdAt, label, "생성 일시");
  requireTimestamp(plan.updatedAt, label, "수정 일시");
  requireNullableTimestamp(plan.executedAt, label, "실행 일시");
  requireNullableTimestamp(plan.deletedAt, label, "삭제 일시");
  if (!Array.isArray(plan.conditions)) throw new Error(`${label}의 조건 목록이 올바르지 않습니다.`);
  for (const condition of plan.conditions) {
    if (!isRecord(condition) || typeof condition.id !== "string" || typeof condition.label !== "string" || typeof condition.isRequired !== "boolean" || (condition.isSatisfied !== null && typeof condition.isSatisfied !== "boolean")) {
      throw new Error(`${label}의 조건 목록이 올바르지 않습니다.`);
    }
  }
}

function validateObservationRecord(observation: Record<string, unknown>, index: number) {
  const label = `관찰 기록 ${index + 1}번째 항목`;
  requireStrings(observation, ["stockId", "stockName", "observedAt", "title", "content", "marketCondition", "stockView", "createdAt", "updatedAt"], label);
  requireEnum(observation.stockView, stockViews, label, "종목 판단");
  requireStringArray(observation.tags, label, "태그");
  requireStringArray(observation.attachmentUrls, label, "첨부 파일");
  requireTimestamp(observation.observedAt, label, "관찰 일시");
  requireTimestamp(observation.createdAt, label, "생성 일시");
  requireTimestamp(observation.updatedAt, label, "수정 일시");
  requireNullableTimestamp(observation.deletedAt, label, "삭제 일시");
}

function validateReviewRecord(review: Record<string, unknown>, index: number) {
  const label = `회고 ${index + 1}번째 항목`;
  requireStrings(review, ["stockName", "reviewedAt", "result", "decisionQuality", "executionQuality", "emotionState", "strengths", "mistakes", "nextAction", "lessons", "evaluation", "createdAt", "updatedAt"], label);
  if (review.stockId !== null && typeof review.stockId !== "string") throw new Error(`${label}의 종목 연결이 올바르지 않습니다.`);
  requireEnum(review.evaluation, reviewEvaluations, label, "평가");
  if (review.tradeId !== null && typeof review.tradeId !== "string") throw new Error(`${label}의 거래 연결이 올바르지 않습니다.`);
  if (typeof review.planCompliance !== "boolean") throw new Error(`${label}의 계획 준수 값이 올바르지 않습니다.`);
  requireFiniteNumbers(review, ["resultScore", "processScore"], label);
  requireTimestamp(review.reviewedAt, label, "회고 일시");
  requireTimestamp(review.createdAt, label, "생성 일시");
  requireTimestamp(review.updatedAt, label, "수정 일시");
  requireNullableTimestamp(review.deletedAt, label, "삭제 일시");
  if (review.strategyTags !== undefined) requireStringArray(review.strategyTags, label, "전략 태그");
  if (review.mistakeTags !== undefined) requireStringArray(review.mistakeTags, label, "실수 태그");
  if (review.attachmentUrls !== undefined) requireStringArray(review.attachmentUrls, label, "첨부 이미지");
}

function validateRuleRecord(rule: Record<string, unknown>, index: number) {
  const label = `투자 원칙 ${index + 1}번째 항목`;
  requireStrings(rule, ["title", "description", "ruleType", "thresholdUnit", "severity", "createdAt", "updatedAt"], label);
  requireEnum(rule.ruleType, ruleTypes, label, "원칙 유형");
  requireEnum(rule.severity, severities, label, "중요도");
  requireNullableNumber(rule.thresholdValue, label, "기준값");
  if (typeof rule.isActive !== "boolean") throw new Error(`${label}의 활성 상태가 올바르지 않습니다.`);
  requireTimestamp(rule.createdAt, label, "생성 일시");
  requireTimestamp(rule.updatedAt, label, "수정 일시");
  requireNullableTimestamp(rule.deletedAt, label, "삭제 일시");
}

function validateLedgerReferences(stocks: Array<Record<string, unknown>>, trades: Array<Record<string, unknown>>) {
  const securityStockIds = new Set(trades
    .filter((trade) => trade.tradeType === "매수" || trade.tradeType === "매도")
    .map((trade) => trade.stockId)
    .filter((stockId): stockId is string => typeof stockId === "string" && stockId.length > 0));
  for (const stock of stocks) {
    if (typeof stock.ledgerInitializedAt === "string" && Number(stock.quantity) > 0 && !securityStockIds.has(stock.id as string)) {
      throw new Error(`원장 관리 종목(${stock.id as string})의 매매 기록이 없습니다.`);
    }
  }
}

function validateRecords(value: unknown, label: string): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) throw new Error(`${label} 목록이 손상되었습니다.`);
  const ids = new Set<string>();
  return value.map((item, index) => {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id.trim()) {
      throw new Error(`${label} ${index + 1}번째 항목의 ID가 올바르지 않습니다.`);
    }
    if (ids.has(item.id)) throw new Error(`${label}에 중복 ID(${item.id})가 있습니다.`);
    ids.add(item.id);
    return item;
  });
}

function validateTradeRecord(trade: Record<string, unknown>, index: number) {
  const label = `매매 원장 ${index + 1}번째 항목`;
  if (typeof trade.tradeType !== "string" || !supportedTradeTypes.has(trade.tradeType)) {
    throw new Error(`${label}의 거래 유형이 올바르지 않습니다.`);
  }
  if (typeof trade.currency !== "string" || !supportedCurrencies.has(trade.currency)) {
    throw new Error(`${label}의 통화가 올바르지 않습니다.`);
  }
  if (trade.isOpeningPosition === true && trade.tradeType !== "매수") {
    throw new Error(`${label}의 기초 포지션 유형이 올바르지 않습니다.`);
  }
  if (!isTimestamp(trade.tradedAt) || !isTimestamp(trade.createdAt)) {
    throw new Error(`${label}의 거래 일시가 올바르지 않습니다.`);
  }
  if (typeof trade.accountName !== "string" || !trade.accountName.trim()) {
    throw new Error(`${label}의 계좌명이 올바르지 않습니다.`);
  }

  const quantity = requiredNumber(trade.quantity, label, "수량");
  const price = requiredNumber(trade.price, label, "가격");
  const exchangeRate = requiredNumber(trade.exchangeRate, label, "환율");
  const fee = requiredNumber(trade.fee, label, "수수료");
  const tax = requiredNumber(trade.tax, label, "세금");
  if (exchangeRate <= 0 || (trade.currency === "KRW" && exchangeRate !== 1)) throw new Error(`${label}의 환율이 올바르지 않습니다.`);
  if (fee < 0 || tax < 0) throw new Error(`${label}의 수수료 또는 세금이 올바르지 않습니다.`);
  if (trade.ruleViolations !== undefined) {
    if (!Array.isArray(trade.ruleViolations) || trade.ruleViolations.some((item) => !isRecord(item) || typeof item.ruleId !== "string" || typeof item.title !== "string" || typeof item.message !== "string" || !["안내", "주의", "경고"].includes(String(item.severity)))) throw new Error(`${label}의 원칙 위반 기록이 올바르지 않습니다.`);
  }

  const isSecurity = trade.tradeType === "매수" || trade.tradeType === "매도";
  if (isSecurity) {
    if (typeof trade.stockId !== "string" || !trade.stockId.trim() || typeof trade.stockName !== "string" || !trade.stockName.trim()) {
      throw new Error(`${label}의 종목 정보가 올바르지 않습니다.`);
    }
    const canBeZeroPrice = trade.isOpeningPosition === true;
    if (quantity <= 0 || price < 0 || (!canBeZeroPrice && price === 0)) throw new Error(`${label}의 수량 또는 가격이 올바르지 않습니다.`);
    return;
  }

  const amount = trade.amount === undefined ? quantity * price : requiredNumber(trade.amount, label, "금액");
  if (amount <= 0) throw new Error(`${label}의 금액이 올바르지 않습니다.`);
}

function requiredNumber(value: unknown, label: string, field: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label}의 ${field} 값이 올바르지 않습니다.`);
  return value;
}

function requireStrings(record: Record<string, unknown>, fields: string[], label: string) {
  for (const field of fields) if (typeof record[field] !== "string") throw new Error(`${label}의 ${field} 값이 올바르지 않습니다.`);
}

function requireFiniteNumbers(record: Record<string, unknown>, fields: string[], label: string) {
  for (const field of fields) requiredNumber(record[field], label, field);
}

function requireNonNegativeNumbers(record: Record<string, unknown>, fields: string[], label: string) {
  for (const field of fields) if (requiredNumber(record[field], label, field) < 0) throw new Error(`${label}의 ${field} 값은 0 이상이어야 합니다.`);
}

function requireNullableNumber(value: unknown, label: string, field: string) {
  if (value !== null) requiredNumber(value, label, field);
}

function requireEnum(value: unknown, allowed: readonly string[], label: string, field: string) {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`${label}의 ${field} 값이 올바르지 않습니다.`);
}

function requireStringArray(value: unknown, label: string, field: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${label}의 ${field} 목록이 올바르지 않습니다.`);
}

function requireTimestamp(value: unknown, label: string, field: string) {
  if (!isTimestamp(value)) throw new Error(`${label}의 ${field} 값이 올바르지 않습니다.`);
}

function requireNullableTimestamp(value: unknown, label: string, field: string) {
  if (value !== null && !isTimestamp(value)) throw new Error(`${label}의 ${field} 값이 올바르지 않습니다.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}
