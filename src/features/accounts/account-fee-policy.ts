import Decimal from "decimal.js";
import { currencies, type Currency } from "@/domain/currency";
import { markets, type Stock } from "@/features/stocks/types";

export const accountFeePolicyVersion = 1 as const;
export const accountFeeRuleSides = ["buy", "sell", "both"] as const;
export const accountFeeRoundingModes = ["floor", "round", "ceil"] as const;
export const maximumAccountFeeRules = 50;

export type AccountFeeRuleSide = (typeof accountFeeRuleSides)[number];
export type AccountFeeRoundingMode = (typeof accountFeeRoundingModes)[number];
export type AccountFeeRuleMarket = Stock["market"] | "all";

export type AccountFeeRuleV1 = {
  id: string;
  name: string;
  market: AccountFeeRuleMarket;
  currency: Currency;
  side: AccountFeeRuleSide;
  ratePercent: string;
  fixedFee: string;
  minimumFee: string | null;
  maximumFee: string | null;
  grossAmountFrom: string | null;
  grossAmountTo: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  roundingMode: AccountFeeRoundingMode;
  roundingUnit: string;
};

export type AccountFeePolicyV1 = {
  version: typeof accountFeePolicyVersion;
  enabled: boolean;
  rules: AccountFeeRuleV1[];
};

export type AccountFeePolicyIssue = {
  code: string;
  message: string;
  ruleId?: string;
  conflictingRuleIds?: string[];
};

export type AccountFeePolicyValidationResult =
  | { valid: true; policy: AccountFeePolicyV1 }
  | { valid: false; issues: AccountFeePolicyIssue[] };

export type AccountFeeCalculationInput = {
  accountId: string;
  market: Stock["market"];
  currency: Currency;
  side: Exclude<AccountFeeRuleSide, "both">;
  tradedAt: string;
  grossAmount: Decimal.Value;
};

export type AccountFeeBreakdown = {
  rateFee: string;
  fixedFee: string;
  beforeMinimum: string;
  afterMinimum: string;
  afterMaximum: string;
  roundingMode: AccountFeeRoundingMode;
  roundingUnit: string;
  fee: string;
};

export type AccountFeeCalculationResult =
  | { status: "matched"; rule: AccountFeeRuleV1; grossAmount: string; fee: string; breakdown: AccountFeeBreakdown }
  | { status: "policy-disabled" }
  | { status: "no-match" }
  | { status: "ambiguous"; ruleIds: string[] }
  | { status: "invalid-input"; code: string };

const policyKeys = new Set(["version", "enabled", "rules"]);
const ruleKeys = new Set([
  "id", "name", "market", "currency", "side", "ratePercent", "fixedFee", "minimumFee", "maximumFee",
  "grossAmountFrom", "grossAmountTo", "effectiveFrom", "effectiveTo", "roundingMode", "roundingUnit",
]);
const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeFeeDecimal(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !decimalPattern.test(trimmed)) return null;
  try {
    const decimal = new Decimal(trimmed);
    if (!decimal.isFinite()) return null;
    if (decimal.isZero()) return "0";
    if (decimal.isNegative()) return null;
    return decimal.toFixed();
  } catch {
    return null;
  }
}

export function validateAccountFeePolicy(value: unknown): AccountFeePolicyValidationResult {
  return validateAccountFeePolicyInternal(value, true);
}

function validateAccountFeePolicyInternal(value: unknown, rejectOverlaps: boolean): AccountFeePolicyValidationResult {
  const issues: AccountFeePolicyIssue[] = [];
  if (!isRecord(value)) return invalid("invalid-policy", "수수료 정책 형식을 확인해 주세요.");
  if (Object.keys(value).some((key) => !policyKeys.has(key))) issues.push(issue("unknown-policy-field", "지원하지 않는 수수료 정책 항목이 있습니다."));
  if (value.version !== accountFeePolicyVersion) issues.push(issue("unsupported-version", "지원하지 않는 수수료 정책 버전입니다."));
  if (typeof value.enabled !== "boolean") issues.push(issue("invalid-enabled", "수수료 정책 사용 여부를 확인해 주세요."));
  if (!Array.isArray(value.rules)) issues.push(issue("invalid-rules", "수수료 규칙 목록 형식을 확인해 주세요."));
  if (issues.length || !Array.isArray(value.rules) || typeof value.enabled !== "boolean" || value.version !== accountFeePolicyVersion) return { valid: false, issues };
  if (value.rules.length > maximumAccountFeeRules) issues.push(issue("too-many-rules", "수수료 규칙은 최대 50개까지 저장할 수 있습니다."));

  const normalizedRules: AccountFeeRuleV1[] = [];
  const ids = new Set<string>();
  for (const [index, rawRule] of value.rules.entries()) {
    const result = validateRule(rawRule, index);
    issues.push(...result.issues);
    if (!result.rule) continue;
    if (ids.has(result.rule.id)) issues.push({ ...issue("duplicate-rule-id", "수수료 규칙 ID가 중복되었습니다."), ruleId: result.rule.id });
    ids.add(result.rule.id);
    normalizedRules.push(result.rule);
  }
  if (!issues.length && rejectOverlaps) issues.push(...overlapIssues(normalizedRules));
  return issues.length ? { valid: false, issues } : { valid: true, policy: { version: 1, enabled: value.enabled, rules: normalizedRules } };
}

