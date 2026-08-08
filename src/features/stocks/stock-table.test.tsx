import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { sampleStocks } from "./sample-data";
import { formatStockAccountSummary, StockTable, stockHoldingAccountNames } from "./stock-table";
import type { StockAccountHolding } from "./stock-account-holdings";

const t = (key: string, params?: Record<string, string | number>) => !params ? key : Object.entries(params).reduce((result, [name, value]) => result.replaceAll(`{${name}}`, String(value)), key);

describe("formatStockAccountSummary", () => {
  it("formats zero, one, and multiple holding accounts", () => {
    expect(formatStockAccountSummary([], t)).toBe("—");
    expect(formatStockAccountSummary(["미래에셋"], t)).toBe("미래에셋");
    expect(formatStockAccountSummary(["미래에셋", "연금"], t)).toBe("미래에셋 외 1");
  });

  it("exposes every account name for a compact multi-account cell", () => {
    const holdings = new Map([[sampleStocks[0].id, [holding("a", "Account A", "USD"), holding("a", "Account A", "KRW"), holding("b", "Account B", "KRW")]]]);
    render(<StockTable stocks={[sampleStocks[0]]} accountHoldingsByStockId={holdings} onEdit={vi.fn()} onDelete={vi.fn()} />);
    const cell = screen.getByLabelText("보유 계좌: Account A · Account B");
    expect(cell).toHaveTextContent("Account A 외 1");
    expect(cell).toHaveAttribute("title", "Account A · Account B");
    expect(stockHoldingAccountNames(holdings.get(sampleStocks[0].id) ?? [])).toEqual(["Account A", "Account B"]);
  });
});

function holding(accountId: string, accountName: string, currency: StockAccountHolding["currency"] = "KRW"): StockAccountHolding {
  return { stockId: sampleStocks[0].id, accountId, accountName, currency, quantity: 1, averagePrice: 100, investedAmount: 100, investedAmountKrw: 100 };
}
