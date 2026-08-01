import Decimal from "decimal.js";
import { money, type MoneyInput } from "./money";

export type Position = { quantity: Decimal; averagePrice: Decimal; investedAmount: Decimal; realizedProfit: Decimal };
export const emptyPosition = (): Position => ({ quantity: new Decimal(0), averagePrice: new Decimal(0), investedAmount: new Decimal(0), realizedProfit: new Decimal(0) });

export function applyBuy(position: Position, quantity: MoneyInput, price: MoneyInput, fee: MoneyInput = 0): Position {
  const q = money(quantity), p = money(price), f = money(fee);
  if (q.lte(0) || p.lt(0) || f.lt(0)) throw new Error("수량은 0보다 크고 가격과 수수료는 0 이상이어야 합니다.");
  const newQuantity = position.quantity.add(q);
  const investedAmount = position.investedAmount.add(q.mul(p)).add(f);
  return { ...position, quantity: newQuantity, investedAmount, averagePrice: investedAmount.div(newQuantity) };
}

export function applySell(position: Position, quantity: MoneyInput, price: MoneyInput, fee: MoneyInput = 0, tax: MoneyInput = 0): Position {
  const q = money(quantity), p = money(price), f = money(fee), t = money(tax);
  if (q.lte(0) || q.gt(position.quantity)) throw new Error("매도 수량이 보유 수량을 초과하거나 유효하지 않습니다.");
  if (p.lt(0) || f.lt(0) || t.lt(0)) throw new Error("가격, 수수료와 세금은 0 이상이어야 합니다.");
  const costBasis = position.averagePrice.mul(q);
  const realized = q.mul(p).sub(f).sub(t).sub(costBasis);
  const remaining = position.quantity.sub(q);
  return { quantity: remaining, averagePrice: remaining.isZero() ? new Decimal(0) : position.averagePrice, investedAmount: remaining.isZero() ? new Decimal(0) : position.investedAmount.sub(costBasis), realizedProfit: position.realizedProfit.add(realized) };
}

export function marketValue(quantity: MoneyInput, currentPrice: MoneyInput) { return money(quantity).mul(money(currentPrice)); }
export function unrealizedProfit(position: Position, currentPrice: MoneyInput) { return marketValue(position.quantity, currentPrice).sub(position.investedAmount); }
export function returnRate(profit: MoneyInput, basis: MoneyInput) { const b = money(basis); return b.isZero() ? null : money(profit).div(b).mul(100); }
export function planPriceDeviation(planned: MoneyInput, actual: MoneyInput) { const p = money(planned); return p.isZero() ? null : money(actual).sub(p).div(p).mul(100); }
export function weightDifference(planned: MoneyInput, actual: MoneyInput) { return money(actual).sub(money(planned)); }
export function complianceRate(checks: Array<boolean | null>) { const decided = checks.filter((v): v is boolean => v !== null); return decided.length ? new Decimal(decided.filter(Boolean).length).div(decided.length).mul(100) : null; }
