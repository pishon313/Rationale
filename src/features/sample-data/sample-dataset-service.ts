import type { InvestmentAccount } from "@/features/accounts/types";
import type { Note } from "@/features/notes/types";
import type { Observation } from "@/features/observations/types";
import type { BuyPlan } from "@/features/plans/types";
import type { PortfolioAllocationTarget } from "@/features/portfolio-plan/types";
import type { Review } from "@/features/reviews/types";
import type { InvestmentRule } from "@/features/rules/types";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { loadCollection, saveCollectionsAtomically, type CollectionWrite } from "@/lib/local-repository";
import { buildSampleDataset, knownSampleIds, sampleCollectionNames, type SampleCollectionName, type SampleDataset } from "./sample-dataset";

export type SampleDatasetState = "none" | "installed" | "partial";
export type SampleCollections = SampleDataset & { portfolioAllocationTargets: PortfolioAllocationTarget[] };
export type SampleDependencySummary = Partial<Record<SampleCollectionName | "portfolioAllocationTargets", number>>;

export async function loadSampleCollections(): Promise<SampleCollections> {
  const [accounts, stocks, trades, plans, observations, reviews, rules, notes, portfolioAllocationTargets] = await Promise.all([
    loadCollection<InvestmentAccount>("accounts", []), loadCollection<Stock>("stocks", []), loadCollection<Trade>("trades", []), loadCollection<BuyPlan>("plans", []),
    loadCollection<Observation>("observations", []), loadCollection<Review>("reviews", []), loadCollection<InvestmentRule>("rules", []), loadCollection<Note>("notes", []),
    loadCollection<PortfolioAllocationTarget>("portfolio-allocation-targets", []),
  ]);
  return { accounts, stocks, trades, plans, observations, reviews, rules, notes, portfolioAllocationTargets };
}

export function deriveSampleDatasetState(collections: SampleDataset, dataset = buildSampleDataset(new Date())): SampleDatasetState {
  const known = knownSampleIds(dataset); let found = 0; let expected = 0;
  for (const name of sampleCollectionNames) { expected += known[name].size; found += collections[name].filter((item) => known[name].has(item.id)).length; }
  return found === 0 ? "none" : found === expected ? "installed" : "partial";
}

export async function installSampleDataset(now: Date | string = new Date(), dependencies: ServiceDependencies = defaults) {
  const dataset = buildSampleDataset(now); const current = await dependencies.load(); let addedCount = 0; let existingCount = 0;
  const writes = sampleCollectionNames.map((collection) => {
    const existingIds = new Set(current[collection].map((item) => item.id));
    const missing = dataset[collection].filter((item) => { if (existingIds.has(item.id)) { existingCount++; return false; } addedCount++; return true; });
    return { collection, values: [...current[collection], ...missing] } as CollectionWrite;
  });
  if (addedCount) await dependencies.save(writes);
  return { addedCount, existingCount, state: "installed" as const };
}

export async function removeSampleDataset(now: Date | string = new Date(), dependencies: ServiceDependencies = defaults) {
  const dataset = buildSampleDataset(now); const current = await dependencies.load(); const known = knownSampleIds(dataset);
  const dependenciesFound = findUserDependencies(current, known);
  if (Object.values(dependenciesFound).some(Boolean)) throw new SampleDependencyError(dependenciesFound);
  let removedCount = 0;
  const writes = sampleCollectionNames.map((collection) => ({ collection, values: current[collection].filter((item) => { const remove = known[collection].has(item.id); if (remove) removedCount++; return !remove; }) })) as CollectionWrite[];
  if (removedCount) await dependencies.save(writes);
  return { removedCount, state: "none" as const };
}

export class SampleDependencyError extends Error { constructor(public summary: SampleDependencySummary) { super("직접 작성한 기록이 샘플 데이터에 연결되어 있습니다."); } }

function findUserDependencies(current: SampleCollections, known: ReturnType<typeof knownSampleIds>): SampleDependencySummary {
  const count = (name: SampleCollectionName, predicate: (item: never) => boolean) => current[name].filter((item) => !known[name].has(item.id) && predicate(item as never)).length;
  const summary: SampleDependencySummary = {
    trades: count("trades", (item: Trade) => Boolean(item.accountId && known.accounts.has(item.accountId) || item.stockId && known.stocks.has(item.stockId) || item.planId && known.plans.has(item.planId))),
    plans: count("plans", (item: BuyPlan) => known.stocks.has(item.stockId)),
    observations: count("observations", (item: Observation) => Boolean(item.stockId && known.stocks.has(item.stockId))),
    reviews: count("reviews", (item: Review) => Boolean(item.stockId && known.stocks.has(item.stockId) || item.tradeId && known.trades.has(item.tradeId))),
    portfolioAllocationTargets: current.portfolioAllocationTargets.filter((target) => target.targetType === "stock" && known.stocks.has(target.stockId)).length,
  };
  return Object.fromEntries(Object.entries(summary).filter(([, value]) => value)) as SampleDependencySummary;
}

type ServiceDependencies = { load: () => Promise<SampleCollections>; save: (writes: readonly CollectionWrite[]) => Promise<void> };
const defaults: ServiceDependencies = { load: loadSampleCollections, save: (writes) => saveCollectionsAtomically(writes, { source: "sampleData" }) };
