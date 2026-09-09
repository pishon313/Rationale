import { describe, expect, it } from "vitest";
import { cashTrackingOf, type InvestmentAccount } from "./types";
import { normalizeCashBalance, validateAccountCashTracking } from "./account-cash-tracking";

const at = "2026-09-07T00:00:00.000Z";
const baseline = (currency = "KRW", balance = "1000") => ({ currency, balance, asOf: at, createdAt: at, updatedAt: at });

describe("Account cash tracking v1", () => {
  it("treats a missing or null field as untracked without mutating the Account", () => {
    const missing = { cashTracking: undefined };
    const nulled = { cashTracking: null };
    expect(cashTrackingOf(missing)).toEqual({ version: 1, baselines: [] });
    expect(cashTrackingOf(nulled)).toEqual({ version: 1, baselines: [] });
    expect(missing).toEqual({ cashTracking: undefined });
    expect(nulled).toEqual({ cashTracking: null });
  });

  it("accepts empty and multi-currency tracking while normalizing decimal text", () => {
    expect(validateAccountCashTracking({ version: 1, baselines: [] })).toEqual({ valid: true, tracking: { version: 1, baselines: [] } });
    expect(validateAccountCashTracking({ version: 1, baselines: [baseline("KRW", "+001000.00"), baseline("USD", ".5000")] })).toEqual({
      valid: true,
      tracking: { version: 1, baselines: [baseline("KRW", "1000"), baseline("USD", "0.5")] },
    });
  });

  it.each(["", "1e3", "NaN", "Infinity", "-1", "-0", "1,000", "+-1"])("rejects invalid balance %s", (balance) => {
    expect(normalizeCashBalance(balance)).toBeNull();
    expect(validateAccountCashTracking({ version: 1, baselines: [baseline("KRW", balance)] })).toMatchObject({ valid: false });
  });

  it.each([
    ["future version", { version: 2, baselines: [] }],
    ["unknown tracking field", { version: 1, baselines: [], migrated: true }],
    ["unknown baseline field", { version: 1, baselines: [{ ...baseline(), note: "x" }] }],
    ["unsupported currency", { version: 1, baselines: [baseline("BTC")] }],
    ["duplicate currency", { version: 1, baselines: [baseline(), baseline()] }],
    ["invalid as-of", { version: 1, baselines: [{ ...baseline(), asOf: "2026-09-07" }] }],
    ["invalid calendar date", { version: 1, baselines: [{ ...baseline(), asOf: "2026-02-30T00:00:00Z" }] }],
    ["invalid created timestamp", { version: 1, baselines: [{ ...baseline(), createdAt: "not-a-date" }] }],
    ["invalid updated timestamp", { version: 1, baselines: [{ ...baseline(), updatedAt: "not-a-date" }] }],
    ["reversed timestamps", { version: 1, baselines: [{ ...baseline(), createdAt: "2026-09-08T00:00:00Z" }] }],
  ])("rejects %s", (_label, value) => expect(validateAccountCashTracking(value)).toMatchObject({ valid: false }));

  it("does not add cash tracking to a missing-field Account at read time", () => {
    const account = { id: "a", name: "A" } as InvestmentAccount;
    cashTrackingOf(account);
    expect(account).not.toHaveProperty("cashTracking");
  });
});
