import { describe, expect, it } from "vitest";
import { applyBuy, applySell, complianceRate, emptyPosition, planPriceDeviation, returnRate, weightDifference } from "./portfolio";

describe("이동평균 보유 계산", () => {
  it("여러 번 분할매수의 평균단가를 계산한다", () => { let p = applyBuy(emptyPosition(), 10, 100); p = applyBuy(p, 10, 120); expect(p.averagePrice.toString()).toBe("110"); });
  it("수수료를 평균단가에 포함한다", () => { expect(applyBuy(emptyPosition(), 10, 100, 20).averagePrice.toString()).toBe("102"); });
  it("일부 매도 후 실현손익과 잔여 원가를 계산한다", () => { const p = applySell(applyBuy(emptyPosition(), 10, 100), 4, 130, 5, 3); expect(p.realizedProfit.toString()).toBe("112"); expect(p.quantity.toString()).toBe("6"); expect(p.investedAmount.toString()).toBe("600"); });
  it("전량 매도 시 보유 상태를 0으로 만든다", () => { const p = applySell(applyBuy(emptyPosition(), 2, 50), 2, 60); expect(p.quantity.isZero()).toBe(true); expect(p.averagePrice.isZero()).toBe(true); });
  it("보유량보다 많은 매도를 거부한다", () => { expect(() => applySell(emptyPosition(), 1, 100)).toThrow(); });
});
describe("계획 및 비율 계산", () => {
  it("계획 가격 대비 오차율을 계산한다", () => expect(planPriceDeviation(100, 104.2)?.toFixed(1)).toBe("4.2"));
  it("0 기준 수익률은 null이다", () => expect(returnRate(10, 0)).toBeNull());
  it("비중 차이와 준수율을 계산한다", () => { expect(weightDifference(30, 52).toString()).toBe("22"); expect(complianceRate([true, true, false, null])?.toFixed(1)).toBe("66.7"); });
});
