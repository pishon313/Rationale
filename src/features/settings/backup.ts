import { isMarketTarget, type Observation } from "@/features/observations/types";
import type { Note } from "@/features/notes/types";
import type { Currency } from "@/domain/currency";
import { conditionTypes, planStatuses, scenarioTypes, type BuyPlan } from "@/features/plans/types";
import { reviewEvaluations, type Review } from "@/features/reviews/types";
import { ruleTypes, severities, type InvestmentRule } from "@/features/rules/types";
import { currencies, investmentTypes, marketDataProviders, markets, priceStatuses, quoteFreshnessValues, quotePreferences, remoteMarketDataProviders, stockStatuses, stockViews, type Stock } from "@/features/stocks/types";
import { marketSectors } from "@/features/stocks/market-sectors";
import { tradeJournalStatuses, tradeOriginKinds, tradeTypes, type Trade } from "@/features/trades/types";
import { accountKinds } from "@/features/accounts/types";
import type { InvestmentAccount } from "@/features/accounts/types";
import { validateAccountFeePolicy } from "@/features/accounts/account-fee-policy";
import { validateTransferPairs } from "@/features/accounts/account-transfer";
import { isLocale, type Locale } from "@/i18n/types";

export type DashboardNoteBackup = { id: string; content: string; updatedAt: string };
export type EarningsEventBackup = { id: string; name: string; ticker: string; date: string; updatedAt: string; deletedAt: string | null };

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
    })
  | (CoreBackup & {
      version: 4;
      observations: Observation[];
      reviews: Review[];
      rules: InvestmentRule[];
      notes: Note[];
      language: Locale;
      dashboardNotes?: DashboardNoteBackup[];
      earningsEvents?: EarningsEventBackup[];
      displayCurrency?: Currency;
    })
  | (CoreBackup & {
      version: 5;
      accounts: InvestmentAccount[];
      observations: Observation[];
      reviews: Review[];
      rules: InvestmentRule[];
      notes: Note[];
      language: Locale;
      dashboardNotes: DashboardNoteBackup[];
      earningsEvents: EarningsEventBackup[];
      displayCurrency: Currency;
    });

const supportedVersions = new Set([1, 2, 3, 4, 5]);
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
  if (value.version === 4 || value.version === 5) {
    const notes = validateRecords(value.notes, "Note");
    notes.forEach(validateNoteRecord);
    if (!isLocale(value.language)) throw new Error("언어 설정이 올바르지 않습니다.");
    const dashboardNotes = value.dashboardNotes === undefined ? undefined : validateRecords(value.dashboardNotes, "대시보드 메모");
    dashboardNotes?.forEach(validateDashboardNoteRecord);
    const earningsEvents = value.earningsEvents === undefined ? undefined : validateRecords(value.earningsEvents, "실적 발표 일정");
    earningsEvents?.forEach(validateEarningsEventRecord);
    if (value.displayCurrency !== undefined) requireEnum(value.displayCurrency, currencies, "통화 설정", "표시 통화");
    if (value.version === 5) {
      const accounts = validateRecords(value.accounts, "계좌");
      accounts.forEach(validateAccountRecord);
      if (!dashboardNotes || !earningsEvents || value.displayCurrency === undefined) throw new Error("Version 5 백업의 설정 데이터가 완전하지 않습니다.");
      validateAccountReferences(accounts, trades);
      validateTransferPairs(trades as Trade[]);
      return {
        version: 5,
        ...core,
        accounts: accounts as InvestmentAccount[],
        observations: observations as Observation[],
        reviews: reviews as Review[],
        rules: rules as InvestmentRule[],
        notes: notes as Note[],
        language: value.language,
        dashboardNotes: dashboardNotes as DashboardNoteBackup[],
        earningsEvents: earningsEvents as EarningsEventBackup[],
        displayCurrency: value.displayCurrency as Currency,
      };
    }
    return {
      version: 4,
      ...core,
      observations: observations as Observation[],
      reviews: reviews as Review[],
      rules: rules as InvestmentRule[],
      notes: notes as Note[],
      language: value.language,
      dashboardNotes: dashboardNotes as DashboardNoteBackup[] | undefined,
      earningsEvents: earningsEvents as EarningsEventBackup[] | undefined,
      displayCurrency: value.displayCurrency as Currency | undefined,
    };
  }
  return {
    version: value.version as 2 | 3,
    ...core,
    observations: observations as Observation[],
    reviews: reviews as Review[],
    rules: rules as InvestmentRule[],
  };
}

