import type { Stock } from "./types";

export type PortfolioCategorySummary = {
  key: string;
  name: string;
  activeStockCount: number;
  totalStockCount: number;
};

export function normalizePortfolioCategoryDisplay(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizePortfolioCategoryKey(value: string) {
  return normalizePortfolioCategoryDisplay(value).toLowerCase();
}

export function portfolioCategoryOf(stock: Pick<Stock, "sector">) {
  return stock.sector;
}

export function collectPortfolioCategories(
  stocks: readonly Stock[],
  currentValue = "",
  locale?: string,
): PortfolioCategorySummary[] {
  const categories = new Map<string, PortfolioCategorySummary>();
  for (const stock of stocks) {
    const name = normalizePortfolioCategoryDisplay(portfolioCategoryOf(stock));
    const key = normalizePortfolioCategoryKey(name);
    if (!key) continue;
    const current = categories.get(key) ?? { key, name, activeStockCount: 0, totalStockCount: 0 };
    current.totalStockCount += 1;
    if (!stock.deletedAt) current.activeStockCount += 1;
    categories.set(key, current);
  }
  const currentName = normalizePortfolioCategoryDisplay(currentValue);
  const currentKey = normalizePortfolioCategoryKey(currentName);
  if (currentKey && !categories.has(currentKey)) categories.set(currentKey, { key: currentKey, name: currentName, activeStockCount: 0, totalStockCount: 0 });
  const collator = new Intl.Collator(locale, { sensitivity: "base" });
  return [...categories.values()].sort((left, right) => right.activeStockCount - left.activeStockCount || collator.compare(left.name, right.name) || left.key.localeCompare(right.key));
}

export function canonicalPortfolioCategoryName(stocks: readonly Stock[], value: string) {
  const display = normalizePortfolioCategoryDisplay(value);
  if (!display) return "";
  const key = normalizePortfolioCategoryKey(display);
  return collectPortfolioCategories(stocks).find((category) => category.key === key)?.name ?? display;
}

export function renamePortfolioCategory(stocks: readonly Stock[], sourceKey: string, nextName: string, updatedAt: string): Stock[] {
  const source = requireExistingCategory(stocks, sourceKey);
  const display = validCategoryName(nextName);
  const targetKey = normalizePortfolioCategoryKey(display);
  const existingTarget = collectPortfolioCategories(stocks).find((category) => category.key === targetKey);
  if (existingTarget && existingTarget.key !== source.key) throw new Error("PORTFOLIO_CATEGORY_TARGET_EXISTS");
  return replaceCategory(stocks, source.key, display, updatedAt);
}

export function mergePortfolioCategory(stocks: readonly Stock[], sourceKey: string, targetKey: string, updatedAt: string): Stock[] {
  const source = requireExistingCategory(stocks, sourceKey);
  const target = requireExistingCategory(stocks, targetKey);
  if (source.key === target.key) throw new Error("PORTFOLIO_CATEGORY_SAME_TARGET");
  return replaceCategory(stocks, source.key, target.name, updatedAt);
}

export function clearPortfolioCategory(stocks: readonly Stock[], sourceKey: string, updatedAt: string): Stock[] {
  const source = requireExistingCategory(stocks, sourceKey);
  return replaceCategory(stocks, source.key, "", updatedAt);
}

function replaceCategory(stocks: readonly Stock[], sourceKey: string, nextName: string, updatedAt: string) {
  return stocks.map((stock) => normalizePortfolioCategoryKey(portfolioCategoryOf(stock)) === sourceKey
    ? { ...stock, sector: nextName, updatedAt }
    : stock);
}

function requireExistingCategory(stocks: readonly Stock[], key: string) {
  const category = collectPortfolioCategories(stocks).find((item) => item.key === key);
  if (!category) throw new Error("PORTFOLIO_CATEGORY_NOT_FOUND");
  return category;
}

function validCategoryName(value: string) {
  const display = normalizePortfolioCategoryDisplay(value);
  if (!display) throw new Error("PORTFOLIO_CATEGORY_EMPTY");
  if (display.length > 60) throw new Error("PORTFOLIO_CATEGORY_TOO_LONG");
  return display;
}
