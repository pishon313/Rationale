import { describe, expect, it } from "vitest";
import {
  calculateAccountFee,
  createDefaultAccountFeeRule,
  findAccountFeeRule,
  normalizeFeeDecimal,
  validateAccountFeePolicy,
  type AccountFeePolicyV1,
  type AccountFeeRuleV1,
} from "./account-fee-policy";

const baseRule: AccountFeeRuleV1 = {
  id: "default",
  name: "미국 매수",
  market: "미국",
  currency: "USD",
  side: "buy",
  ratePercent: "0.25",
  fixedFee: "0.1",
  minimumFee: null,
  maximumFee: null,
  grossAmountFrom: null,
  grossAmountTo: null,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  roundingMode: "round",
  roundingUnit: "0.01",
};
const policy = (rules: AccountFeeRuleV1[] = [baseRule], enabled = true): AccountFeePolicyV1 => ({ version: 1, enabled, rules });
const input = { accountId: "account-1", market: "미국" as const, currency: "USD" as const, side: "buy" as const, tradedAt: "2026-08-17T14:30:00+09:00", grossAmount: "1000" };

describe("account fee decimal normalization", () => {
  it.each([
    ["+001.2300", "1.23"], ["000", "0"], ["-0", "0"], [".5000", "0.5"], ["999999999999999999.0001", "999999999999999999.0001"],
  ])("normalizes %s", (value, expected) => expect(normalizeFeeDecimal(value)).toBe(expected));

  it.each(["", "  ", "1e3", "NaN", "Infinity", "-0.01", "1,000", "+-1"])("rejects %s", (value) => expect(normalizeFeeDecimal(value)).toBeNull());
});

describe("account fee policy validation", () => {
  it("normalizes every persisted numeric field", () => {
    const result = validateAccountFeePolicy(policy([{ ...baseRule, ratePercent: "+00.2500", fixedFee: "00.100", minimumFee: "01.00", maximumFee: "010", grossAmountFrom: "000", grossAmountTo: "01000.0", roundingUnit: ".010" }]));
    expect(result).toEqual({ valid: true, policy: policy([{ ...baseRule, ratePercent: "0.25", fixedFee: "0.1", minimumFee: "1", maximumFee: "10", grossAmountFrom: "0", grossAmountTo: "1000", roundingUnit: "0.01" }]) });
  });

  it.each([
    ["future version", { ...policy(), version: 2 }],
    ["unknown policy field", { ...policy(), priority: 1 }],
    ["unknown rule field", policy([{ ...baseRule, broker: "x" } as AccountFeeRuleV1])],
    ["invalid date", policy([{ ...baseRule, effectiveFrom: "2026-02-30" }])],
    ["reversed date range", policy([{ ...baseRule, effectiveFrom: "2026-02-02", effectiveTo: "2026-02-01" }])],
    ["rate above 100", policy([{ ...baseRule, ratePercent: "100.01" }])],
    ["zero rounding unit", policy([{ ...baseRule, roundingUnit: "0" }])],
    ["minimum above maximum", policy([{ ...baseRule, minimumFee: "2", maximumFee: "1" }])],
    ["invalid amount range", policy([{ ...baseRule, grossAmountFrom: "10", grossAmountTo: "10" }])],
    ["duplicate ids", policy([baseRule, { ...baseRule, name: "duplicate", effectiveFrom: "2027-01-01" }])],
  ])("rejects %s", (_label, value) => expect(validateAccountFeePolicy(value)).toMatchObject({ valid: false }));

  it("rejects more than 50 rules", () => {
    const rules = Array.from({ length: 51 }, (_, index) => ({ ...baseRule, id: `r-${index}`, effectiveFrom: `${2070 + index}-01-01`, effectiveTo: `${2070 + index}-12-31` }));
    expect(validateAccountFeePolicy(policy(rules))).toMatchObject({ valid: false, issues: expect.arrayContaining([expect.objectContaining({ code: "too-many-rules" })]) });
  });

  it("rejects equal-specificity overlapping date and amount ranges", () => {
    const result = validateAccountFeePolicy(policy([
      { ...baseRule, id: "a", grossAmountFrom: "0", grossAmountTo: "100", effectiveTo: "2026-12-31" },
      { ...baseRule, id: "b", grossAmountFrom: "99", grossAmountTo: "200", effectiveFrom: "2026-12-31" },
    ]));
    expect(result).toMatchObject({ valid: false, issues: [{ code: "overlapping-rules", conflictingRuleIds: ["a", "b"] }] });
  });

  it("accepts adjacent upper-exclusive amount ranges and non-overlapping dates", () => {
    expect(validateAccountFeePolicy(policy([
      { ...baseRule, id: "amount-a", grossAmountFrom: "0", grossAmountTo: "100", effectiveTo: "2026-12-31" },
      { ...baseRule, id: "amount-b", grossAmountFrom: "100", grossAmountTo: "200", effectiveTo: "2026-12-31" },
      { ...baseRule, id: "date-c", grossAmountFrom: "0", grossAmountTo: "100", effectiveFrom: "2027-01-01" },
    ]))).toMatchObject({ valid: true });
  });

  it("allows broad and exact rules because exact scope has higher specificity", () => {
    expect(validateAccountFeePolicy(policy([
      { ...baseRule, id: "broad", market: "all", side: "both" },
      { ...baseRule, id: "exact" },
    ]))).toMatchObject({ valid: true });
  });
});

