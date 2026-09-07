import Decimal from "decimal.js";
import { currencies, type Currency } from "@/domain/currency";
import type { AccountCashBaselineV1, AccountCashTrackingV1 } from "./types";

export const accountCashTrackingVersion = 1 as const;
export const maximumAccountCashBaselines = currencies.length;

export type AccountCashTrackingIssue = {
  code: string;
  message: string;
  currency?: string;
};

export type AccountCashTrackingValidationResult =
  | { valid: true; tracking: AccountCashTrackingV1 }
  | { valid: false; issues: AccountCashTrackingIssue[] };

const trackingKeys = new Set(["version", "baselines"]);
const baselineKeys = new Set(["currency", "balance", "asOf", "createdAt", "updatedAt"]);
const nonNegativeDecimalPattern = /^\+?(?:\d+(?:\.\d*)?|\.\d+)$/;

export function normalizeCashBalance(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !nonNegativeDecimalPattern.test(trimmed)) return null;
  try {
    const decimal = new Decimal(trimmed);
    if (!decimal.isFinite() || decimal.isNegative()) return null;
    return decimal.isZero() ? "0" : decimal.toFixed();
  } catch {
    return null;
  }
}

export function validateAccountCashTracking(value: unknown): AccountCashTrackingValidationResult {
  if (!isRecord(value)) return invalid("invalid-tracking", "현금 추적 형식을 확인해 주세요.");
  const issues: AccountCashTrackingIssue[] = [];
  if (Object.keys(value).some((key) => !trackingKeys.has(key))) issues.push(issue("unknown-tracking-field", "지원하지 않는 현금 추적 항목이 있습니다."));
  if (value.version !== accountCashTrackingVersion) issues.push(issue("unsupported-version", "지원하지 않는 현금 추적 버전입니다."));
  if (!Array.isArray(value.baselines)) issues.push(issue("invalid-baselines", "현금 기준점 목록 형식을 확인해 주세요."));
  if (issues.length || value.version !== accountCashTrackingVersion || !Array.isArray(value.baselines)) return { valid: false, issues };
  if (value.baselines.length > maximumAccountCashBaselines) issues.push(issue("too-many-baselines", `현금 기준점은 최대 ${maximumAccountCashBaselines}개까지 저장할 수 있습니다.`));

  const normalized: AccountCashBaselineV1[] = [];
  const seenCurrencies = new Set<Currency>();
  for (const [index, raw] of value.baselines.entries()) {
    if (!isRecord(raw)) {
      issues.push(issue("invalid-baseline", `현금 기준점 ${index + 1}번째 항목의 형식을 확인해 주세요.`));
      continue;
    }
    if (Object.keys(raw).some((key) => !baselineKeys.has(key))) issues.push(issue("unknown-baseline-field", `현금 기준점 ${index + 1}번째 항목에 지원하지 않는 값이 있습니다.`));
    const currency = currencies.includes(raw.currency as Currency) ? raw.currency as Currency : null;
    if (!currency) issues.push(issue("invalid-currency", `현금 기준점 ${index + 1}번째 항목의 통화를 확인해 주세요.`));
    else if (seenCurrencies.has(currency)) issues.push({ ...issue("duplicate-currency", "같은 통화의 현금 기준점이 중복되었습니다."), currency });
    else seenCurrencies.add(currency);
    const balance = typeof raw.balance === "string" ? normalizeCashBalance(raw.balance) : null;
    if (balance === null) issues.push({ ...issue("invalid-balance", `현금 기준점 ${index + 1}번째 항목의 잔액을 확인해 주세요.`), currency: currency ?? undefined });
    const asOf = validIsoTimestamp(raw.asOf) ? raw.asOf : null;
    const createdAt = validIsoTimestamp(raw.createdAt) ? raw.createdAt : null;
    const updatedAt = validIsoTimestamp(raw.updatedAt) ? raw.updatedAt : null;
    if (!asOf) issues.push(issue("invalid-as-of", `현금 기준점 ${index + 1}번째 항목의 기준 일시를 확인해 주세요.`));
    if (!createdAt) issues.push(issue("invalid-created-at", `현금 기준점 ${index + 1}번째 항목의 생성 일시를 확인해 주세요.`));
    if (!updatedAt) issues.push(issue("invalid-updated-at", `현금 기준점 ${index + 1}번째 항목의 수정 일시를 확인해 주세요.`));
    if (createdAt && updatedAt && Date.parse(createdAt) > Date.parse(updatedAt)) issues.push(issue("invalid-timestamp-order", `현금 기준점 ${index + 1}번째 항목의 수정 일시가 생성 일시보다 빠릅니다.`));
    if (currency && balance !== null && asOf && createdAt && updatedAt) normalized.push({ currency, balance, asOf, createdAt, updatedAt });
  }

  return issues.length ? { valid: false, issues } : { valid: true, tracking: { version: 1, baselines: normalized } };
}

function validIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "0"] = match;
  const year = Number(yearText); const month = Number(monthText); const day = Number(dayText);
  const hour = Number(hourText); const minute = Number(minuteText); const second = Number(secondText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth
    && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59
    && Number.isFinite(Date.parse(value));
}

function issue(code: string, message: string): AccountCashTrackingIssue { return { code, message }; }
function invalid(code: string, message: string): AccountCashTrackingValidationResult { return { valid: false, issues: [issue(code, message)] }; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
