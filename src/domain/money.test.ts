import { describe, expect, it } from "vitest";
import { calculateBuyCost, calculateTradeAmount, formatCurrency } from "./money";

describe("money", () => {
  it("부동소수점 오차 없이 거래 총액을 계산한다", () => {
    expect(calculateTradeAmount("0.1", "0.2").toString()).toBe("0.02");
  });

  it("수수료를 매수 원가에 포함한다", () => {
    expect(calculateBuyCost(10, 100, 25).toString()).toBe("1025");
  });

  it("음수 수량을 거부한다", () => {
    expect(() => calculateTradeAmount(-1, 100)).toThrow();
  });

  it("KRW와 USD를 지정된 자릿수로 표시한다", () => {
    expect(formatCurrency("1234.56", "KRW")).toContain("1,235");
    expect(formatCurrency("1234.5", "USD")).toBe("$1,234.50");
  });
});
