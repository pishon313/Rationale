import { describe, expect, it } from "vitest";
import type { Trade } from "@/features/trades/types";
import type { InvestmentAccount } from "./types";
import {
  candidateAccountCashCurrencies,
  cashBaselineFor,
  hasCashBaseline,
  removeAccountCashBaseline,
  upsertAccountCashBaseline,
} from "./account-cash-actions";

const createdAt = "2026-01-01T00:00:00.000Z";
const account = (id: string, name: string, baseCurrency: InvestmentAccount["baseCurrency"] = "KRW", isDefault = false): InvestmentAccount => ({
  id, name, institution: "Broker", kind: "brokerage", subtype: "", baseCurrency, isDefault,
  archivedAt: null, memo: "memo", feePolicy: null, createdAt, updatedAt: createdAt,
});
const trade = (id: string, accountId: string, currency: Trade["currency"], deletedAt: string | null = null): Trade => ({
  id, stockId: "stock", stockName: "Stock", planId: null, tradeType: "매수", tradedAt: createdAt,
  quantity: 1, price: 1, currency, exchangeRate: 1, fee: 0, tax: 0, accountId, accountName: accountId,
  memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3,
  createdAt, updatedAt: createdAt, deletedAt,
});

describe("account cash actions", () => {
  it("creates an actual-zero baseline without mutating inputs or unrelated metadata", () => {
    const input = [account("a", "A", "KRW", true), account("b", "B")];
    const snapshot = structuredClone(input);
    const next = upsertAccountCashBaseline(input, { accountId: "a", currency: "KRW", balance: "+000.00", asOf: "2026-02-01T09:30:00+09:00" }, "2026-02-01T01:00:00.000Z");
    expect(input).toEqual(snapshot);
    expect(next[0]).toMatchObject({ memo: "memo", feePolicy: null, updatedAt: "2026-02-01T01:00:00.000Z" });
    expect(next[0].cashTracking).toEqual({ version: 1, baselines: [{ currency: "KRW", balance: "0", asOf: "2026-02-01T00:30:00.000Z", createdAt: "2026-02-01T01:00:00.000Z", updatedAt: "2026-02-01T01:00:00.000Z" }] });
    expect(next[1]).toBe(input[1]);
    expect(hasCashBaseline(next[0], "KRW")).toBe(true);
    expect(cashBaselineFor(next[0], "KRW")?.balance).toBe("0");
  });

  it("updates a baseline while preserving createdAt and other currencies", () => {
    const original = account("a", "A");
    original.cashTracking = { version: 1, baselines: [
      { currency: "KRW", balance: "1", asOf: createdAt, createdAt, updatedAt: createdAt },
      { currency: "USD", balance: "2", asOf: createdAt, createdAt, updatedAt: createdAt },
    ] };
    const next = upsertAccountCashBaseline([original], { accountId: "a", currency: "KRW", balance: "3.5", asOf: "2026-03-01T00:00:00Z" }, "2026-03-01T01:00:00Z");
    expect(next[0].cashTracking?.baselines).toEqual([
      { currency: "KRW", balance: "3.5", asOf: "2026-03-01T00:00:00.000Z", createdAt, updatedAt: "2026-03-01T01:00:00.000Z" },
      original.cashTracking.baselines[1],
    ]);
  });

  it("stops one currency and a restart gets a new createdAt", () => {
    const original = upsertAccountCashBaseline([account("a", "A")], { accountId: "a", currency: "KRW", balance: "1", asOf: createdAt }, createdAt);
    const withUsd = upsertAccountCashBaseline(original, { accountId: "a", currency: "USD", balance: "2", asOf: createdAt }, "2026-01-02T00:00:00Z");
    const stopped = removeAccountCashBaseline(withUsd, "a", "KRW", "2026-01-03T00:00:00Z");
    expect(stopped[0].cashTracking?.baselines).toEqual([expect.objectContaining({ currency: "USD", balance: "2" })]);
    const restarted = upsertAccountCashBaseline(stopped, { accountId: "a", currency: "KRW", balance: "4", asOf: "2026-01-04T00:00:00Z" }, "2026-01-04T01:00:00Z");
    expect(cashBaselineFor(restarted[0], "KRW")?.createdAt).toBe("2026-01-04T01:00:00.000Z");
  });

  it.each([
    ["archived account", [{ ...account("a", "A"), archivedAt: createdAt }], { accountId: "a", currency: "KRW" as const, balance: "1", asOf: createdAt }],
    ["invalid balance", [account("a", "A")], { accountId: "a", currency: "KRW" as const, balance: "-1", asOf: createdAt }],
    ["invalid timestamp", [account("a", "A")], { accountId: "a", currency: "KRW" as const, balance: "1", asOf: "bad" }],
  ])("rejects %s", (_label, accounts, input) => {
    expect(() => upsertAccountCashBaseline(accounts, input, createdAt)).toThrow();
  });

  it("builds deduplicated candidates in default/account/base-currency order and excludes archived data", () => {
    const defaultAccount = account("z", "Zulu", "USD", true);
    defaultAccount.cashTracking = { version: 1, baselines: [{ currency: "EUR", balance: "1", asOf: createdAt, createdAt, updatedAt: createdAt }] };
    const alpha = account("a", "Alpha", "KRW");
    const archived = { ...account("x", "Archived"), archivedAt: createdAt };
    expect(candidateAccountCashCurrencies(
      [alpha, archived, defaultAccount],
      [trade("one", "z", "CAD"), trade("two", "z", "CAD"), trade("deleted", "a", "JPY", createdAt), trade("archived", "x", "USD")],
    )).toEqual([
      { accountId: "z", currency: "USD" },
      { accountId: "z", currency: "CAD" },
      { accountId: "z", currency: "EUR" },
      { accountId: "a", currency: "KRW" },
    ]);
  });
});
