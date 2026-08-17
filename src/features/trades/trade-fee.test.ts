import { describe, expect, it } from "vitest";
import { calculateAccountFee, type AccountFeePolicyV1 } from "@/features/accounts/account-fee-policy";
import type { Trade } from "./types";
import { createAccountFeeCalculationSnapshot, validateTradeFeeMetadata } from "./trade-fee";

const policy: AccountFeePolicyV1 = {
  version: 1,
  enabled: true,
  rules: [{ id: "rule", name: "USD buy", market: "미국", currency: "USD", side: "buy", ratePercent: "0.1", fixedFee: "0.25", minimumFee: null, maximumFee: null, grossAmountFrom: null, grossAmountTo: null, effectiveFrom: "2026-01-01", effectiveTo: null, roundingMode: "round", roundingUnit: "0.01" }],
};
const result = calculateAccountFee(policy, { accountId: "account", market: "미국", currency: "USD", side: "buy", tradedAt: "2026-08-17T10:00:00", grossAmount: "1000" });
if (result.status !== "matched") throw new Error("fixture did not match");
const snapshot = createAccountFeeCalculationSnapshot({ policyAccountId: "account", side: "buy", tradedAt: "2026-08-17T10:00:00", quantity: "10", price: "100", currency: "USD", result, calculatedAt: "2026-08-17T01:00:00.000Z" });

const trade = (overrides: Partial<Trade> = {}): Trade => ({
  id: "trade", stockId: "stock", stockName: "Stock", planId: null, tradeType: "매수", tradedAt: "2026-08-17T10:00:00",
  quantity: 10, price: 100, currency: "USD", exchangeRate: 1380, fee: 1.25, tax: 0, accountId: "account", accountName: "Account",
  memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, createdAt: "2026-08-17T01:00:00.000Z", ...overrides,
});

describe("Trade fee metadata", () => {
  it("accepts legacy metadata absence and every non-policy mode without a snapshot", () => {
    expect(validateTradeFeeMetadata(trade())).toEqual({ valid: true });
    for (const feeMode of ["manual", "sourceProvided", "unknown"] as const) {
      expect(validateTradeFeeMetadata(trade({ feeMode, feeCalculation: null }))).toEqual({ valid: true });
    }
  });

  it("requires a valid snapshot only for account-policy mode", () => {
    expect(validateTradeFeeMetadata(trade({ feeMode: "accountPolicy", feeCalculation: snapshot }))).toEqual({ valid: true });
    expect(validateTradeFeeMetadata(trade({ feeMode: "accountPolicy", feeCalculation: null })).valid).toBe(false);
    expect(validateTradeFeeMetadata(trade({ feeMode: "manual", feeCalculation: snapshot })).valid).toBe(false);
    expect(validateTradeFeeMetadata(trade({ feeMode: "future" as Trade["feeMode"] })).valid).toBe(false);
  });

  it("validates exact decimal evidence and calculated fee tolerance", () => {
    expect(validateTradeFeeMetadata(trade({ feeMode: "accountPolicy", feeCalculation: { ...snapshot, quantity: "1e1" } })).valid).toBe(false);
    expect(validateTradeFeeMetadata(trade({ feeMode: "accountPolicy", feeCalculation: { ...snapshot, grossAmount: "999" } })).valid).toBe(false);
    expect(validateTradeFeeMetadata(trade({ fee: 1.26, feeMode: "accountPolicy", feeCalculation: snapshot }))).toEqual({ valid: true });
    expect(validateTradeFeeMetadata(trade({ fee: 1.261, feeMode: "accountPolicy", feeCalculation: snapshot })).valid).toBe(false);
    expect(validateTradeFeeMetadata(trade({ feeMode: "accountPolicy", feeCalculation: { ...snapshot, calculatedFee: "1.24" } })).valid).toBe(false);
    expect(validateTradeFeeMetadata(trade({ feeMode: "accountPolicy", feeCalculation: { ...snapshot, ratePercent: "0.2" } })).valid).toBe(false);
    expect(validateTradeFeeMetadata(trade({ feeMode: "accountPolicy", feeCalculation: { ...snapshot, price: "99", grossAmount: "990" } })).valid).toBe(false);
    expect(validateTradeFeeMetadata(trade({ feeMode: "accountPolicy", feeCalculation: { ...snapshot, tradedAtDate: "2026-08-16" } })).valid).toBe(false);
  });

  it("requires snapshot currency and side to match the Trade", () => {
    expect(validateTradeFeeMetadata(trade({ feeMode: "accountPolicy", feeCalculation: { ...snapshot, currency: "EUR" } })).valid).toBe(false);
    expect(validateTradeFeeMetadata(trade({ feeMode: "accountPolicy", feeCalculation: { ...snapshot, side: "sell" } })).valid).toBe(false);
  });

  it("rejects account-policy provenance on unsupported and opening records", () => {
    expect(validateTradeFeeMetadata(trade({ tradeType: "배당", feeMode: "accountPolicy", feeCalculation: snapshot })).valid).toBe(false);
    expect(validateTradeFeeMetadata(trade({ isOpeningPosition: true, feeMode: "accountPolicy", feeCalculation: snapshot })).valid).toBe(false);
    expect(validateTradeFeeMetadata(trade({ cashFlowKind: "transfer", feeMode: "accountPolicy", feeCalculation: snapshot })).valid).toBe(false);
  });
});
