import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { sampleStocks } from "./sample-data";
import { formatStockAccountSummary, StockTable, stockHoldingAccountNames, stockHoldingAccountSortKey } from "./stock-table";
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
    expect(stockHoldingAccountSortKey(holdings.get(sampleStocks[0].id) ?? [])).toBe("Account A\u0000Account B");
  });
});

describe("StockTable account sorting", () => {
  it("sorts stocks by holding account when the column header is clicked", () => {
    const holdings = new Map([
      [sampleStocks[0].id, [holding("z", "Z Account", "KRW")]],
      [sampleStocks[1].id, [{ ...holding("a", "A Account", "KRW"), stockId: sampleStocks[1].id }]],
    ]);
    render(<StockTable stocks={sampleStocks.slice(0, 2)} accountHoldingsByStockId={holdings} onEdit={vi.fn()} onDelete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "보유 계좌" }));

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent(sampleStocks[1].name);
    expect(rows[1]).toHaveTextContent(sampleStocks[0].name);
  });
});

describe("StockTable search", () => {
  it("finds a stock by ticker regardless of case", () => {
    render(<StockTable stocks={sampleStocks} accountHoldingsByStockId={new Map()} onEdit={vi.fn()} onDelete={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "종목 검색" }), { target: { value: sampleStocks[0].ticker.toLocaleLowerCase() } });

    expect(screen.getByText(sampleStocks[0].name)).toBeInTheDocument();
    for (const stock of sampleStocks.slice(1)) expect(screen.queryByText(stock.name)).not.toBeInTheDocument();
  });
});

function holding(accountId: string, accountName: string, currency: StockAccountHolding["currency"] = "KRW"): StockAccountHolding {
  return { stockId: sampleStocks[0].id, accountId, accountName, currency, quantity: 1, averagePrice: 100, investedAmount: 100, investedAmountKrw: 100 };
}
