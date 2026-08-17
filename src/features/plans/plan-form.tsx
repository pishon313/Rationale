"use client";
import { X } from "lucide-react";
import { useState } from "react";
import { calculatePlanRisk } from "@/domain/plan-performance";
import { RegisteredStockPicker } from "@/features/stocks/registered-stock-picker";
import type { Stock } from "@/features/stocks/types";
import { useI18n } from "@/i18n/i18n-provider";
import { useLocalCollection } from "@/lib/use-local-collection";
import { conditionTypes, planStatuses, scenarioTypes, type BuyPlan, type BuyPlanCondition } from "./types";

export function PlanForm(props: { plan?: BuyPlan; onCancel: () => void; onSave: (plan: BuyPlan) => void }) {
  const { t } = useI18n();
  const stockStore = useLocalCollection<Stock>("stocks", []);
  if (!stockStore.ready) return <div className="fixed inset-0 z-50 grid place-items-center bg-black/35"><div className="rounded-xl bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">{t("종목을 불러오는 중...")}</div></div>;
  const archived = props.plan ? stockStore.allItems.find((stock) => stock.id === props.plan?.stockId && stock.deletedAt) : undefined;
  return <LoadedPlanForm key={props.plan?.id ?? stockStore.items[0]?.id ?? "empty"} {...props} stocks={archived ? [...stockStore.items, archived] : stockStore.items} />;
}