export function findAccountFeeRule(policy: AccountFeePolicyV1 | null | undefined, input: AccountFeeCalculationInput):
  | { status: "matched"; rule: AccountFeeRuleV1; grossAmount: string }
  | Exclude<AccountFeeCalculationResult, { status: "matched" }> {
  if (!policy?.enabled) return { status: "policy-disabled" };
  const validation = validateAccountFeePolicyInternal(policy, false);
  if (!validation.valid) return { status: "invalid-input", code: "invalid-policy" };
  if (!input.accountId.trim()) return { status: "invalid-input", code: "invalid-account-id" };
  if (!(markets as readonly string[]).includes(input.market)) return { status: "invalid-input", code: "invalid-market" };
  if (!(currencies as readonly string[]).includes(input.currency)) return { status: "invalid-input", code: "invalid-currency" };
  if (input.side !== "buy" && input.side !== "sell") return { status: "invalid-input", code: "invalid-side" };
  const tradeDate = dateFromTrade(input.tradedAt);
  if (!tradeDate) return { status: "invalid-input", code: "invalid-traded-at" };
  const grossAmount = decimalFromInput(input.grossAmount);
  if (!grossAmount) return { status: "invalid-input", code: "invalid-gross-amount" };

  const matches = validation.policy.rules.filter((rule) => matchesRule(rule, input, tradeDate, grossAmount));
  if (!matches.length) return { status: "no-match" };
  const bestSpecificity = Math.max(...matches.map(specificity));
  const best = matches.filter((rule) => specificity(rule) === bestSpecificity);
  if (best.length > 1) return { status: "ambiguous", ruleIds: best.map((rule) => rule.id).sort() };
  return { status: "matched", rule: best[0], grossAmount: decimalString(grossAmount) };
}

export function calculateAccountFee(policy: AccountFeePolicyV1 | null | undefined, input: AccountFeeCalculationInput): AccountFeeCalculationResult {
  const found = findAccountFeeRule(policy, input);
  if (found.status !== "matched") return found;
  try {
    const gross = new Decimal(found.grossAmount);
    const rateFee = gross.mul(found.rule.ratePercent).div(100);
    const beforeMinimum = rateFee.add(found.rule.fixedFee);
    const afterMinimum = found.rule.minimumFee === null ? beforeMinimum : Decimal.max(beforeMinimum, found.rule.minimumFee);
    const afterMaximum = found.rule.maximumFee === null ? afterMinimum : Decimal.min(afterMinimum, found.rule.maximumFee);
    const unit = new Decimal(found.rule.roundingUnit);
    const rounding = found.rule.roundingMode === "floor" ? Decimal.ROUND_FLOOR : found.rule.roundingMode === "ceil" ? Decimal.ROUND_CEIL : Decimal.ROUND_HALF_UP;
    const fee = afterMaximum.div(unit).toDecimalPlaces(0, rounding).mul(unit);
    const feeString = decimalString(fee);
    return {
      status: "matched",
      rule: found.rule,
      grossAmount: found.grossAmount,
      fee: feeString,
      breakdown: {
        rateFee: decimalString(rateFee),
        fixedFee: found.rule.fixedFee,
        beforeMinimum: decimalString(beforeMinimum),
        afterMinimum: decimalString(afterMinimum),
        afterMaximum: decimalString(afterMaximum),
        roundingMode: found.rule.roundingMode,
        roundingUnit: found.rule.roundingUnit,
        fee: feeString,
      },
    };
  } catch {
    return { status: "invalid-input", code: "calculation-failed" };
  }
}

export function createDefaultAccountFeeRule(currency: Currency, effectiveFrom: string, id: string, name = "기본 수수료"): AccountFeeRuleV1 {
  const wholeCurrency = currency === "KRW" || currency === "JPY";
  return {
    id,
    name,
    market: "all",
    currency,
    side: "both",
    ratePercent: "0",
    fixedFee: "0",
    minimumFee: null,
    maximumFee: null,
    grossAmountFrom: null,
    grossAmountTo: null,
    effectiveFrom,
    effectiveTo: null,
    roundingMode: wholeCurrency ? "floor" : "round",
    roundingUnit: wholeCurrency ? "1" : "0.01",
  };
}

