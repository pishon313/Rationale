import type { Stock } from "@/features/stocks/types";
import { resolveStockListingIdentity } from "@/features/stocks/stock-identity";
import { validateStoredCollection } from "@/lib/collection-validation";
import { saveCollectionsAtomically, type CollectionWrite } from "@/lib/local-repository";
import type { BuyPlan } from "./types";

export type PlanStockSelection =
  | { kind: "existing"; stockId: string }
  | { kind: "create"; stock: Stock }
  | { kind: "restore"; stockId: string };

export type PlanStockMutation = {
  nextStocks: Stock[];
  nextPlans: BuyPlan[];
  writes: CollectionWrite[];
  stocksChanged: boolean;
};

export function buildPlanStockMutation(input: {
  stocks: readonly Stock[];
  plans: readonly BuyPlan[];
  plan: BuyPlan;
  previousPlan?: BuyPlan;
  selection: PlanStockSelection;
  now?: string;
}): PlanStockMutation {
  const now = input.now ?? new Date().toISOString();
  let nextStocks = [...input.stocks];
  let selectedStock: Stock;
  let stocksChanged = false;

  const selection = input.selection;
  if (selection.kind === "create") {
    if (nextStocks.some((stock) => stock.id === selection.stock.id)) throw new Error("DUPLICATE_STOCK_ID");
    const resolution = resolveStockListingIdentity(selection.stock, nextStocks);
    if (resolution.status === "ambiguous") throw new Error("AMBIGUOUS_STOCK_IDENTITY");
    if (resolution.status === "deleted") throw new Error("DELETED_STOCK_REVIEW_REQUIRED");
    if (resolution.status === "active") {
      selectedStock = resolution.stock;
    } else {
      selectedStock = selection.stock;
      nextStocks = [selectedStock, ...nextStocks];
      stocksChanged = true;
    }
  } else {
    const stored = nextStocks.find((stock) => stock.id === selection.stockId);
    if (!stored) throw new Error("STOCK_NOT_FOUND");
    if (selection.kind === "restore") {
      if (!stored.deletedAt) throw new Error("STOCK_RESTORE_STALE");
      const otherResolution = resolveStockListingIdentity(stored, nextStocks.filter((stock) => stock.id !== stored.id));
      if (otherResolution.status !== "new") throw new Error("AMBIGUOUS_STOCK_IDENTITY");
      selectedStock = { ...stored, deletedAt: null, updatedAt: now };
      nextStocks = nextStocks.map((stock) => stock.id === stored.id ? selectedStock : stock);
      stocksChanged = true;
    } else {
      const preservingDeletedLink = Boolean(stored.deletedAt && input.previousPlan?.stockId === stored.id && input.plan.stockId === stored.id);
      if (stored.deletedAt && !preservingDeletedLink) throw new Error("DELETED_STOCK_REVIEW_REQUIRED");
      selectedStock = stored;
    }
  }

  const normalizedPlan: BuyPlan = {
    ...input.plan,
    stockId: selectedStock.id,
    stockName: selectedStock.name,
    ticker: selectedStock.ticker,
  };
  const previous = input.previousPlan;
  if (previous && !input.plans.some((plan) => plan.id === previous.id)) throw new Error("PLAN_EDIT_STALE");
  if (!previous && input.plans.some((plan) => plan.id === normalizedPlan.id)) throw new Error("DUPLICATE_PLAN_ID");
  const nextPlans = previous
    ? input.plans.map((plan) => plan.id === previous.id ? normalizedPlan : plan)
    : [normalizedPlan, ...input.plans];

  assertValidCandidate("stocks", nextStocks);
  assertValidCandidate("plans", nextPlans);
  const stockIds = new Set(nextStocks.map((stock) => stock.id));
  if (nextPlans.some((plan) => !stockIds.has(plan.stockId))) throw new Error("PLAN_STOCK_REFERENCE_INVALID");

  const writes: CollectionWrite[] = [
    ...(stocksChanged ? [{ collection: "stocks", values: nextStocks }] : []),
    { collection: "plans", values: nextPlans },
  ];
  return { nextStocks, nextPlans, writes, stocksChanged };
}

export async function persistPlanStockMutation(
  mutation: PlanStockMutation,
  save: typeof saveCollectionsAtomically = saveCollectionsAtomically,
) {
  await save(mutation.writes);
}

function assertValidCandidate(collection: "stocks" | "plans", values: readonly Stock[] | readonly BuyPlan[]) {
  const result = validateStoredCollection(collection, values);
  if (!result.valid) throw new Error(`INVALID_${collection.toUpperCase()}_CANDIDATE`);
}
