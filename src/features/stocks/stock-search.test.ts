import { describe, expect, it } from "vitest";
import { registeredStockResultLimit, normalizeStockSearchText, searchRegisteredStocks } from "./stock-search";
import type { Stock } from "./types";

describe("registered Stock search", () => {
  it("normalizes NFKC, case, trim, and repeated whitespace", () => {
    expect(normalizeStockSearchText("  ＭＵ   Micron\tTechnology  ")).toBe("mu micron technology");
    expect(searchRegisteredStocks([
      stock("full-width", "ＭＵ", "Micron   Technology"),
    ], " mu ").map((item) => item.id)).toEqual(["full-width"]);
    expect(searchRegisteredStocks([
      stock("whitespace", "OTHER", "Micron   Technology"),
    ], "MICRON technology").map((item) => item.id)).toEqual(["whitespace"]);
  });

  it("ranks exact, prefix, and contains matches deterministically", () => {
    const values = [
      stock("name-contains", "ZZC", "Alpha MU Holdings"),
      stock("ticker-contains", "XMU", "Other"),
      stock("name-prefix", "ZZB", "MU Holdings"),
      stock("name-exact", "ZZA", "MU"),
      stock("ticker-prefix", "MUSA", "Other"),
      stock("ticker-exact", "MU", "Other"),
    ];
    expect(searchRegisteredStocks(values, "mu").map((item) => item.id)).toEqual([
      "ticker-exact",
      "ticker-prefix",
      "name-exact",
      "name-prefix",
      "ticker-contains",
      "name-contains",
    ]);
  });

  it("preserves punctuation instead of removing it", () => {
    const value = stock("berkshire", "BRK.B", "Berkshire Hathaway");
    expect(searchRegisteredStocks([value], "brk.b")).toEqual([value]);
    expect(searchRegisteredStocks([value], "brkb")).toEqual([]);
  });

  it("uses normalized ticker, name, then ID as deterministic tie breakers", () => {
    const values = [
      stock("z", "ABC", "Same"),
      stock("a", "ABC", "Same"),
      stock("middle", "ABC", "Before"),
      stock("ticker", "ABB", "Later"),
    ];
    expect(searchRegisteredStocks(values, "a").map((item) => item.id)).toEqual(["ticker", "middle", "a", "z"]);
  });

  it("caps empty results while retaining the selected active Stock", () => {
    const values = Array.from({ length: 70 }, (_, index) => stock(`id-${index}`, `T${String(index).padStart(3, "0")}`, `Stock ${index}`));
    const selected = values[69];
    const result = searchRegisteredStocks(values, "", { selectedStockId: selected.id });
    expect(result).toHaveLength(registeredStockResultLimit);
    expect(result.map((item) => item.id)).toContain(selected.id);
  });

  it("excludes deleted Stocks except explicitly included linked records", () => {
    const active = stock("active", "ACT", "Active");
    const selectedDeleted = stock("selected-deleted", "OLD", "Old", "2026-01-01T00:00:00Z");
    const otherDeleted = stock("other-deleted", "GONE", "Gone", "2026-01-01T00:00:00Z");
    expect(searchRegisteredStocks([active, selectedDeleted, otherDeleted], "").map((item) => item.id)).toEqual(["active"]);
    expect(searchRegisteredStocks([active, selectedDeleted, otherDeleted], "", {
      selectedStockId: selectedDeleted.id,
      includeDeletedSelected: true,
    }).map((item) => item.id)).toEqual(["active", "selected-deleted"]);
    expect(searchRegisteredStocks([active, selectedDeleted, otherDeleted], "gone", {
      selectedStockId: selectedDeleted.id,
      includeDeletedSelected: true,
    })).toEqual([]);
  });

  it("searches about 5,000 registered Stocks within a lightweight budget", () => {
    const values = Array.from({ length: 5_000 }, (_, index) => stock(`id-${index}`, `T${String(index).padStart(5, "0")}`, `Synthetic Stock ${index}`));
    const startedAt = performance.now();
    const result = searchRegisteredStocks(values, "T04999");
    expect(result.map((item) => item.id)).toEqual(["id-4999"]);
    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});

function stock(id: string, ticker: string, name: string, deletedAt: string | null = null): Stock {
  return {
    id, ticker, name, market: "미국", currency: "USD", assetType: "주식", sector: "", status: "관찰",
    investmentType: "관찰 전용", currentPrice: 0, targetPrice: null, averagePrice: 0, quantity: 0,
    thesisSummary: "", currentView: "판단 보류", currentViewMemo: "", nextReviewDate: null, tags: [],
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", deletedAt,
  };
}
