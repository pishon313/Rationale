import type { InstrumentSearchResult } from "./market-data";
import type { ProviderInstrumentRef, Stock } from "./types";

export type StockIdentityResolution =
  | { status: "active"; stock: Stock }
  | { status: "deleted"; stock: Stock }
  | { status: "ambiguous"; stocks: Stock[] }
  | { status: "new" };

type ListingIdentity = {
  providerRefs?: readonly ProviderInstrumentRef[];
  isin?: string | null;
};

export function resolveInstrumentStockIdentity(
  result: InstrumentSearchResult,
  stocks: readonly Stock[],
): StockIdentityResolution {
  return resolveStockListingIdentity({
    providerRefs: [{ provider: result.provider, symbol: result.providerSymbol, exchangeCode: result.exchangeCode }],
    isin: result.isin,
  }, stocks);
}

export function resolveStockListingIdentity(
  identity: ListingIdentity,
  stocks: readonly Stock[],
): StockIdentityResolution {
  const matches = stocks.filter((stock) => authoritativeIdentityMatch(identity, stock));
  if (matches.length > 1) return { status: "ambiguous", stocks: [...matches].sort((left, right) => left.id.localeCompare(right.id)) };
  if (!matches.length) return { status: "new" };
  return matches[0].deletedAt ? { status: "deleted", stock: matches[0] } : { status: "active", stock: matches[0] };
}

function authoritativeIdentityMatch(identity: ListingIdentity, stock: Stock) {
  const identityIsin = normalize(identity.isin);
  const stockIsin = normalize(stock.isin);
  if (identityIsin && stockIsin && identityIsin === stockIsin) return true;
  return (identity.providerRefs ?? []).some((candidate) => (stock.providerRefs ?? []).some((stored) => providerRefMatches(candidate, stored)));
}

function providerRefMatches(left: ProviderInstrumentRef, right: ProviderInstrumentRef) {
  if (left.provider !== right.provider || normalize(left.symbol) !== normalize(right.symbol)) return false;
  const leftExchange = normalize(left.exchangeCode);
  const rightExchange = normalize(right.exchangeCode);
  return !leftExchange || !rightExchange || leftExchange === rightExchange;
}

function normalize(value: string | null | undefined) {
  return value?.normalize("NFKC").trim().toUpperCase() ?? "";
}
