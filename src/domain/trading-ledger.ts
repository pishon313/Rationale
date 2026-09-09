import Decimal from "decimal.js";
import { currencies, fallbackRatesToKrw, type RatesToKrw } from "./currency";
import { applyBuy, applySell, emptyPosition, type Position } from "./portfolio";
import { journalStatusOf, tradeOriginOf, tradeTypes, type Trade } from "@/features/trades/types";
import { assertValidTradeFeeMetadata } from "@/features/trades/trade-fee";
import { accountIdentity, cashTrackingOf, normalizeLegacyAccountName, type InvestmentAccount } from "@/features/accounts/types";

export type LedgerPosition = {
  key: string; stockId: string; stockName: string; accountId: string; accountName: string; currency: Trade["currency"];
  quantity: number; averagePrice: number; investedAmount: number; investedAmountKrw: number; realizedProfit: number; realizedProfitKrw: number;
};
export type TradeCapitalBalance = { accountId: string; accountName: string; currency: Trade["currency"]; netAmount: number; netAmountKrw: number };
export type CashBalance = {
  accountId: string; accountName: string; currency: Trade["currency"];
  baselineBalance: number; baselineAsOf: string; balance: number; isNegative: boolean;
  /** Compatibility flag retained for older Portfolio reconciliation readers. Baseline-driven balances are reconciled by definition. */
  isReconciled: boolean;
};
export type PositionCycle = {
  id: string; stockId: string; stockName: string; accountId: string; accountName: string; currency: Trade["currency"];
  sequence: number; openedAt: string; closedAt: string | null; tradeIds: string[]; realizedProfit: number; realizedProfitKrw: number;
};
export type TradeCalculation = {
  tradeId: string; positionCycleId: string | null; capitalEffect: number | null; capitalEffectKrw: number | null; cashEffect: number | null; realizedProfit: number; realizedProfitKrw: number;
  quantityAfter: number | null; averagePriceAfter: number | null; error: string | null;
};
export type TradingLedger = {
  positions: LedgerPosition[]; tradeCapitalBalances: TradeCapitalBalance[]; cashBalances: CashBalance[]; cycles: PositionCycle[];
  calculations: Record<string, TradeCalculation>; errors: Array<{ tradeId: string; message: string }>;
  totalNetTradeCapitalKrw: number; totalRealizedKrw: number;
};

type InternalPosition = { value: Position; investedAmountKrw: Decimal; realizedProfitKrw: Decimal; stockId: string; stockName: string; accountId: string; accountName: string; currency: Trade["currency"] };
type InternalCycle = Omit<PositionCycle, "realizedProfit" | "realizedProfitKrw"> & { realizedProfit: Decimal; realizedProfitKrw: Decimal };
type InternalTradeCapital = { accountId: string; accountName: string; currency: Trade["currency"]; netAmount: Decimal; netAmountKrw: Decimal };
type InternalCash = { accountId: string; accountName: string; currency: Trade["currency"]; baselineBalance: Decimal; baselineAsOf: string; value: Decimal };

export function normalizeTrade(trade: Trade): Trade {
  return {
    ...trade,
    accountId: trade.accountId?.trim() || null,
    amount: trade.amount ?? undefined,
    exchangeRate: Number.isFinite(trade.exchangeRate) ? trade.exchangeRate : fallbackRatesToKrw[trade.currency],
    accountName: trade.accountName?.trim() || "기본 계좌",
    cashFlowKind: trade.cashFlowKind ?? (trade.isOpeningPosition ? "opening" : trade.tradeType === "입금" || trade.tradeType === "출금" ? "external" : undefined),
    memo: trade.memo ?? "",
    emotion: trade.emotion || "평온",
    emotionIntensity: trade.emotionIntensity || 1,
    confidenceScore: trade.confidenceScore || 3,
    ruleComplianceScore: trade.ruleComplianceScore || 3,
    ruleViolations: trade.ruleViolations ?? [],
    journalStatus: journalStatusOf(trade),
    origin: tradeOriginOf(trade),
    updatedAt: trade.updatedAt ?? trade.createdAt,
    deletedAt: trade.deletedAt ?? null,
  };
}