describe("account fee matching and calculation", () => {
  it("uses Decimal for percentage plus fixed fee", () => {
    expect(calculateAccountFee(policy(), input)).toMatchObject({ status: "matched", fee: "2.6", breakdown: { rateFee: "2.5", fixedFee: "0.1", beforeMinimum: "2.6" } });
  });

  it("applies minimum, maximum, then rounding in the specified order", () => {
    const rule = { ...baseRule, ratePercent: "1.111", fixedFee: "0.004", minimumFee: "1.125", maximumFee: "1.125", roundingUnit: "0.01" };
    expect(calculateAccountFee(policy([rule]), { ...input, grossAmount: "100" })).toMatchObject({ status: "matched", fee: "1.13", breakdown: { beforeMinimum: "1.115", afterMinimum: "1.125", afterMaximum: "1.125" } });
    expect(calculateAccountFee(policy([{ ...rule, ratePercent: "2", fixedFee: "0", minimumFee: null, maximumFee: "1.121" }]), { ...input, grossAmount: "100" })).toMatchObject({ status: "matched", fee: "1.12", breakdown: { afterMaximum: "1.121" } });
  });

  it.each([
    ["floor", "1.23"], ["round", "1.24"], ["ceil", "1.24"],
  ] as const)("supports %s rounding to a multiple", (roundingMode, fee) => {
    const rule = { ...baseRule, ratePercent: "0", fixedFee: "1.235", roundingMode };
    expect(calculateAccountFee(policy([rule]), input)).toMatchObject({ status: "matched", fee });
  });

  it("treats dates as inclusive and amount upper bounds as exclusive", () => {
    const rule = { ...baseRule, effectiveFrom: "2026-08-17", effectiveTo: "2026-08-17", grossAmountFrom: "100", grossAmountTo: "200" };
    expect(findAccountFeeRule(policy([rule]), { ...input, grossAmount: "100" })).toMatchObject({ status: "matched" });
    expect(findAccountFeeRule(policy([rule]), { ...input, grossAmount: "199.999" })).toMatchObject({ status: "matched" });
    expect(findAccountFeeRule(policy([rule]), { ...input, grossAmount: "200" })).toEqual({ status: "no-match" });
  });

  it("selects exact market and side rules before broad rules without using list order", () => {
    const broad = { ...baseRule, id: "broad", market: "all" as const, side: "both" as const, fixedFee: "9" };
    const side = { ...baseRule, id: "side", market: "all" as const, fixedFee: "8" };
    const market = { ...baseRule, id: "market", side: "both" as const, fixedFee: "7" };
    const exact = { ...baseRule, id: "exact", fixedFee: "6" };
    expect(findAccountFeeRule(policy([broad, side, market, exact]), input)).toMatchObject({ status: "matched", rule: { id: "exact" } });
    expect(findAccountFeeRule(policy([side, broad, market]), input)).toMatchObject({ status: "matched", rule: { id: "market" } });
  });

  it("reports ambiguous highest-specificity matches defensively", () => {
    const invalidOverlappingPolicy = policy([{ ...baseRule, id: "z" }, { ...baseRule, id: "a" }]);
    expect(findAccountFeeRule(invalidOverlappingPolicy, input)).toEqual({ status: "ambiguous", ruleIds: ["a", "z"] });
  });

  it("distinguishes disabled, no-match, invalid-input, and an explicit zero fee", () => {
    expect(calculateAccountFee(policy([], false), input)).toEqual({ status: "policy-disabled" });
    expect(calculateAccountFee(policy(), { ...input, side: "sell" })).toEqual({ status: "no-match" });
    expect(calculateAccountFee(policy(), { ...input, grossAmount: "NaN" })).toEqual({ status: "invalid-input", code: "invalid-gross-amount" });
    expect(calculateAccountFee(policy([{ ...baseRule, ratePercent: "0", fixedFee: "0" }]), input)).toMatchObject({ status: "matched", fee: "0" });
    expect(calculateAccountFee(policy([{ ...baseRule, ratePercent: "0", fixedFee: "0" }]), { ...input, grossAmount: "-0" })).toMatchObject({ status: "matched", grossAmount: "0", fee: "0" });
  });

  it("builds currency-aware defaults", () => {
    expect(createDefaultAccountFeeRule("KRW", "2026-08-17", "krw")).toMatchObject({ roundingMode: "floor", roundingUnit: "1", currency: "KRW" });
    expect(createDefaultAccountFeeRule("USD", "2026-08-17", "usd")).toMatchObject({ roundingMode: "round", roundingUnit: "0.01", currency: "USD" });
  });
});