function validateAccountReferences(accounts: Array<Record<string, unknown>>, trades: Array<Record<string, unknown>>) {
  const accountIds = new Set(accounts.map((account) => account.id as string));
  for (const [index, trade] of trades.entries()) {
    if (typeof trade.accountId !== "string" || !accountIds.has(trade.accountId)) {
      throw new Error(`매매 원장 ${index + 1}번째 항목이 존재하지 않는 계좌를 참조합니다.`);
    }
  }
}

function validateDashboardNoteRecord(note: Record<string, unknown>, index: number) {
  const label = `대시보드 메모 ${index + 1}번째 항목`;
  requireStrings(note, ["content", "updatedAt"], label);
  if (note.updatedAt !== "") requireTimestamp(note.updatedAt, label, "수정 일시");
}

function validateEarningsEventRecord(event: Record<string, unknown>, index: number) {
  const label = `실적 발표 일정 ${index + 1}번째 항목`;
  requireStrings(event, ["name", "ticker", "date", "updatedAt"], label);
  requireTimestamp(event.date, label, "발표일");
  requireTimestamp(event.updatedAt, label, "수정 일시");
  requireNullableTimestamp(event.deletedAt, label, "삭제 일시");
}

function validateNoteRecord(note: Record<string, unknown>, index: number) {
  const label = `Note ${index + 1}번째 항목`;
  requireStrings(note, ["title", "content", "createdAt", "updatedAt"], label);
  requireTimestamp(note.createdAt, label, "생성 일시");
  requireTimestamp(note.updatedAt, label, "수정 일시");
  requireNullableTimestamp(note.deletedAt, label, "삭제 일시");
}

