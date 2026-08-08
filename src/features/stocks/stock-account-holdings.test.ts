import { describe, expect, it } from "vitest";
import { buildTradingLedger } from "@/domain/trading-ledger";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Trade } from "@/features/trades/types";
import type { Currency } from "@/domain/currency";
import { buildStockAccountHoldings } from "./stock-account-holdings";

const now = "2026-01-01T00:00:00.000Z";
const accounts: InvestmentAccount[] = [account("a", "New name"), account("b", "ISA")];

describe("buildStockAccountHoldings", () => {
  it("projects open positions by stock and current account name in deterministic order", () => {
    const trades = [buy("a-buy", "a", "Old name", 10, 100), buy("b-buy", "b", "ISA", 5, 120)];
    const holdings = buildStockAccountHoldings(buildTradingLedger(trades, accounts)).get("stock") ?? [];
    expect(holdings).toHaveLength(2);
    expect(holdings.map((holding) => [holding.accountName, holding.quantity])).toEqual([["ISA", 5], ["New name", 10]]);
    expect(holdings.find((holding) => holding.accountId === "a")).toMatchObject({ averagePrice: 100, investedAmount: 1000, investedAmountKrw: 1000 });
  });

  it("excludes closed positions", () => {
    const trades = [buy("buy", "a", "Old name", 10, 100), { ...buy("sell", "a", "Old name", 10, 120), tradeType: "매도" as const, tradedAt: "2026-01-02T00:00:00.000Z", createdAt: "2026-01-02T00:00:00.000Z" }];
    expect(buildStockAccountHoldings(buildTradingLedger(trades, accounts)).get("stock")).toBeUndefined();
  });

  it("keeps one holding for the same stock, account, and currency", () => {
    const trades = [buy("first", "a", "Old name", 2, 100), buy("second", "a", "Old name", 3, 200)];
    const holdings = buildStockAccountHoldings(buildTradingLedger(trades, accounts)).get("stock") ?? [];
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({ currency: "KRW", quantity: 5, averagePrice: 160 });
  });

  it("keeps different currencies separate for the same stock and account", () => {
    const trades = [buy("krw", "a", "Old name", 2, 100, "KRW"), buy("usd", "a", "Old name", 3, 20, "USD")];
    const holdings = buildStockAccountHoldings(buildTradingLedger(trades, accounts)).get("stock") ?? [];
    expect(holdings).toHaveLength(2);
    expect(holdings.map(({ currency, quantity, averagePrice }) => ({ currency, quantity, averagePrice }))).toEqual([
      { currency: "KRW", quantity: 2, averagePrice: 100 },
      { currency: "USD", quantity: 3, averagePrice: 20 },
    ]);
  });
});

function account(id: string, name: string): InvestmentAccount {
  return { id, name, institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: id === "a", archivedAt: null, memo: "", createdAt: now, updatedAt: now };
}

function buy(id: string, accountId: string, accountName: string, quantity: number, price: number, currency: Currency = "KRW"): Trade {
  return { id, stockId: "stock", stockName: "Stock", planId: null, tradeType: "매수", tradedAt: now, quantity, price, currency, exchangeRate: 1, fee: 0, tax: 0, accountId, accountName, memo: "", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, createdAt: now, updatedAt: now, deletedAt: null };
}
