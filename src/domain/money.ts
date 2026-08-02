import Decimal from "decimal.js";
import type { Currency } from "./currency";

export type MoneyInput = Decimal.Value;

export function money(value: MoneyInput) {
  const result = new Decimal(value);
  if (!result.isFinite()) throw new Error("유효한 금액을 입력해 주세요.");
  return result;
}

export function calculateTradeAmount(quantity: MoneyInput, price: MoneyInput) {
  const q = money(quantity);
  const p = money(price);
  if (q.isNegative() || p.isNegative()) throw new Error("수량과 가격은 0 이상이어야 합니다.");
  return q.mul(p);
}

export function calculateBuyCost(
  quantity: MoneyInput,
  price: MoneyInput,
  fee: MoneyInput = 0,
) {
  return calculateTradeAmount(quantity, price).add(money(fee));
}

export function formatCurrency(value: MoneyInput, currency: Currency, locale?: string) {
  const formattingLocale = locale ?? (currency === "KRW" ? "ko-KR" : currency === "JPY" ? "ja-JP" : currency === "EUR" ? "de-DE" : "en-US");
  const whole = currency === "KRW" || currency === "JPY";
  return new Intl.NumberFormat(formattingLocale, {
    style: "currency",
    currency,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(money(value).toNumber());
}
