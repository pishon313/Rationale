import { describe, expect, it } from "vitest";
import { sampleStocks } from "./sample-data";
import {
  canonicalPortfolioCategoryName,
  clearPortfolioCategory,
  collectPortfolioCategories,
  mergePortfolioCategory,
  normalizePortfolioCategoryDisplay,
  normalizePortfolioCategoryKey,
  renamePortfolioCategory,
} from "./portfolio-categories";
import type { Stock } from "./types";

const at = "2026-08-17T00:00:00.000Z";
const changedAt = "2026-08-18T00:00:00.000Z";

describe("portfolio category normalization", () => {
  it("normalizes NFKC, trims, collapses whitespace, and case-folds identity", () => {
    expect(normalizePortfolioCategoryDisplay("  Ｅnergy\t  Infrastructure  ")).toBe("Energy Infrastructure");
    expect(normalizePortfolioCategoryKey("Energy")).toBe(normalizePortfolioCategoryKey(" energy "));
  });

  it("preserves punctuation and keeps similar categories distinct", () => {
    expect(normalizePortfolioCategoryDisplay("반도체, IT - Core")).toBe("반도체, IT - Core");
    expect(normalizePortfolioCategoryKey("반도체")).not.toBe(normalizePortfolioCategoryKey("반도체, IT"));
  });

  it("reuses an existing canonical display spelling", () => {
    expect(canonicalPortfolioCategoryName([stock("a", "Energy")], " energy ")).toBe("Energy");
    expect(canonicalPortfolioCategoryName([], "  신규  분류 ")).toBe("신규 분류");
  });
});

describe("portfolio category collection", () => {
  it("deduplicates identity, counts active and total Stocks, excludes empty values, and sorts deterministically", () => {
    const stocks = [
      stock("a", "Energy"),
      stock("b", " energy "),
      stock("c", "반도체"),
      stock("d", "Energy", { deletedAt: at }),
      stock("e", "   "),
    ];
    expect(collectPortfolioCategories(stocks, "신규", "ko")).toEqual([
      { key: "energy", name: "Energy", activeStockCount: 2, totalStockCount: 3 },
      { key: "반도체", name: "반도체", activeStockCount: 1, totalStockCount: 1 },
      { key: "신규", name: "신규", activeStockCount: 0, totalStockCount: 0 },
    ]);
  });
});

describe("portfolio category mutations", () => {
  it("renames exact normalized matches including soft-deleted Stocks without mutating input", () => {
    const unchanged = stock("other", "반도체, IT", { marketSector: "information-technology", tags: ["tag"] });
    const stocks = [stock("a", "Energy"), stock("b", " energy ", { deletedAt: at }), unchanged];
    const snapshot = structuredClone(stocks);
    const result = renamePortfolioCategory(stocks, "energy", "  원자재  ", changedAt);
    expect(result.map((item) => item.sector)).toEqual(["원자재", "원자재", "반도체, IT"]);
    expect(result[0].updatedAt).toBe(changedAt);
    expect(result[1].updatedAt).toBe(changedAt);
    expect(result[2]).toBe(unchanged);
    expect(result[2]).toMatchObject({ marketSector: "information-technology", tags: ["tag"] });
    expect(stocks).toEqual(snapshot);
  });

  it("allows a normalized self-rename but requires merge for an existing target", () => {
    const stocks = [stock("a", "Energy"), stock("b", "반도체")];
    expect(renamePortfolioCategory(stocks, "energy", "ENERGY", changedAt)[0].sector).toBe("ENERGY");
    expect(() => renamePortfolioCategory(stocks, "energy", "반도체", changedAt)).toThrow("PORTFOLIO_CATEGORY_TARGET_EXISTS");
  });

  it("merges into the target's canonical spelling and rejects invalid source or same target", () => {
    const stocks = [stock("a", "Energy"), stock("b", "반도체"), stock("c", " 반도체 ")];
    const result = mergePortfolioCategory(stocks, "energy", "반도체", changedAt);
    expect(result.map((item) => item.sector)).toEqual(["반도체", "반도체", " 반도체 "]);
    expect(() => mergePortfolioCategory(stocks, "missing", "반도체", changedAt)).toThrow("PORTFOLIO_CATEGORY_NOT_FOUND");
    expect(() => mergePortfolioCategory(stocks, "energy", "missing", changedAt)).toThrow("PORTFOLIO_CATEGORY_NOT_FOUND");
    expect(() => mergePortfolioCategory(stocks, "반도체", "반도체", changedAt)).toThrow("PORTFOLIO_CATEGORY_SAME_TARGET");
  });

  it("clears only the category and never deletes Stocks or changes market sector and tags", () => {
    const original = stock("a", "Energy", { marketSector: "energy", tags: ["oil"], deletedAt: at });
    const result = clearPortfolioCategory([original], "energy", changedAt);
    expect(result[0]).toMatchObject({ id: "a", sector: "", marketSector: "energy", tags: ["oil"], deletedAt: at, updatedAt: changedAt });
  });
});

function stock(id: string, sector: string, overrides: Partial<Stock> = {}): Stock {
  return { ...sampleStocks[0], id, sector, createdAt: at, updatedAt: at, deletedAt: null, ...overrides };
}