export function buildTradingLedger(input: Trade[], accounts: readonly InvestmentAccount[] = []): TradingLedger {
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const trades = input.map(normalizeTrade).filter((trade) => !trade.deletedAt).sort(compareTrades);
  const tradeIdCounts = new Map<string, number>();
  for (const trade of trades) tradeIdCounts.set(trade.id, (tradeIdCounts.get(trade.id) ?? 0) + 1);
  const duplicateTradeIds = new Set([...tradeIdCounts].filter(([, count]) => count > 1).map(([id]) => id));
  const positions = new Map<string, InternalPosition>();
  const tradeCapital = new Map<string, InternalTradeCapital>();
  const cash = new Map<string, InternalCash>();
  for (const account of accounts) {
    if (account.archivedAt) continue;
    for (const baseline of cashTrackingOf(account).baselines) {
      const balance = new Decimal(baseline.balance);
      cash.set(cashKey(account.id, baseline.currency), { accountId: account.id, accountName: account.name, currency: baseline.currency, baselineBalance: balance, baselineAsOf: baseline.asOf, value: balance });
    }
  }
  const activeCycles = new Map<string, string>();
  const cycleCounts = new Map<string, number>();
  const cycles = new Map<string, InternalCycle>();
  const calculations: Record<string, TradeCalculation> = {};
  const errors: Array<{ tradeId: string; message: string }> = [];
  let totalNetTradeCapitalKrw = new Decimal(0);
  let totalRealizedKrw = new Decimal(0);

  for (const trade of trades) {
    const base: TradeCalculation = { tradeId: trade.id, positionCycleId: null, capitalEffect: null, capitalEffectKrw: null, cashEffect: null, realizedProfit: 0, realizedProfitKrw: 0, quantityAfter: null, averagePriceAfter: null, error: null };
    if (duplicateTradeIds.has(trade.id)) {
      if (!calculations[trade.id]) {
        const message = "중복된 거래 ID가 있습니다.";
        calculations[trade.id] = { ...base, error: message };
        errors.push({ tradeId: trade.id, message });
      }
      continue;
    }
    try {
      validateTrade(trade);
      const accountId = accountIdentity(trade);
      const accountName = accountNames.get(accountId) ?? normalizeLegacyAccountName(trade.accountName);
      if (trade.tradeType === "매수" || trade.tradeType === "매도") {
        const stockId = trade.stockId as string;
        const key = positionKey(accountId, stockId, trade.currency);
        const current = positions.get(key) ?? { value: emptyPosition(), investedAmountKrw: new Decimal(0), realizedProfitKrw: new Decimal(0), stockId, stockName: trade.stockName, accountId, accountName, currency: trade.currency };
        let cycleId = activeCycles.get(key) ?? null;
        const beforeRealized = current.value.realizedProfit;
        const gross = new Decimal(trade.quantity).mul(trade.price);
        const costs = new Decimal(trade.fee).add(trade.tax);
        const next = trade.tradeType === "매수"
          ? applyBuy(current.value, trade.quantity, trade.price, costs)
          : applySell(current.value, trade.quantity, trade.price, trade.fee, trade.tax);
        if (trade.tradeType === "매수" && current.value.quantity.isZero()) {
          const sequence = (cycleCounts.get(key) ?? 0) + 1;
          cycleCounts.set(key, sequence);
          cycleId = `${key}:${trade.id}`;
          activeCycles.set(key, cycleId);
          cycles.set(cycleId, { id: cycleId, stockId, stockName: trade.stockName, accountId, accountName, currency: trade.currency, sequence, openedAt: trade.tradedAt, closedAt: null, tradeIds: [], realizedProfit: new Decimal(0), realizedProfitKrw: new Decimal(0) });
        }
        if (!cycleId) throw new Error("연결할 매수 포지션이 없습니다.");
        const realized = next.realizedProfit.sub(beforeRealized);
        const baseCostChange = trade.tradeType === "매수"
          ? gross.add(costs).mul(trade.exchangeRate)
          : current.investedAmountKrw.div(current.value.quantity).mul(trade.quantity).neg();
        const realizedKrw = trade.tradeType === "매도"
          ? gross.sub(costs).mul(trade.exchangeRate).sub(baseCostChange.neg())
          : new Decimal(0);
        const investedAmountKrw = next.quantity.isZero() ? new Decimal(0) : current.investedAmountKrw.add(baseCostChange);
        positions.set(key, { ...current, stockName: trade.stockName, currency: trade.currency, value: next, investedAmountKrw, realizedProfitKrw: current.realizedProfitKrw.add(realizedKrw) });
        const cycle = cycles.get(cycleId);
        if (cycle) { cycle.tradeIds.push(trade.id); cycle.realizedProfit = cycle.realizedProfit.add(realized); cycle.realizedProfitKrw = cycle.realizedProfitKrw.add(realizedKrw); if (next.quantity.isZero()) { cycle.closedAt = trade.tradedAt; activeCycles.delete(key); } }
        totalRealizedKrw = totalRealizedKrw.add(realizedKrw);
        base.positionCycleId = cycleId;
        base.realizedProfit = realized.toNumber();
        base.realizedProfitKrw = realizedKrw.toNumber();
        base.quantityAfter = next.quantity.toNumber();
        base.averagePriceAfter = next.averagePrice.toNumber();
        if (!trade.isOpeningPosition) {
          const capitalEffect = trade.tradeType === "매수" ? gross.add(costs) : gross.sub(costs).neg();
          const capitalEffectKrw = capitalEffect.mul(trade.exchangeRate);
          applyTradeCapital(tradeCapital, trade, accountId, accountName, capitalEffect, capitalEffectKrw);
          totalNetTradeCapitalKrw = totalNetTradeCapitalKrw.add(capitalEffectKrw);
          base.capitalEffect = capitalEffect.toNumber();
          base.capitalEffectKrw = capitalEffectKrw.toNumber();
        }
      }
      const cashEntry = cash.get(cashKey(accountId, trade.currency));
      if (!trade.isOpeningPosition && cashEntry && Date.parse(trade.tradedAt) > Date.parse(cashEntry.baselineAsOf)) {
        const cashEffect = calculateCashEffect(trade);
        cashEntry.value = cashEntry.value.add(cashEffect);
        base.cashEffect = cashEffect.toNumber();
      }
      calculations[trade.id] = base;
    } catch (error) {
      const message = error instanceof Error ? error.message : "원장을 계산할 수 없습니다.";
      calculations[trade.id] = { ...base, error: message };
      errors.push({ tradeId: trade.id, message });
    }
  }

  return {
    positions: [...positions].map(([key, item]) => ({ key, stockId: item.stockId, stockName: item.stockName, accountId: item.accountId, accountName: item.accountName, currency: item.currency, quantity: item.value.quantity.toNumber(), averagePrice: item.value.averagePrice.toNumber(), investedAmount: item.value.investedAmount.toNumber(), investedAmountKrw: item.investedAmountKrw.toNumber(), realizedProfit: item.value.realizedProfit.toNumber(), realizedProfitKrw: item.realizedProfitKrw.toNumber() })),
    tradeCapitalBalances: [...tradeCapital.values()].map((item) => ({ accountId: item.accountId, accountName: item.accountName, currency: item.currency, netAmount: item.netAmount.toNumber(), netAmountKrw: item.netAmountKrw.toNumber() })).sort((a, b) => a.accountName.localeCompare(b.accountName) || a.currency.localeCompare(b.currency)),
    cashBalances: [...cash.values()].map((item) => ({ accountId: item.accountId, accountName: item.accountName, currency: item.currency, baselineBalance: item.baselineBalance.toNumber(), baselineAsOf: item.baselineAsOf, balance: item.value.toNumber(), isNegative: item.value.isNegative(), isReconciled: true as const })).sort((a, b) => a.accountName.localeCompare(b.accountName) || a.currency.localeCompare(b.currency)),
    cycles: [...cycles.values()].map((cycle) => ({ ...cycle, realizedProfit: cycle.realizedProfit.toNumber(), realizedProfitKrw: cycle.realizedProfitKrw.toNumber() })),
    calculations, errors, totalNetTradeCapitalKrw: totalNetTradeCapitalKrw.toNumber(), totalRealizedKrw: totalRealizedKrw.toNumber(),
  };
}

