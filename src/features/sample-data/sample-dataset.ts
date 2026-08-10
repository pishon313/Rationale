import { buildTradingLedger } from "@/domain/trading-ledger";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Note } from "@/features/notes/types";
import type { Observation } from "@/features/observations/types";
import type { BuyPlan } from "@/features/plans/types";
import type { Review } from "@/features/reviews/types";
import type { InvestmentRule } from "@/features/rules/types";
import { validateBackupCollectionRecord } from "@/features/settings/backup";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";

export const sampleIdPrefix = "sample:v1:";
export const sampleCollectionNames = ["accounts", "stocks", "trades", "plans", "observations", "reviews", "rules", "notes"] as const;
export type SampleCollectionName = (typeof sampleCollectionNames)[number];
export type SampleDataset = { accounts: InvestmentAccount[]; stocks: Stock[]; trades: Trade[]; plans: BuyPlan[]; observations: Observation[]; reviews: Review[]; rules: InvestmentRule[]; notes: Note[] };

const ids = {
  general: "sample:v1:account:general", isa: "sample:v1:account:isa",
  samsung: "sample:v1:stock:samsung", nvda: "sample:v1:stock:nvda", voo: "sample:v1:stock:voo", hyundai: "sample:v1:stock:hyundai",
  nvdaPlan: "sample:v1:plan:nvda-add", hyundaiPlan: "sample:v1:plan:hyundai-watch",
  samsungSell: "sample:v1:trade:samsung-sell-1",
} as const;

