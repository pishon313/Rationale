"use client";
import { Columns3, List, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import type { Stock } from "@/features/stocks/types";
import { useLocalCollection } from "@/lib/use-local-collection";
import { PlanForm, type PlanFormStockSelection } from "./plan-form";
import { buildPlanStockMutation, persistPlanStockMutation } from "./plan-stock-mutation";
import { kanbanStatuses, planStatuses, type BuyPlan } from "./types";
import { usePlanStore } from "./use-plan-store";

export function PlansPageClient() {
  const { t } = useI18n();
  const planStore = usePlanStore();
  const stockStore = useLocalCollection<Stock>("stocks", []);
  const { plans, update, remove } = planStore;
  const [view, setView] = useState<"table" | "board">("table");
  const [editing, setEditing] = useState<BuyPlan | "new" | null>(null);
  async function savePlan(plan: BuyPlan, selection?: PlanFormStockSelection) {
    const previousPlan = editing === "new" ? undefined : editing ?? undefined;
    const mutation = buildPlanStockMutation({
      stocks: stockStore.allItems,
      plans: planStore.allPlans,
      plan,
      previousPlan,
      selection: selection ?? { kind: "existing", stockId: plan.stockId },
    });
    await persistPlanStockMutation(mutation);
    if (mutation.stocksChanged) stockStore.applyCommitted(mutation.nextStocks);
    planStore.applyCommitted(mutation.nextPlans);
    setEditing(null);
  }
  return <><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-[var(--muted)]">{t("실제 주문 전에 조건을 명확히")}</p><h1 className="mt-1 text-2xl font-semibold">{t("매수 계획")}</h1></div><div className="flex gap-2"><div className="flex rounded-lg border bg-[var(--surface)] p-1"><button aria-label={t("테이블 보기")} onClick={() => setView("table")} className={`grid size-8 place-items-center rounded ${view === "table" ? "bg-[var(--surface-muted)]" : ""}`}><List size={16} /></button><button aria-label={t("칸반 보기")} onClick={() => setView("board")} className={`grid size-8 place-items-center rounded ${view === "board" ? "bg-[var(--surface-muted)]" : ""}`}><Columns3 size={16} /></button></div><button onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white"><Plus size={17} />{t("계획 추가")}</button></div></div>{view === "table" ? <PlanTable plans={plans} onEdit={setEditing} onUpdate={update} onRemove={remove} /> : <PlanBoard plans={plans} onEdit={setEditing} onUpdate={update} />}{editing && <PlanForm plan={editing === "new" ? undefined : editing} onCancel={() => setEditing(null)} onSave={savePlan} />}</>;
}

function PlanTable({ plans, onEdit, onUpdate, onRemove }: { plans: BuyPlan[]; onEdit: (p: BuyPlan) => void; onUpdate: (p: BuyPlan) => void; onRemove: (id: string) => void }) {
  const { t, formatNumber } = useI18n();
  return <section className="mt-6 overflow-hidden rounded-xl border bg-[var(--surface)]"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-[var(--surface-muted)] text-xs text-[var(--muted)]"><tr>{["종목", "계획", "시나리오", "목표가", "예정 금액", "예정 비중", "상태", ""].map((h) => <th key={h} className="whitespace-nowrap px-4 py-3 font-medium">{t(h)}</th>)}</tr></thead><tbody>{plans.map((p) => <tr key={p.id} className="border-t hover:bg-[var(--surface-muted)]"><td className="px-4 py-4"><b>{p.stockName}</b><small className="block text-[var(--muted)]">{p.ticker}</small></td><td className="px-4 py-4"><button onClick={() => onEdit(p)} className="font-medium hover:text-[var(--accent)]">{p.title}</button><small className="block max-w-64 truncate text-[var(--muted)]">{p.conditionDescription}</small></td><td className="px-4">{t(p.scenarioType)}</td><td className="px-4 text-right tabular-nums">{p.targetPrice == null ? "—" : formatNumber(p.targetPrice, { maximumFractionDigits: 8 })}</td><td className="px-4 text-right tabular-nums">{formatNumber(p.plannedAmount, { maximumFractionDigits: 8 })}</td><td className="px-4 text-right">{p.plannedPortfolioPercent == null ? "—" : formatNumber(p.plannedPortfolioPercent / 100, { style: "percent", maximumFractionDigits: 2 })}</td><td className="px-4"><select aria-label={t("{title} 상태", { title: p.title })} className="rounded-full border bg-[var(--surface)] px-2 py-1 text-xs" value={p.status} onChange={(e) => onUpdate({ ...p, status: e.target.value as BuyPlan["status"], updatedAt: new Date().toISOString() })}>{planStatuses.map((v) => <option key={v} value={v}>{t(v)}</option>)}</select></td><td className="px-4"><div className="flex"><button aria-label={t("{title} 수정", { title: p.title })} onClick={() => onEdit(p)} className="grid size-8 place-items-center"><MoreHorizontal size={16} /></button><button aria-label={t("{title} 삭제", { title: p.title })} onClick={() => onRemove(p.id)} className="destructive-icon-action grid size-8 place-items-center rounded-md"><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div></section>;
}

function PlanBoard({ plans, onEdit, onUpdate }: { plans: BuyPlan[]; onEdit: (p: BuyPlan) => void; onUpdate: (p: BuyPlan) => void }) {
  const { t, formatNumber } = useI18n();
  return <div className="mt-6 overflow-x-auto pb-4"><div className="grid min-w-[1200px] grid-cols-6 gap-3">{kanbanStatuses.map((status) => { const items = plans.filter((p) => p.status === status); return <section key={status} className="rounded-xl bg-[var(--surface-muted)] p-3"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">{t(status)}</h2><span className="rounded-full bg-[var(--surface)] px-2 text-xs text-[var(--muted)]">{formatNumber(items.length)}</span></div><div className="space-y-3">{items.map((p) => <article key={p.id} className="rounded-lg border bg-[var(--surface)] p-3 shadow-sm"><button onClick={() => onEdit(p)} className="text-left"><small className="text-[var(--muted)]">{p.stockName} · {p.ticker}</small><h3 className="mt-1 text-sm font-medium leading-5">{p.title}</h3><p className="mt-2 line-clamp-2 text-xs leading-5 text-[var(--muted)]">{p.conditionDescription}</p></button><div className="mt-3 flex items-center justify-between border-t pt-3"><span className="text-xs">{t("조건 {done}/{total}", { done: formatNumber(p.conditions.filter((c) => c.isSatisfied).length), total: formatNumber(p.conditions.length) })}</span><select aria-label={t("{title} 단계 이동", { title: p.title })} className="max-w-24 bg-transparent text-xs text-[var(--accent)]" value={p.status} onChange={(e) => onUpdate({ ...p, status: e.target.value as BuyPlan["status"], updatedAt: new Date().toISOString() })}>{kanbanStatuses.map((v) => <option key={v} value={v}>{t(v)}</option>)}</select></div></article>)}</div></section>; })}</div></div>;
}
