"use client";
import { useEffect, useState } from "react";
import { samplePlans } from "./sample-data";
import type { BuyPlan } from "./types";
import { loadCollection, saveCollection } from "@/lib/local-repository";
export function usePlanStore() {
  const [plans, setPlans] = useState<BuyPlan[]>(samplePlans);
  useEffect(() => { let active = true; loadCollection("plans", samplePlans).then((value) => { if (active) setPlans(value); }); return () => { active = false; }; }, []);
  const save = (next: BuyPlan[]) => { setPlans(next); void saveCollection("plans", next); };
  return { plans: plans.filter((p) => !p.deletedAt), add: (p: BuyPlan) => save([p, ...plans]), update: (p: BuyPlan) => save(plans.map((x) => x.id === p.id ? p : x)), remove: (id: string) => save(plans.map((x) => x.id === id ? { ...x, deletedAt: new Date().toISOString() } : x)) };
}