export function aggregatePositions(ledger: TradingLedger) {
  const result = new Map<string, { stockId: string; stockName: string; currency: Trade["currency"]; quantity: number; investedAmount: number; averagePrice: number }>();
  for (const position of ledger.positions.filter((item) => item.quantity > 0)) {
    const current = result.get(position.stockId) ?? { stockId: position.stockId, stockName: position.stockName, currency: position.currency, quantity: 0, investedAmount: 0, averagePrice: 0 };
    current.quantity += position.quantity; current.investedAmount += position.investedAmount; current.averagePrice = current.quantity ? current.investedAmount / current.quantity : 0;
    result.set(position.stockId, current);
  }
  return result;
}

export function cashBalanceKrw(ledger: TradingLedger, input: RatesToKrw | number = fallbackRatesToKrw) { const rates = typeof input === "number" ? { ...fallbackRatesToKrw, USD: input } : input; return ledger.cashBalances.reduce((sum, item) => sum + item.balance * rates[item.currency], 0); }
export function tradeAmount(trade: Trade) { return trade.tradeType === "매수" || trade.tradeType === "매도" ? trade.quantity * trade.price : trade.amount ?? trade.quantity * trade.price; }
export function positionKey(accountId: string, stockId: string, currency?: Trade["currency"]) { return JSON.stringify(currency ? [accountId, stockId, currency] : [accountId, stockId]); }