export function accountFeePolicyStatus(policy: AccountFeePolicyV1 | null | undefined, t: (key: string, params?: Record<string, string | number>) => string) {
  return policy?.enabled ? t("수수료 자동 계산 · {count}개 규칙", { count: policy.rules.length }) : t("수수료 자동 계산 안 함");
}

function validateRule(value: unknown, index: number): { rule: AccountFeeRuleV1 | null; issues: AccountFeePolicyIssue[] } {
  const issues: AccountFeePolicyIssue[] = [];
  if (!isRecord(value)) return { rule: null, issues: [{ ...issue("invalid-rule", "수수료 규칙 형식을 확인해 주세요."), ruleId: `index:${index}` }] };
  if (Object.keys(value).some((key) => !ruleKeys.has(key))) issues.push(issue("unknown-rule-field", "지원하지 않는 수수료 규칙 항목이 있습니다."));
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!id) issues.push(issue("invalid-rule-id", "수수료 규칙 ID를 확인해 주세요."));
  if (name.length < 1 || name.length > 60) issues.push(issue("invalid-rule-name", "수수료 규칙 이름은 1~60자로 입력해 주세요."));
  if (value.market !== "all" && !(markets as readonly unknown[]).includes(value.market)) issues.push(issue("invalid-rule-market", "수수료 규칙 시장을 확인해 주세요."));
  if (!(currencies as readonly unknown[]).includes(value.currency)) issues.push(issue("invalid-rule-currency", "수수료 규칙 통화를 확인해 주세요."));
  if (!(accountFeeRuleSides as readonly unknown[]).includes(value.side)) issues.push(issue("invalid-rule-side", "수수료 규칙 매수·매도 구분을 확인해 주세요."));
  if (!(accountFeeRoundingModes as readonly unknown[]).includes(value.roundingMode)) issues.push(issue("invalid-rounding-mode", "수수료 반올림 방식을 확인해 주세요."));
  if (!validDate(value.effectiveFrom)) issues.push(issue("invalid-effective-from", "수수료 적용 시작일을 확인해 주세요."));
  if (value.effectiveTo !== null && !validDate(value.effectiveTo)) issues.push(issue("invalid-effective-to", "수수료 적용 종료일을 확인해 주세요."));
  if (validDate(value.effectiveFrom) && (value.effectiveTo === null || validDate(value.effectiveTo)) && value.effectiveTo !== null && value.effectiveFrom > value.effectiveTo) issues.push(issue("invalid-effective-range", "수수료 적용 종료일은 시작일보다 빠를 수 없습니다."));

  const ratePercent = requiredDecimal(value.ratePercent, "rate-percent", "수수료율을 0~100 사이의 숫자로 입력해 주세요.", issues);
  const fixedFee = requiredDecimal(value.fixedFee, "fixed-fee", "고정 수수료를 0 이상의 숫자로 입력해 주세요.", issues);
  const minimumFee = optionalDecimal(value.minimumFee, "minimum-fee", "최소 수수료를 0 이상의 숫자로 입력해 주세요.", issues);
  const maximumFee = optionalDecimal(value.maximumFee, "maximum-fee", "최대 수수료를 0 이상의 숫자로 입력해 주세요.", issues);
  const grossAmountFrom = optionalDecimal(value.grossAmountFrom, "gross-from", "거래금액 하한을 0 이상의 숫자로 입력해 주세요.", issues);
  const grossAmountTo = optionalDecimal(value.grossAmountTo, "gross-to", "거래금액 상한을 0 이상의 숫자로 입력해 주세요.", issues);
  const roundingUnit = requiredDecimal(value.roundingUnit, "rounding-unit", "반올림 단위는 0보다 큰 숫자여야 합니다.", issues);

  if (ratePercent !== null && new Decimal(ratePercent).greaterThan(100)) issues.push(issue("rate-too-high", "수수료율을 0~100 사이의 숫자로 입력해 주세요."));
  if (roundingUnit !== null && new Decimal(roundingUnit).isZero()) issues.push(issue("zero-rounding-unit", "반올림 단위는 0보다 큰 숫자여야 합니다."));
  if (minimumFee !== null && maximumFee !== null && new Decimal(minimumFee).greaterThan(maximumFee)) issues.push(issue("invalid-fee-range", "최소 수수료는 최대 수수료보다 클 수 없습니다."));
  if (grossAmountFrom !== null && grossAmountTo !== null && new Decimal(grossAmountFrom).greaterThanOrEqualTo(grossAmountTo)) issues.push(issue("invalid-gross-range", "거래금액 하한은 상한보다 작아야 합니다."));
  if (issues.length || ratePercent === null || fixedFee === null || roundingUnit === null) return { rule: null, issues: issues.map((current) => ({ ...current, ruleId: id || undefined })) };

  return { rule: {
    id,
    name,
    market: value.market as AccountFeeRuleMarket,
    currency: value.currency as Currency,
    side: value.side as AccountFeeRuleSide,
    ratePercent,
    fixedFee,
    minimumFee,
    maximumFee,
    grossAmountFrom,
    grossAmountTo,
    effectiveFrom: value.effectiveFrom as string,
    effectiveTo: value.effectiveTo as string | null,
    roundingMode: value.roundingMode as AccountFeeRoundingMode,
    roundingUnit,
  }, issues: [] };
}

