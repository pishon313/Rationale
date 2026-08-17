import type { Stock } from "./types";

export const registeredStockResultLimit = 50;

export type RegisteredStockSearchOptions = {
  selectedStockId?: string | null;
  includeDeletedSelected?: boolean;
  includeDeletedIds?: readonly string[];
  limit?: number;
};

export function normalizeStockSearchText(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export function searchRegisteredStocks(
  stocks: readonly Stock[],
  query: string,
  options: RegisteredStockSearchOptions = {},
) {
  const normalizedQuery = normalizeStockSearchText(query);
  const limit = Math.max(1, options.limit ?? registeredStockResultLimit);
  const includedDeletedIds = new Set(options.includeDeletedIds ?? []);
  if (options.includeDeletedSelected && options.selectedStockId) includedDeletedIds.add(options.selectedStockId);

  const candidates = stocks.filter((stock) => !stock.deletedAt || includedDeletedIds.has(stock.id));
  if (!normalizedQuery) {
    const ordered = [...candidates].sort(compareStocks);
    const visible = ordered.slice(0, limit);
    const selected = options.selectedStockId
      ? ordered.find((stock) => stock.id === options.selectedStockId)
      : undefined;
    if (!selected || visible.some((stock) => stock.id === selected.id)) return visible;
    return [...visible.slice(0, limit - 1), selected].sort(compareStocks);
  }

  return candidates
    .map((stock) => ({ stock, rank: stockSearchRank(stock, normalizedQuery) }))
    .filter((item): item is { stock: Stock; rank: number } => item.rank !== null)
    .sort((left, right) => left.rank - right.rank || compareStocks(left.stock, right.stock))
    .slice(0, limit)
    .map((item) => item.stock);
}

function stockSearchRank(stock: Stock, query: string) {
  const ticker = normalizeStockSearchText(stock.ticker);
  const name = normalizeStockSearchText(stock.name);
  if (ticker === query) return 0;
  if (ticker.startsWith(query)) return 1;
  if (name === query) return 2;
  if (name.startsWith(query)) return 3;
  if (ticker.includes(query)) return 4;
  if (name.includes(query)) return 5;
  return null;
}

function compareStocks(left: Stock, right: Stock) {
  return compareText(normalizeStockSearchText(left.ticker), normalizeStockSearchText(right.ticker))
    || compareText(normalizeStockSearchText(left.name), normalizeStockSearchText(right.name))
    || compareText(left.id, right.id);
}

function compareText(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
