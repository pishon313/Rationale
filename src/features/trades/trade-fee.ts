import Decimal from "decimal.js";
import { currencies, type Currency } from "@/domain/currency";
import {
  accountFeeRoundingModes,
  normalizeFeeDecimal,
  type AccountFeeCalculationResult,
} from "@/features/accounts/account-fee-policy";
import { markets } from "@/features/stocks/types";
import { tradeFeeModes, type AccountFeeCalculationSnapshotV1, type Trade } from "./types";

const snapshotKeys = new Set<keyof AccountFeeCalculationSnapshotV1>([
  "version", "policyAccountId", "ruleId", "ruleName", "market", "currency", "side", "ratePercent", "fixedFee",
  "minimumFee", "maximumFee", "grossAmountFrom", "grossAmountTo", "effectiveFrom", "effectiveTo", "roundingMode",
  "roundingUnit", "tradedAtDate", "quantity", "price", "grossAmount", "calculatedFee", "calculatedAt",
]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export type TradeFeeMetadataValidationResult = { valid: true } | { valid: false; message: string };

export function createAccountFeeCalculationSnapshot(input: {
  policyAccountId: string;
  side: "buy" | "sell";
  tradedAt: string;
  quantity: Decimal.Value;
  price: Decimal.Value;
  currency: Currency;
  result: Extract<AccountFeeCalculationResult, { status: "matched" }>;
  calculatedAt?: string;
}): AccountFeeCalculationSnapshotV1 {
  const rule = input.result.rule;
  return {
    version: 1,
    policyAccountId: input.policyAccountId,
    ruleId: rule.id,
    ruleName: rule.name,
    market: rule.market,
    currency: input.currency,
    side: input.side,
    ratePercent: rule.ratePercent,
    fixedFee: rule.fixedFee,
    minimumFee: rule.minimumFee,
    maximumFee: rule.maximumFee,
    grossAmountFrom: rule.grossAmountFrom,
    grossAmountTo: rule.grossAmountTo,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
    roundingMode: rule.roundingMode,
    roundingUnit: rule.roundingUnit,
    tradedAtDate: input.tradedAt.slice(0, 10),
    quantity: decimalString(input.quantity),
    price: decimalString(input.price),
    grossAmount: input.result.grossAmount,
    calculatedFee: input.result.fee,
    calculatedAt: input.calculatedAt ?? new Date().toISOString(),
  };
}

export function validateTradeFeeMetadata(trade: Trade): TradeFeeMetadataValidationResult {
  if (trade.feeMode === undefined) {
    return trade.feeCalculation === undefined || trade.feeCalculation === null
      ? { valid: true }
      : invalid("수수료 출처 없이 계좌 수수료 계산 기록을 저장할 수 없습니다.");
  }
  if (!(tradeFeeModes as readonly unknown[]).includes(trade.feeMode)) return invalid("수수료 출처가 올바르지 않습니다.");
  if (trade.feeMode !== "accountPolicy") {
    return trade.feeCalculation === undefined || trade.feeCalculation === null
      ? { valid: true }
      : invalid("계좌 정책이 아닌 수수료에는 계좌 수수료 계산 기록을 저장할 수 없습니다.");
  }
  if (trade.tradeType !== "매수" && trade.tradeType !== "매도") return invalid("계좌 정책 수수료는 매수·매도 거래에만 사용할 수 있습니다.");
  if (trade.isOpeningPosition || trade.cashFlowKind !== undefined) return invalid("기초 포지션이나 현금 흐름에는 계좌 정책 수수료를 사용할 수 없습니다.");
  const snapshot = trade.feeCalculation;
  if (!isRecord(snapshot)) return invalid("계좌 수수료 계산 기록이 필요합니다.");
  if (Object.keys(snapshot).some((key) => !snapshotKeys.has(key as keyof AccountFeeCalculationSnapshotV1))) return invalid("지원하지 않는 계좌 수수료 계산 항목이 있습니다.");
  if (snapshot.version !== 1) return invalid("지원하지 않는 계좌 수수료 계산 버전입니다.");
  for (const key of ["policyAccountId", "ruleId", "ruleName"] as const) if (typeof snapshot[key] !== "string" || !snapshot[key].trim()) return invalid("계좌 수수료 계산 출처가 올바르지 않습니다.");
  if (snapshot.market !== "all" && !(markets as readonly unknown[]).includes(snapshot.market)) return invalid("계좌 수수료 계산 시장이 올바르지 않습니다.");
  if (!(currencies as readonly unknown[]).includes(snapshot.currency) || snapshot.currency !== trade.currency) return invalid("계좌 수수료 계산 통화가 거래 통화와 일치하지 않습니다.");
  const expectedSide = trade.tradeType === "매수" ? "buy" : "sell";
  if (snapshot.side !== expectedSide) return invalid("계좌 수수료 계산 매수·매도 구분이 거래와 일치하지 않습니다.");
  if (!(accountFeeRoundingModes as readonly unknown[]).includes(snapshot.roundingMode)) return invalid("계좌 수수료 계산 반올림 방식이 올바르지 않습니다.");
  if (!validDate(snapshot.effectiveFrom) || snapshot.effectiveTo !== null && !validDate(snapshot.effectiveTo) || !validDate(snapshot.tradedAtDate)) return invalid("계좌 수수료 계산 날짜가 올바르지 않습니다.");
  if (snapshot.effectiveTo !== null && snapshot.effectiveFrom > snapshot.effectiveTo) return invalid("계좌 수수료 계산 적용 기간이 올바르지 않습니다.");
  if (!isTimestamp(snapshot.calculatedAt)) return invalid("계좌 수수료 계산 시각이 올바르지 않습니다.");

  const requiredDecimals = ["ratePercent", "fixedFee", "roundingUnit", "quantity", "price", "grossAmount", "calculatedFee"] as const;
  for (const key of requiredDecimals) if (typeof snapshot[key] !== "string" || normalizeFeeDecimal(snapshot[key]) === null) return invalid("계좌 수수료 계산 숫자가 올바르지 않습니다.");
  const optionalDecimals = ["minimumFee", "maximumFee", "grossAmountFrom", "grossAmountTo"] as const;
  for (const key of optionalDecimals) if (snapshot[key] !== null && (typeof snapshot[key] !== "string" || normalizeFeeDecimal(snapshot[key]) === null)) return invalid("계좌 수수료 계산 숫자가 올바르지 않습니다.");

  try {
    const quantity = new Decimal(snapshot.quantity);
    const price = new Decimal(snapshot.price);
    const grossAmount = new Decimal(snapshot.grossAmount);
    const calculatedFee = new Decimal(snapshot.calculatedFee);
    const ratePercent = new Decimal(snapshot.ratePercent);
    const roundingUnit = new Decimal(snapshot.roundingUnit);
    const minimumFee = snapshot.minimumFee === null ? null : new Decimal(snapshot.minimumFee);
    const maximumFee = snapshot.maximumFee === null ? null : new Decimal(snapshot.maximumFee);
    const grossAmountFrom = snapshot.grossAmountFrom === null ? null : new Decimal(snapshot.grossAmountFrom);
    const grossAmountTo = snapshot.grossAmountTo === null ? null : new Decimal(snapshot.grossAmountTo);
    if (!quantity.greaterThan(0) || !price.greaterThan(0) || !roundingUnit.greaterThan(0) || ratePercent.greaterThan(100)) return invalid("계좌 수수료 계산 기준이 올바르지 않습니다.");
    if (minimumFee !== null && maximumFee !== null && minimumFee.greaterThan(maximumFee)) return invalid("계좌 수수료 계산 수수료 범위가 올바르지 않습니다.");
    if (grossAmountFrom !== null && grossAmountTo !== null && grossAmountFrom.greaterThanOrEqualTo(grossAmountTo)) return invalid("계좌 수수료 계산 거래금액 범위가 올바르지 않습니다.");
    if (!quantity.mul(price).equals(grossAmount)) return invalid("계좌 수수료 계산 거래금액이 수량과 가격에 맞지 않습니다.");
    if (!quantity.equals(trade.quantity) || !price.equals(trade.price) || snapshot.tradedAtDate !== trade.tradedAt.slice(0, 10)) return invalid("계좌 수수료 계산 기준이 현재 거래와 일치하지 않습니다.");
    if (snapshot.tradedAtDate < snapshot.effectiveFrom || snapshot.effectiveTo !== null && snapshot.tradedAtDate > snapshot.effectiveTo) return invalid("계좌 수수료 계산 날짜가 규칙 적용 기간과 일치하지 않습니다.");
    if (grossAmountFrom !== null && grossAmount.lessThan(grossAmountFrom) || grossAmountTo !== null && grossAmount.greaterThanOrEqualTo(grossAmountTo)) return invalid("계좌 수수료 계산 거래금액이 규칙 적용 범위와 일치하지 않습니다.");
    const beforeMinimum = grossAmount.mul(ratePercent).div(100).add(snapshot.fixedFee);
    const afterMinimum = minimumFee === null ? beforeMinimum : Decimal.max(beforeMinimum, minimumFee);
    const afterMaximum = maximumFee === null ? afterMinimum : Decimal.min(afterMinimum, maximumFee);
    const rounding = snapshot.roundingMode === "floor" ? Decimal.ROUND_FLOOR : snapshot.roundingMode === "ceil" ? Decimal.ROUND_CEIL : Decimal.ROUND_HALF_UP;
    const reconstructedFee = afterMaximum.div(roundingUnit).toDecimalPlaces(0, rounding).mul(roundingUnit);
    if (!reconstructedFee.equals(calculatedFee)) return invalid("계좌 수수료 계산 결과를 스냅샷에서 재현할 수 없습니다.");
    if (new Decimal(trade.fee).minus(calculatedFee).abs().greaterThan(currencyMinorUnit(trade.currency))) return invalid("저장된 수수료와 계좌 수수료 계산 결과가 일치하지 않습니다.");
  } catch {
    return invalid("계좌 수수료 계산 숫자가 올바르지 않습니다.");
  }
  return { valid: true };
}

export function assertValidTradeFeeMetadata(trade: Trade) {
  const result = validateTradeFeeMetadata(trade);
  if (!result.valid) throw new Error(result.message);
}

export function currencyMinorUnit(currency: Currency) {
  return currency === "KRW" || currency === "JPY" ? 1 : 0.01;
}

function decimalString(value: Decimal.Value) {
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.isNegative()) throw new Error("invalid decimal");
  return decimal.isZero() ? "0" : decimal.toFixed();
}
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function isTimestamp(value: unknown) { return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value)); }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function invalid(message: string): TradeFeeMetadataValidationResult { return { valid: false, message }; }