function overlapIssues(rules: AccountFeeRuleV1[]) {
  const issues: AccountFeePolicyIssue[] = [];
  for (let leftIndex = 0; leftIndex < rules.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rules.length; rightIndex += 1) {
      const left = rules[leftIndex]; const right = rules[rightIndex];
      if (left.market !== right.market || left.currency !== right.currency || left.side !== right.side) continue;
      if (!dateRangesOverlap(left, right) || !amountRangesOverlap(left, right)) continue;
      issues.push({ code: "overlapping-rules", message: "우선순위가 같은 수수료 규칙의 적용 범위가 겹칩니다.", conflictingRuleIds: [left.id, right.id] });
    }
  }
  return issues;
}

function dateRangesOverlap(left: AccountFeeRuleV1, right: AccountFeeRuleV1) {
  const end = minimumNullable(left.effectiveTo, right.effectiveTo);
  return end === null || (left.effectiveFrom > right.effectiveFrom ? left.effectiveFrom : right.effectiveFrom) <= end;
}

function amountRangesOverlap(left: AccountFeeRuleV1, right: AccountFeeRuleV1) {
  const lower = maximumDecimalNullable(left.grossAmountFrom, right.grossAmountFrom);
  const upper = minimumDecimalNullable(left.grossAmountTo, right.grossAmountTo);
  return upper === null || new Decimal(lower ?? 0).lessThan(upper);
}

function matchesRule(rule: AccountFeeRuleV1, input: AccountFeeCalculationInput, date: string, gross: Decimal) {
  if (rule.currency !== input.currency || (rule.market !== "all" && rule.market !== input.market) || (rule.side !== "both" && rule.side !== input.side)) return false;
  if (date < rule.effectiveFrom || (rule.effectiveTo !== null && date > rule.effectiveTo)) return false;
  if (rule.grossAmountFrom !== null && gross.lessThan(rule.grossAmountFrom)) return false;
  return rule.grossAmountTo === null || gross.lessThan(rule.grossAmountTo);
}

function specificity(rule: AccountFeeRuleV1) {
  return (rule.market === "all" ? 0 : 2) + (rule.side === "both" ? 0 : 1);
}

function decimalFromInput(value: Decimal.Value) {
  try { const decimal = new Decimal(value); return decimal.isFinite() && (decimal.isZero() || !decimal.isNegative()) ? decimal : null; } catch { return null; }
}

function decimalString(value: Decimal) { return value.isZero() ? "0" : value.toFixed(); }
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
function dateFromTrade(value: string) { const date = typeof value === "string" ? value.slice(0, 10) : ""; return validDate(date) ? date : null; }
function requiredDecimal(value: unknown, code: string, message: string, issues: AccountFeePolicyIssue[]) {
  if (typeof value !== "string") { issues.push(issue(code, message)); return null; }
  const normalized = normalizeFeeDecimal(value); if (normalized === null) issues.push(issue(code, message)); return normalized;
}
function optionalDecimal(value: unknown, code: string, message: string, issues: AccountFeePolicyIssue[]) {
  if (value === null) return null;
  return requiredDecimal(value, code, message, issues);
}
function maximumDecimalNullable(left: string | null, right: string | null) { if (left === null) return right; if (right === null) return left; return Decimal.max(left, right).toFixed(); }
function minimumDecimalNullable(left: string | null, right: string | null) { if (left === null) return right; if (right === null) return left; return Decimal.min(left, right).toFixed(); }
function minimumNullable(left: string | null, right: string | null) { if (left === null) return right; if (right === null) return left; return left < right ? left : right; }
function issue(code: string, message: string): AccountFeePolicyIssue { return { code, message }; }
function invalid(code: string, message: string): AccountFeePolicyValidationResult { return { valid: false, issues: [issue(code, message)] }; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