export function buildSampleDataset(now: Date | string): SampleDataset {
  const anchor = new Date(now);
  if (!Number.isFinite(anchor.getTime())) throw new Error("샘플 데이터 기준 날짜가 올바르지 않습니다.");
  const at = (days: number) => new Date(anchor.getTime() + days * 86_400_000).toISOString();
  const date = (days: number) => at(days).slice(0, 10);
  const createdAt = at(-180);
  const accounts: InvestmentAccount[] = [
    { id: ids.general, name: "샘플 · 일반계좌", institution: "Demo Securities", kind: "brokerage", subtype: "종합", baseCurrency: "KRW", isDefault: true, archivedAt: null, memo: "가상의 샘플 계좌", createdAt, updatedAt: at(-7) },
    { id: ids.isa, name: "샘플 · ISA", institution: "Demo Securities", kind: "taxAdvantaged", subtype: "중개형", baseCurrency: "KRW", isDefault: false, archivedAt: null, memo: "가상의 샘플 계좌", createdAt, updatedAt: at(-7) },
  ];
  const stock = (value: Partial<Stock> & Pick<Stock, "id" | "ticker" | "name" | "market" | "currency">): Stock => ({ assetType: "주식", sector: "", status: "관찰", investmentType: "중기 투자", currentPrice: 0, priceUpdatedAt: at(-7), priceQuotedAt: null, priceSource: "manual", priceStatus: "manual", targetPrice: null, averagePrice: 0, quantity: 0, thesisSummary: "", currentView: "중립", currentViewMemo: "", nextReviewDate: date(7), nextEarningsDate: null, ledgerInitializedAt: at(-180), tags: ["샘플"], createdAt, updatedAt: at(-7), deletedAt: null, ...value });
  const stocks: Stock[] = [
    stock({ id: ids.samsung, ticker: "005930", name: "삼성전자", market: "한국", currency: "KRW", status: "보유", investmentType: "장기 코어", currentPrice: 79000, targetPrice: 90000, sector: "반도체", thesisSummary: "메모리 업황 회복과 HBM 경쟁력을 장기 관찰합니다.", currentView: "강세", currentViewMemo: "실적과 메모리 가격을 함께 확인" }),
    stock({ id: ids.nvda, ticker: "NVDA", name: "NVIDIA", market: "미국", currency: "USD", status: "보유", currentPrice: 135, targetPrice: 150, sector: "Semiconductors", thesisSummary: "데이터센터 성장률과 마진 지속성을 확인합니다.", currentView: "강세", nextEarningsDate: date(14) }),
    stock({ id: ids.voo, ticker: "VOO", name: "Vanguard S&P 500 ETF", market: "미국", currency: "USD", assetType: "ETF", status: "보유", investmentType: "장기 코어", currentPrice: 540, sector: "Broad Market", thesisSummary: "미국 대형주 시장에 장기 분산 투자합니다." }),
    stock({ id: ids.hyundai, ticker: "005380", name: "현대차", market: "한국", currency: "KRW", status: "관찰", investmentType: "관찰 전용", currentPrice: 245000, targetPrice: 230000, sector: "자동차", thesisSummary: "환율과 판매 믹스 개선 여부를 관찰합니다.", ledgerInitializedAt: null }),
  ];
  const trade = (value: Partial<Trade> & Pick<Trade, "id" | "tradeType" | "tradedAt" | "currency" | "accountId" | "accountName">): Trade => ({ stockId: null, stockName: "", planId: null, quantity: 0, price: 0, exchangeRate: value.currency === "KRW" ? 1 : 1380, fee: 0, tax: 0, memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 4, ruleViolations: [], createdAt: value.tradedAt, updatedAt: value.tradedAt, deletedAt: null, ...value });
  const trades: Trade[] = [
    trade({ id: "sample:v1:trade:krw-deposit", tradeType: "입금", tradedAt: at(-170), currency: "KRW", accountId: ids.general, accountName: accounts[0].name, amount: 8_000_000, cashFlowKind: "external" }),
    trade({ id: "sample:v1:trade:samsung-buy-1", stockId: ids.samsung, stockName: "삼성전자", tradeType: "매수", tradedAt: at(-160), quantity: 40, price: 70000, fee: 1400, currency: "KRW", accountId: ids.general, accountName: accounts[0].name, memo: "1차 분할매수" }),
    trade({ id: "sample:v1:trade:samsung-buy-2", stockId: ids.samsung, stockName: "삼성전자", tradeType: "매수", tradedAt: at(-120), quantity: 20, price: 74000, fee: 740, currency: "KRW", accountId: ids.general, accountName: accounts[0].name, memo: "실적 확인 후 2차 매수" }),
    trade({ id: ids.samsungSell, stockId: ids.samsung, stockName: "삼성전자", tradeType: "매도", tradedAt: at(-30), quantity: 15, price: 82000, fee: 615, tax: 22140, currency: "KRW", accountId: ids.general, accountName: accounts[0].name, memo: "목표 구간에서 일부 이익 실현" }),
    trade({ id: "sample:v1:trade:usd-deposit", tradeType: "입금", tradedAt: at(-150), currency: "USD", exchangeRate: 1365, accountId: ids.isa, accountName: accounts[1].name, amount: 1500, cashFlowKind: "external" }),
    trade({ id: "sample:v1:trade:nvda-buy-1", stockId: ids.nvda, stockName: "NVIDIA", tradeType: "매수", tradedAt: at(-140), quantity: 0.35, price: 110, exchangeRate: 1368, fee: 0.1, currency: "USD", accountId: ids.isa, accountName: accounts[1].name, memo: "실적 후 소수점 1차 매수" }),
    trade({ id: "sample:v1:trade:nvda-buy-2", stockId: ids.nvda, stockName: "NVIDIA", planId: ids.nvdaPlan, tradeType: "매수", tradedAt: at(-90), quantity: 0.17, price: 120, exchangeRate: 1375, fee: 0.1, currency: "USD", accountId: ids.isa, accountName: accounts[1].name, memo: "계획에 따른 추가 매수" }),
    trade({ id: "sample:v1:trade:nvda-sell-1", stockId: ids.nvda, stockName: "NVIDIA", planId: ids.nvdaPlan, tradeType: "매도", tradedAt: at(-20), quantity: 0.12, price: 145, exchangeRate: 1390, fee: 0.1, currency: "USD", accountId: ids.isa, accountName: accounts[1].name, memo: "일부 이익 실현" }),
    trade({ id: "sample:v1:trade:voo-buy-1", stockId: ids.voo, stockName: "Vanguard S&P 500 ETF", tradeType: "매수", tradedAt: at(-80), quantity: 1.25, price: 500, exchangeRate: 1382, fee: 0.5, currency: "USD", accountId: ids.isa, accountName: accounts[1].name, memo: "장기 코어 편입" }),
    trade({ id: "sample:v1:trade:voo-dividend-1", stockId: ids.voo, stockName: "Vanguard S&P 500 ETF", tradeType: "배당", tradedAt: at(-7), amount: 6, currency: "USD", exchangeRate: 1392, accountId: ids.isa, accountName: accounts[1].name, memo: "분기 배당" }),
  ];
  const plans: BuyPlan[] = [
    { id: ids.nvdaPlan, stockId: ids.nvda, stockName: "NVIDIA", ticker: "NVDA", title: "실적 확인 후 추가매수", scenarioType: "실적 확인 후 진입", conditionType: "실적 발표 후", conditionDescription: "데이터센터 성장률과 가이던스 확인", targetPrice: 125, stopLossPrice: 105, takeProfitPrice: 155, priceRangeMin: 118, priceRangeMax: 128, plannedAmount: 300, plannedQuantity: 2, plannedPortfolioPercent: 8, priority: 1, status: "일부 실행", invalidationCondition: "성장률 둔화와 마진 급락", expectedHoldingPeriod: "1년 이상", memo: "한 번에 매수하지 않고 분할", conditions: [{ id: "sample:v1:condition:nvda-earnings", label: "실적 가이던스 확인", isRequired: true, isSatisfied: true }], createdAt: at(-100), updatedAt: at(-20), executedAt: at(-90), deletedAt: null },
    { id: ids.hyundaiPlan, stockId: ids.hyundai, stockName: "현대차", ticker: "005380", title: "가격과 판매 지표 확인 후 진입", scenarioType: "눌림목", conditionType: "가격 범위 진입", conditionDescription: "목표 가격대와 월간 판매 확인", targetPrice: 230000, stopLossPrice: 210000, takeProfitPrice: 280000, priceRangeMin: 225000, priceRangeMax: 235000, plannedAmount: 2_300_000, plannedQuantity: 10, plannedPortfolioPercent: 10, priority: 2, status: "관찰 중", invalidationCondition: "판매량 추세 악화", expectedHoldingPeriod: "6~12개월", memo: "조건 충족 전에는 매수하지 않기", conditions: [{ id: "sample:v1:condition:hyundai-price", label: "목표 가격 범위 진입", isRequired: true, isSatisfied: false }], createdAt: at(-30), updatedAt: at(-7), executedAt: null, deletedAt: null },
  ];
  const observations: Observation[] = [
    { id: "sample:v1:observation:samsung-hbm", stockId: ids.samsung, stockName: "삼성전자", observedAt: at(-14), title: "HBM 경쟁력과 메모리 가격 재확인", content: "다음 실적에서 HBM 공급 확대와 메모리 가격 추세를 함께 확인한다.", marketCondition: "반도체 업황 회복", stockView: "강세", tags: ["샘플", "HBM"], attachmentUrls: [], createdAt: at(-14), updatedAt: at(-14), deletedAt: null },
    { id: "sample:v1:observation:nvda-earnings", stockId: ids.nvda, stockName: "NVIDIA", observedAt: at(-7), title: "실적 발표 후 데이터센터 성장률 확인", content: "매출 성장뿐 아니라 마진과 다음 분기 가이던스를 확인한다.", marketCondition: "AI 투자 지속", stockView: "강세", tags: ["샘플", "실적"], attachmentUrls: [], createdAt: at(-7), updatedAt: at(-7), deletedAt: null },
  ];
  const reviews: Review[] = [{ id: "sample:v1:review:samsung-partial-sell", stockId: ids.samsung, stockName: "삼성전자", tradeId: ids.samsungSell, reviewedAt: at(-7), result: "일부 매도로 수익을 확정하고 잔여 포지션을 유지했다.", decisionQuality: "목표 구간을 미리 정한 점은 좋았다.", executionQuality: "분할 매도 원칙을 지켰다.", planCompliance: true, emotionState: "평온", strengths: "가격보다 계획을 우선했다.", mistakes: "매도 후 검토 기준을 더 구체화할 필요가 있다.", nextAction: "다음 실적 발표 후 잔여 비중 검토", lessons: "부분 매도는 판단 부담을 낮춘다.", strategyTags: ["분할매도"], mistakeTags: [], attachmentUrls: [], evaluation: "좋은 판단, 좋은 결과", resultScore: 4, processScore: 5, createdAt: at(-7), updatedAt: at(-7), deletedAt: null }];
  const rules: InvestmentRule[] = [
    { id: "sample:v1:rule:no-chasing", title: "추격 매수 금지", description: "계획한 가격 범위를 벗어나 급등할 때는 신규 매수하지 않습니다.", ruleType: "필수 체크리스트", thresholdValue: null, thresholdUnit: "", isActive: true, severity: "경고", createdAt, updatedAt: at(-7), deletedAt: null },
    { id: "sample:v1:rule:max-position", title: "한 종목 최대 비중", description: "한 종목의 목표 비중을 제한합니다.", ruleType: "최대 종목 비중", thresholdValue: 20, thresholdUnit: "%", isActive: true, severity: "주의", createdAt, updatedAt: at(-7), deletedAt: null },
    { id: "sample:v1:rule:review-thesis", title: "매수 전 투자 근거 확인", description: "매수 전 관찰 기록과 투자 근거를 다시 읽습니다.", ruleType: "필수 체크리스트", thresholdValue: null, thresholdUnit: "", isActive: true, severity: "안내", createdAt, updatedAt: at(-7), deletedAt: null },
  ];
  const notes: Note[] = [{ id: "sample:v1:note:getting-started", title: "샘플 데이터 사용 가이드", content: "이 기록은 Rationale의 주요 기능을 둘러보기 위한 가상의 투자 기록입니다. 실제 계좌나 금융 조언이 아닙니다. 설정에서 안전하게 제거할 수 있습니다.", createdAt, updatedAt: at(-7), deletedAt: null }];
  const dataset = { accounts, stocks, trades, plans, observations, reviews, rules, notes };
  validateSampleDataset(dataset);
  return dataset;
}

