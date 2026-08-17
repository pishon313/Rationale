import { describe, expect, it } from "vitest";
import type { AccountFeePolicyV1 } from "@/features/accounts/account-fee-policy";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import { createInitialTradeFeeEntryState, evaluateAutomaticTradeFee, savedTradeFeeBasisKey, tradeFeeBasisKey, type TradeFeeBasis } from "./trade-fee-entry";
import type { Trade } from "./types";

const policy: AccountFeePolicyV1 = { version: 1, enabled: true, rules: [{ id: "buy", name: "Buy", market: "미국", currency: "USD", side: "buy", ratePercent: "0.1", fixedFee: "0", minimumFee: null, maximumFee: null, grossAmountFrom: null, grossAmountTo: null, effectiveFrom: "2026-01-01", effectiveTo: null, roundingMode: "round", roundingUnit: "0.01" }] };
const account = (feePolicy?: AccountFeePolicyV1 | null): InvestmentAccount => ({ id: "account", name: "Account", institution: "", kind: "brokerage", subtype: "", baseCurrency: "USD", isDefault: true, archivedAt: null, memo: "", ...(feePolicy === undefined ? {} : { feePolicy }), createdAt: "2026-01-01", updatedAt: "2026-01-01" });
const stock = { id: "stock", name: "Stock", ticker: "STK", market: "미국", currency: "USD" } as Stock;
const basis: TradeFeeBasis = { accountId: "account", stockId: "stock", tradeType: "매수", tradedAt: "2026-08-17T10:00:00", quantity: 10, price: 100, currency: "USD" };

describe("Trade fee entry state", () => {
  it("uses manual mode without an enabled policy and auto mode with one", () => {
    expect(createInitialTradeFeeEntryState({ account: account(undefined), stock, openingPosition: false, tradeType: "매수" })).toMatchObject({ mode: "manual", value: "0" });
    expect(createInitialTradeFeeEntryState({ account: account({ ...policy, enabled: false }), stock, openingPosition: false, tradeType: "매수" })).toMatchObject({ mode: "manual", value: "0" });
    expect(createInitialTradeFeeEntryState({ account: account(policy), stock, openingPosition: false, tradeType: "매수" })).toEqual({ mode: "auto" });
  });

  it("distinguishes matched zero, no-match, ambiguous, and incomplete", () => {
    const zeroAccount = account({ ...policy, rules: [{ ...policy.rules[0], ratePercent: "0", fixedFee: "0" }] });
    expect(evaluateAutomaticTradeFee({ account: zeroAccount, stock, openingPosition: false, basis })).toMatchObject({ status: "matched", fee: "0" });
    expect(evaluateAutomaticTradeFee({ account: account(policy), stock, openingPosition: false, basis: { ...basis, tradeType: "매도" } })).toEqual({ status: "no-match" });
    const ambiguous = account({ ...policy, rules: [{ ...policy.rules[0], id: "a" }, { ...policy.rules[0], id: "b" }] });
    expect(evaluateAutomaticTradeFee({ account: ambiguous, stock, openingPosition: false, basis })).toEqual({ status: "ambiguous", ruleIds: ["a", "b"] });
    expect(evaluateAutomaticTradeFee({ account: account(policy), stock, openingPosition: false, basis: { ...basis, quantity: 0 } })).toEqual({ status: "incomplete" });
  });

  it("recalculates for every basis input", () => {
    const base = evaluateAutomaticTradeFee({ account: account(policy), stock, openingPosition: false, basis });
    expect(base).toMatchObject({ status: "matched", fee: "1" });
    expect(evaluateAutomaticTradeFee({ account: account({ ...policy, rules: [{ ...policy.rules[0], ratePercent: "0.2" }] }), stock, openingPosition: false, basis })).toMatchObject({ status: "matched", fee: "2" });
    expect(evaluateAutomaticTradeFee({ account: account(policy), stock: { ...stock, market: "한국" }, openingPosition: false, basis })).toEqual({ status: "no-match" });
    expect(evaluateAutomaticTradeFee({ account: account(policy), stock, openingPosition: false, basis: { ...basis, tradeType: "매도" } })).toEqual({ status: "no-match" });
    expect(evaluateAutomaticTradeFee({ account: account(policy), stock, openingPosition: false, basis: { ...basis, tradedAt: "2025-12-31" } })).toEqual({ status: "no-match" });
    expect(evaluateAutomaticTradeFee({ account: account(policy), stock, openingPosition: false, basis: { ...basis, quantity: 20 } })).toMatchObject({ status: "matched", fee: "2" });
    expect(evaluateAutomaticTradeFee({ account: account(policy), stock, openingPosition: false, basis: { ...basis, price: 200 } })).toMatchObject({ status: "matched", fee: "2" });
    expect(evaluateAutomaticTradeFee({ account: account(policy), stock, openingPosition: false, basis: { ...basis, currency: "EUR" } })).toEqual({ status: "no-match" });
  });

  it("preserves an existing Trade and detects each stale basis field", () => {
    const trade = { ...basis, id: "trade", stockName: "Stock", planId: null, exchangeRate: 1380, fee: 1, tax: 0, accountName: "Account", memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, createdAt: "2026-08-17T01:00:00Z", feeMode: "accountPolicy" as const } as Trade;
    expect(createInitialTradeFeeEntryState({ trade, account: account(policy), stock, openingPosition: false, tradeType: "매수" })).toMatchObject({ mode: "preserved", value: "1", feeMode: "accountPolicy" });
    const saved = savedTradeFeeBasisKey(trade);
    for (const change of [{ accountId: "other" }, { stockId: "other" }, { tradeType: "매도" as const }, { tradedAt: "2026-08-18" }, { quantity: 11 }, { price: 101 }, { currency: "EUR" as const }]) {
      expect(tradeFeeBasisKey({ ...basis, ...change })).not.toBe(saved);
    }
  });
});