function validateStockRecord(stock: Record<string, unknown>, index: number) {
  const label = `종목 ${index + 1}번째 항목`;
  requireStrings(stock, ["ticker", "name", "market", "currency", "assetType", "sector", "status", "investmentType", "thesisSummary", "currentView", "currentViewMemo", "createdAt", "updatedAt"], label);
  requireEnum(stock.market, markets, label, "시장");
  requireEnum(stock.currency, currencies, label, "통화");
  requireEnum(stock.status, stockStatuses, label, "상태");
  requireEnum(stock.investmentType, investmentTypes, label, "투자 유형");
  requireEnum(stock.currentView, stockViews, label, "현재 판단");
  if (stock.marketSector !== undefined && stock.marketSector !== null) requireEnum(stock.marketSector, marketSectors, label, "시장 섹터");
  if (stock.countryCode !== undefined && stock.countryCode !== null && (typeof stock.countryCode !== "string" || !/^[A-Z]{2}$/.test(stock.countryCode))) throw new Error(`${label}의 국가 코드가 올바르지 않습니다.`);
  if (stock.providerRefs !== undefined) { if (!Array.isArray(stock.providerRefs)) throw new Error(`${label}의 provider 연결이 올바르지 않습니다.`); for (const ref of stock.providerRefs) { if (!isRecord(ref) || !remoteMarketDataProviders.includes(ref.provider as typeof remoteMarketDataProviders[number]) || typeof ref.symbol !== "string" || !ref.symbol.trim()) throw new Error(`${label}의 provider 연결이 올바르지 않습니다.`); } }
  if (stock.quotePreference !== undefined) requireEnum(stock.quotePreference, quotePreferences, label, "가격 제공자 설정");
  if (stock.priceFreshness !== undefined) requireEnum(stock.priceFreshness, quoteFreshnessValues, label, "가격 시점");
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
  if (stock.priceSource !== undefined) requireEnum(stock.priceSource, marketDataProviders, label, "가격 출처");
  if (stock.priceStatus !== undefined) requireEnum(stock.priceStatus, priceStatuses, label, "가격 상태");
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
  requireStrings(observation, ["stockName", "observedAt", "title", "content", "marketCondition", "stockView", "createdAt", "updatedAt"], label);
  const scope = observation.scope ?? "stock";
  if (scope !== "stock" && scope !== "market") throw new Error(`${label}의 관찰 대상이 올바르지 않습니다.`);
  const targets = observation.marketTargets ?? [];
  if (!Array.isArray(targets) || targets.some((target) => !isMarketTarget(target))) throw new Error(`${label}의 시장 대상이 올바르지 않습니다.`);
  if (scope === "stock" && (typeof observation.stockId !== "string" || !observation.stockId.trim())) throw new Error(`${label}의 종목 연결이 올바르지 않습니다.`);
  if (scope === "stock" && targets.length > 0) throw new Error(`${label}의 시장 대상이 올바르지 않습니다.`);
  if (scope === "market" && observation.stockId !== null) throw new Error(`${label}의 종목 연결이 올바르지 않습니다.`);
  if (scope === "market" && observation.stockName !== "") throw new Error(`${label}의 종목명이 올바르지 않습니다.`);
  if (scope === "market" && targets.length === 0) throw new Error(`${label}의 시장 대상을 하나 이상 선택해야 합니다.`);
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
  if (trade.accountId !== undefined && trade.accountId !== null && (typeof trade.accountId !== "string" || !trade.accountId.trim())) throw new Error(`${label}의 계좌 ID가 올바르지 않습니다.`);
  if (trade.cashFlowKind !== undefined) requireEnum(trade.cashFlowKind, ["external", "transfer", "reconciliation", "opening"] as const, label, "현금 흐름 유형");
  if (trade.transferId !== undefined && (typeof trade.transferId !== "string" || !trade.transferId.trim())) throw new Error(`${label}의 이체 ID가 올바르지 않습니다.`);
  if (trade.journalStatus !== undefined) requireEnum(trade.journalStatus, tradeJournalStatuses, label, "저널 상태");
  if (trade.origin !== undefined) {
    if (!isRecord(trade.origin)) throw new Error(`${label}의 출처가 올바르지 않습니다.`);
    requireEnum(trade.origin.kind, tradeOriginKinds, label, "출처 유형");
    for (const field of ["sourceKey", "provider", "externalExecutionId", "externalOrderId", "importBatchId"] as const) if (trade.origin[field] !== undefined && (typeof trade.origin[field] !== "string" || !trade.origin[field])) throw new Error(`${label}의 출처가 올바르지 않습니다.`);
    if (trade.origin.importedAt !== undefined) requireTimestamp(trade.origin.importedAt, label, "가져온 일시");
    if (trade.origin.sourceRow !== undefined && (!Number.isInteger(trade.origin.sourceRow) || Number(trade.origin.sourceRow) < 1)) throw new Error(`${label}의 원본 행이 올바르지 않습니다.`);
    if (trade.origin.timePrecision !== undefined) requireEnum(trade.origin.timePrecision, ["date", "minute", "second"] as const, label, "시간 정밀도");
    if (trade.origin.kind === "fileImport" || trade.origin.kind === "brokerApi") {
      if (typeof trade.origin.sourceKey !== "string" || !trade.origin.sourceKey || typeof trade.origin.importBatchId !== "string" || !trade.origin.importBatchId || !isTimestamp(trade.origin.importedAt)) throw new Error(`${label}의 가져오기 출처가 완전하지 않습니다.`);
    }
    if (trade.origin.kind === "brokerApi" && (typeof trade.origin.provider !== "string" || !trade.origin.provider)) throw new Error(`${label}의 API 제공자가 올바르지 않습니다.`);
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

export function validateBackupCollectionRecord(collection: string, value: unknown, index: number): void {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    throw new Error(`${collection} ${index + 1}번째 항목의 ID가 올바르지 않습니다.`);
  }
  switch (collection) {
    case "accounts": validateAccountRecord(value, index); break;
    case "stocks": validateStockRecord(value, index); break;
    case "plans": validatePlanRecord(value, index); break;
    case "trades": validateTradeRecord(value, index); break;
    case "observations": validateObservationRecord(value, index); break;
    case "reviews": validateReviewRecord(value, index); break;
    case "rules": validateRuleRecord(value, index); break;
    case "notes": validateNoteRecord(value, index); break;
    case "dashboard-notes": validateDashboardNoteRecord(value, index); break;
    case "earnings-events": validateEarningsEventRecord(value, index); break;
  }
}

function validateAccountRecord(account: Record<string, unknown>, index: number) {
  const label = `계좌 ${index + 1}번째 항목`;
  requireStrings(account, ["name", "institution", "kind", "subtype", "baseCurrency", "memo", "createdAt", "updatedAt"], label);
  if (!(account.name as string).trim()) throw new Error(`${label}의 이름이 비어 있습니다.`);
  requireEnum(account.kind, accountKinds, label, "유형");
  requireEnum(account.baseCurrency, currencies, label, "기준 통화");
  if (typeof account.isDefault !== "boolean") throw new Error(`${label}의 기본 계좌 값이 올바르지 않습니다.`);
  requireNullableTimestamp(account.archivedAt, label, "보관 일시");
  requireTimestamp(account.createdAt, label, "생성 일시");
  requireTimestamp(account.updatedAt, label, "수정 일시");
  if (account.feePolicy !== undefined && account.feePolicy !== null) {
    const result = validateAccountFeePolicy(account.feePolicy);
    if (!result.valid) throw new Error(`${label}의 ${result.issues[0]?.message ?? "수수료 정책이 올바르지 않습니다."}`);
    account.feePolicy = result.policy;
  }
}
