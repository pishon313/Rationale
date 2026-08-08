import { describe, expect, it } from "vitest";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Trade } from "@/features/trades/types";
import { currentTradeAccountName, formatHoldingAveragePrice } from "./stock-detail-client";

describe("currentTradeAccountName", () => {
  it("uses the current account name and falls back to the trade snapshot", () => {
    const trade = { accountId: "account", accountName: "예전 이름" } as Trade;
    const accounts = new Map<string, InvestmentAccount>([["account", { name: "현재 이름" } as InvestmentAccount]]);
    expect(currentTradeAccountName(trade, accounts)).toBe("현재 이름");
    expect(currentTradeAccountName({ ...trade, accountId: "missing" }, accounts)).toBe("예전 이름");
  });

  it("formats each holding with its own currency", () => {
    const formatNumber = (value: number, options?: Intl.NumberFormatOptions) => new Intl.NumberFormat("en-US", options).format(value);
    expect(formatHoldingAveragePrice({ averagePrice: 1234, currency: "KRW" }, formatNumber)).toBe("₩1,234");
    expect(formatHoldingAveragePrice({ averagePrice: 12.5, currency: "USD" }, formatNumber)).toBe("$12.50");
  });
});