function validateTrade(trade: Trade) {
  if (!isValidTimestamp(trade.tradedAt) || !isValidTimestamp(trade.createdAt)) throw new Error("거래 일시가 올바르지 않습니다.");
  if (!(tradeTypes as readonly string[]).includes(trade.tradeType)) throw new Error("거래 유형이 올바르지 않습니다.");
  if (!currencies.includes(trade.currency)) throw new Error("통화가 올바르지 않습니다.");
  if (trade.isOpeningPosition && trade.tradeType !== "매수") throw new Error("기초 포지션은 매수 유형이어야 합니다.");
  if (!trade.accountName.trim()) throw new Error("계좌명을 입력해 주세요.");
  if (![trade.quantity, trade.price, trade.amount ?? 0, trade.exchangeRate, trade.fee, trade.tax].every(Number.isFinite)) throw new Error("숫자 입력값이 올바르지 않습니다.");
  if (trade.exchangeRate <= 0) throw new Error("환율은 0보다 커야 합니다.");
  if (trade.currency === "KRW" && trade.exchangeRate !== 1) throw new Error("KRW 거래의 환율은 1이어야 합니다.");
  if (trade.fee < 0 || trade.tax < 0) throw new Error("수수료와 세금은 0 이상이어야 합니다.");
  assertValidTradeFeeMetadata(trade);
  if (trade.tradeType === "매수" || trade.tradeType === "매도") {
    if (!trade.stockId) throw new Error("종목을 선택해 주세요.");
    if (trade.quantity <= 0 || trade.price < 0 || (!trade.isOpeningPosition && trade.price === 0)) throw new Error("수량과 체결가는 0보다 커야 합니다.");
  } else if (tradeAmount(trade) <= 0) throw new Error("금액은 0보다 커야 합니다.");
}

function calculateCashEffect(trade: Trade) {
  const gross = new Decimal(tradeAmount(trade)); const costs = new Decimal(trade.fee).add(trade.tax);
  if (trade.tradeType === "매수") return gross.add(costs).neg();
  if (trade.tradeType === "매도" || trade.tradeType === "배당") return gross.sub(costs);
  if (trade.tradeType === "입금") return gross;
  return gross.add(costs).neg();
}
function applyTradeCapital(store: Map<string, InternalTradeCapital>, trade: Trade, accountId: string, accountName: string, effect: Decimal, effectKrw: Decimal) {
  const key = cashKey(accountId, trade.currency);
  const current = store.get(key);
  store.set(key, { accountId, accountName, currency: trade.currency, netAmount: (current?.netAmount ?? new Decimal(0)).add(effect), netAmountKrw: (current?.netAmountKrw ?? new Decimal(0)).add(effectKrw) });
}
function cashKey(accountId: string, currency: Trade["currency"]) { return JSON.stringify([accountId, currency]); }
function isValidTimestamp(value: string) { return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value)); }
function compareTrades(a: Trade, b: Trade) { return compareTimestamps(a.tradedAt, b.tradedAt) || compareTimestamps(a.createdAt, b.createdAt) || a.id.localeCompare(b.id); }
function compareTimestamps(a: string, b: string) {
  const aTime = Date.parse(a); const bTime = Date.parse(b);
  const aValid = Number.isFinite(aTime); const bValid = Number.isFinite(bTime);
  if (aValid && bValid && aTime !== bTime) return aTime - bTime;
  if (aValid !== bValid) return aValid ? -1 : 1;
  return a.localeCompare(b);
}
