"use client";
import type { BuyPlan } from "./types";
import { useLocalCollection } from "@/lib/use-local-collection";
export function usePlanStore() {
  const store = useLocalCollection<BuyPlan>("plans", []);
  return { plans: store.items, ready: store.ready, add: store.add, update: store.update, remove: store.remove };
}
