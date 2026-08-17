import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";
import { sampleStocks } from "./sample-data";
import { RegisteredStockPicker } from "./registered-stock-picker";

describe("RegisteredStockPicker", () => {
  it("shows the selected Stock and exposes combobox/listbox ARIA semantics", () => {
    render(<RegisteredStockPicker stocks={sampleStocks} value="micron" onChange={vi.fn()} label="종목" />);
    const combobox = screen.getByRole("combobox", { name: "종목" });
    expect(combobox).toHaveValue("MU · Micron Technology");
    expect(combobox).toHaveAttribute("aria-autocomplete", "list");
    fireEvent.focus(combobox);
    expect(combobox).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox", { name: "종목" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "MU · Micron Technology" })).toHaveAttribute("aria-selected", "true");
    expect(combobox).toHaveAttribute("aria-activedescendant");
  });

  it("filters ticker and name without deriving the selected ID from display text", () => {
    const onChange = vi.fn();
    render(<RegisteredStockPicker stocks={sampleStocks} value={null} onChange={onChange} label="종목" />);
    const combobox = screen.getByRole("combobox", { name: "종목" });
    fireEvent.focus(combobox);
    fireEvent.change(combobox, { target: { value: "micron" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    fireEvent.click(screen.getByRole("option", { name: "MU · Micron Technology" }));
    expect(onChange).toHaveBeenCalledWith("micron");
  });

  it("supports keyboard navigation and Enter selection", () => {
    const onChange = vi.fn();
    render(<RegisteredStockPicker stocks={sampleStocks} value={null} onChange={onChange} label="종목" />);
    const combobox = screen.getByRole("combobox", { name: "종목" });
    fireEvent.focus(combobox);
    fireEvent.change(combobox, { target: { value: "tsl" } });
    fireEvent.keyDown(combobox, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("tesla");
    expect(combobox).toHaveAttribute("aria-expanded", "false");
  });

  it("moves the active option with Arrow keys and closes with Escape without changing", () => {
    const onChange = vi.fn();
    render(<RegisteredStockPicker stocks={sampleStocks.slice(0, 2)} value={null} onChange={onChange} label="종목" />);
    const combobox = screen.getByRole("combobox", { name: "종목" });
    fireEvent.focus(combobox);
    const firstActive = combobox.getAttribute("aria-activedescendant");
    fireEvent.keyDown(combobox, { key: "ArrowDown" });
    expect(combobox.getAttribute("aria-activedescendant")).not.toBe(firstActive);
    fireEvent.keyDown(combobox, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("responds to an external value update", () => {
    function Harness() {
      const [value, setValue] = useState<string | null>("samsung");
      return <><RegisteredStockPicker stocks={sampleStocks} value={value} onChange={setValue} label="종목" /><button onClick={() => setValue("micron")}>외부 변경</button></>;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "외부 변경" }));
    expect(screen.getByRole("combobox", { name: "종목" })).toHaveValue("MU · Micron Technology");
  });

  it("supports the explicit empty option", () => {
    const onChange = vi.fn();
    render(<RegisteredStockPicker stocks={sampleStocks} value="micron" onChange={onChange} label="종목" allowEmpty emptyLabel="직접 입력" />);
    fireEvent.focus(screen.getByRole("combobox", { name: "종목" }));
    fireEvent.click(screen.getByRole("option", { name: "직접 입력" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("renders the no-results action", () => {
    render(<RegisteredStockPicker stocks={sampleStocks} value={null} onChange={vi.fn()} label="종목" noResultsAction={<a href="/stocks">종목 먼저 추가</a>} />);
    const combobox = screen.getByRole("combobox", { name: "종목" });
    fireEvent.focus(combobox);
    fireEvent.change(combobox, { target: { value: "missing" } });
    expect(screen.getByText("등록된 종목에서 찾을 수 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "종목 먼저 추가" })).toHaveAttribute("href", "/stocks");
  });

  it("includes only the exact deleted selected Stock when requested", () => {
    const deleted = { ...sampleStocks[0], id: "deleted", ticker: "OLD", name: "Old", deletedAt: "2026-01-01T00:00:00Z" };
    const otherDeleted = { ...sampleStocks[1], id: "other-deleted", ticker: "GONE", name: "Gone", deletedAt: "2026-01-01T00:00:00Z" };
    render(<RegisteredStockPicker stocks={[sampleStocks[2], deleted, otherDeleted]} value="deleted" onChange={vi.fn()} label="종목" includeDeletedSelected />);
    expect(screen.getByRole("combobox", { name: "종목" })).toHaveValue("OLD · Old · 삭제됨");
    fireEvent.focus(screen.getByRole("combobox", { name: "종목" }));
    expect(screen.getByRole("option", { name: "OLD · Old · 삭제됨" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /GONE/ })).not.toBeInTheDocument();
  });
});