export function knownSampleIds(dataset: SampleDataset) { return Object.fromEntries(sampleCollectionNames.map((name) => [name, new Set(dataset[name].map((item) => item.id))])) as { [K in SampleCollectionName]: Set<string> } }

export function validateSampleDataset(dataset: SampleDataset) {
  const known = knownSampleIds(dataset);
  for (const name of sampleCollectionNames) dataset[name].forEach((record, index) => { if (!record.id.startsWith(sampleIdPrefix)) throw new Error(`샘플 ID namespace 오류: ${record.id}`); validateBackupCollectionRecord(name, record, index); });
  const requireId = (set: Set<string>, value: string | null | undefined, label: string) => { if (value && !set.has(value)) throw new Error(`${label} 참조 오류: ${value}`); };
  dataset.trades.forEach((item) => { requireId(known.accounts, item.accountId, "Trade.accountId"); requireId(known.stocks, item.stockId, "Trade.stockId"); requireId(known.plans, item.planId, "Trade.planId"); });
  dataset.plans.forEach((item) => requireId(known.stocks, item.stockId, "Plan.stockId"));
  dataset.observations.forEach((item) => requireId(known.stocks, item.stockId, "Observation.stockId"));
  dataset.reviews.forEach((item) => { requireId(known.stocks, item.stockId, "Review.stockId"); requireId(known.trades, item.tradeId, "Review.tradeId"); });
  const ledger = buildTradingLedger(dataset.trades, dataset.accounts);
  if (ledger.errors.length) throw new Error(`샘플 원장 오류: ${ledger.errors[0].message}`);
  return ledger;
}