function LoadedPlanForm({ plan, stocks, onCancel, onSave }: { plan?: BuyPlan; stocks: Stock[]; onCancel: () => void; onSave: (plan: BuyPlan) => void }) {
  const { t, formatNumber } = useI18n();
  const [value, setValue] = useState<BuyPlan>(() => plan ?? ({ stockId: stocks.find((stock) => !stock.deletedAt)?.id ?? "", title: "", scenarioType: "눌림목", conditionType: "특정 가격 도달", conditionDescription: "", targetPrice: null, stopLossPrice: null, takeProfitPrice: null, priceRangeMin: null, priceRangeMax: null, plannedAmount: 0, plannedQuantity: 0, plannedPortfolioPercent: 30, priority: 3, status: "아이디어", invalidationCondition: "", expectedHoldingPeriod: "", memo: "", conditions: [] } as unknown as BuyPlan));
  const [condition, setCondition] = useState("");
  const set = (name: keyof BuyPlan, next: unknown) => setValue((current) => ({ ...current, [name]: next }));
  const field = "mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm";
  const risk = calculatePlanRisk(value);
  const addCondition = () => { if (condition.trim()) { set("conditions", [...value.conditions, { id: crypto.randomUUID(), label: condition.trim(), isRequired: true, isSatisfied: null }]); setCondition(""); } };
  const numberField = (name: keyof BuyPlan) => (event: React.ChangeEvent<HTMLInputElement>) => set(name, event.target.value ? Number(event.target.value) : null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const stock = stocks.find((item) => item.id === value.stockId);
    if (!value.title.trim() || !stock) return;
    const now = new Date().toISOString();
    onSave({ ...value, id: plan?.id ?? crypto.randomUUID(), stockName: stock.name, ticker: stock.ticker, title: value.title.trim(), createdAt: plan?.createdAt ?? now, updatedAt: now, executedAt: value.status === "완료" ? now : null, deletedAt: null });
  }

  return <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="dialog" aria-modal="true"><form className="h-full w-full max-w-2xl overflow-y-auto bg-[var(--surface)]" onSubmit={submit}>
    <div className="sticky top-0 flex items-center justify-between border-b bg-[var(--surface)] p-5"><div><h2 className="text-lg font-semibold">{t(plan ? "매수 계획 수정" : "새 매수 계획")}</h2><p className="mt-1 text-xs text-[var(--muted)]">{t("진입 전에 조건과 무효화 기준을 작성하세요.")}</p></div><button type="button" onClick={onCancel} aria-label={t("닫기")}><X /></button></div>
    <div className="grid gap-5 p-5 sm:grid-cols-2">
      <RegisteredStockPicker
        stocks={stocks}
        value={value.stockId || null}
        onChange={(stockId) => set("stockId", stockId ?? "")}
        label={t("종목")}
        required
        includeDeletedSelected={Boolean(plan?.stockId)}
        noResultsAction={<span>{t("온라인 종목 검색은 다음 단계에서 지원합니다.")}</span>}
      />
      <Label text={t("계획 제목")}><input required className={field} value={value.title} onChange={(e) => set("title", e.target.value)} /></Label>
      <Label text={t("시나리오")}><select className={field} value={value.scenarioType} onChange={(e) => set("scenarioType", e.target.value)}>{scenarioTypes.map((item) => <option key={item} value={item}>{t(item)}</option>)}</select></Label>
      <Label text={t("조건 유형")}><select className={field} value={value.conditionType} onChange={(e) => set("conditionType", e.target.value)}>{conditionTypes.map((item) => <option key={item} value={item}>{t(item)}</option>)}</select></Label>
      <div className="sm:col-span-2"><Label text={t("조건 설명")}><textarea className="mt-1 min-h-20 w-full rounded-lg border p-3 text-sm" value={value.conditionDescription} onChange={(e) => set("conditionDescription", e.target.value)} /></Label></div>
      <Label text={t("계획 진입가")}><input type="number" min="0" step="any" className={field} value={value.targetPrice ?? ""} onChange={numberField("targetPrice")} /></Label>
      <Label text={t("손절가")}><input type="number" min="0" step="any" className={field} value={value.stopLossPrice ?? ""} onChange={numberField("stopLossPrice")} /></Label>
      <Label text={t("목표가")}><input type="number" min="0" step="any" className={field} value={value.takeProfitPrice ?? ""} onChange={numberField("takeProfitPrice")} /></Label>
      <Label text={t("예정 금액")}><input type="number" min="0" step="any" className={field} value={value.plannedAmount} onChange={(e) => set("plannedAmount", Number(e.target.value))} /></Label>
      <Label text={t("예정 수량")}><input type="number" min="0" step="any" className={field} value={value.plannedQuantity} onChange={(e) => set("plannedQuantity", Number(e.target.value))} /></Label>
      <Label text={t("예정 비중 (%)")}><input type="number" min="0" className={field} value={value.plannedPortfolioPercent ?? ""} onChange={(e) => set("plannedPortfolioPercent", Number(e.target.value))} /></Label>
      <div className="sm:col-span-2 rounded-lg bg-[var(--surface-muted)] p-4 text-sm"><p className="font-medium">{t("계획 리스크")}</p><div className="mt-2 grid gap-2 sm:grid-cols-2"><span>{t("위험금액")} <b>{risk.plannedRiskAmount == null ? "—" : formatNumber(risk.plannedRiskAmount, { maximumFractionDigits: 2 })}</b></span><span>{t("예상 손익비")} <b>{risk.rewardRiskRatio ? `1 : ${formatNumber(risk.rewardRiskRatio, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</b></span></div><small className="mt-2 block text-[var(--muted)]">{t("진입가보다 낮은 손절가와 높은 목표가를 입력하면 계산됩니다.")}</small></div>
      <Label text={t("상태")}><select className={field} value={value.status} onChange={(e) => set("status", e.target.value)}>{planStatuses.map((item) => <option key={item} value={item}>{t(item)}</option>)}</select></Label>
      <Label text={t("예상 보유 기간")}><input className={field} value={value.expectedHoldingPeriod} onChange={(e) => set("expectedHoldingPeriod", e.target.value)} /></Label>
      <div className="sm:col-span-2"><Label text={t("무효화 조건")}><textarea required className="mt-1 min-h-20 w-full rounded-lg border p-3 text-sm" value={value.invalidationCondition} onChange={(e) => set("invalidationCondition", e.target.value)} /></Label></div>
      <div className="sm:col-span-2"><p className="text-sm font-medium">{t("조건 체크리스트")}</p><div className="mt-2 flex gap-2"><input className={field} value={condition} onChange={(e) => setCondition(e.target.value)} placeholder={t("예: 거래량 증가 확인")} /><button type="button" onClick={addCondition} className="mt-1 rounded-lg border px-4 text-sm">{t("추가")}</button></div><div className="mt-2 space-y-2">{value.conditions.map((item: BuyPlanCondition) => <label key={item.id} className="flex items-center gap-2 rounded-lg bg-[var(--surface-muted)] p-3 text-sm"><input type="checkbox" checked={item.isSatisfied === true} onChange={(e) => set("conditions", value.conditions.map((condition) => condition.id === item.id ? { ...condition, isSatisfied: e.target.checked } : condition))} />{item.label}</label>)}</div></div>
    </div>
    <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-[var(--surface)] p-4"><button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm text-white">{t("저장")}</button></div>
  </form></div>;
}
function Label({ text, children }: { text: string; children: React.ReactNode }) { return <label className="text-sm font-medium">{text}{children}</label>; }
