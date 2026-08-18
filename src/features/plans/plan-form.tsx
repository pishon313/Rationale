"use client";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { useState } from "react";
import { calculatePlanRisk } from "@/domain/plan-performance";
import type { InstrumentSearchResult } from "@/features/stocks/market-data";
import { RegisteredStockPicker } from "@/features/stocks/registered-stock-picker";
import { createStockFromInstrumentSearchResult, instrumentSearchResultIssue } from "@/features/stocks/stock-from-instrument";
import { resolveInstrumentStockIdentity } from "@/features/stocks/stock-identity";
import type { Stock } from "@/features/stocks/types";
import { useI18n } from "@/i18n/i18n-provider";
import { isTauriApp } from "@/lib/local-repository";
import { useLocalCollection } from "@/lib/use-local-collection";
import { conditionTypes, planStatuses, scenarioTypes, type BuyPlan, type BuyPlanCondition } from "./types";

export type PlanFormStockSelection = { kind: "create"; stock: Stock } | { kind: "restore"; stockId: string };

export function PlanForm(props: { plan?: BuyPlan; onCancel: () => void; onSave: (plan: BuyPlan, selection?: PlanFormStockSelection) => void | Promise<void> }) {
  const { t } = useI18n();
  const stockStore = useLocalCollection<Stock>("stocks", []);
  if (!stockStore.ready) return <div className="fixed inset-0 z-50 grid place-items-center bg-black/35"><div className="rounded-xl bg-[var(--surface)] p-6 text-sm text-[var(--muted)]">{t("종목을 불러오는 중...")}</div></div>;
  return <LoadedPlanForm key={props.plan?.id ?? stockStore.items[0]?.id ?? "empty"} {...props} stocks={stockStore.allItems} />;
}

type PendingResult = { kind: "create"; result: InstrumentSearchResult } | { kind: "restore"; result: InstrumentSearchResult; stock: Stock };

function LoadedPlanForm({ plan, stocks, onCancel, onSave }: { plan?: BuyPlan; stocks: Stock[]; onCancel: () => void; onSave: (plan: BuyPlan, selection?: PlanFormStockSelection) => void | Promise<void> }) {
  const { t, formatNumber } = useI18n();
  const [value, setValue] = useState<BuyPlan>(() => plan ?? ({ stockId: stocks.find((stock) => !stock.deletedAt)?.id ?? "", title: "", scenarioType: "눌림목", conditionType: "특정 가격 도달", conditionDescription: "", targetPrice: null, stopLossPrice: null, takeProfitPrice: null, priceRangeMin: null, priceRangeMax: null, plannedAmount: 0, plannedQuantity: 0, plannedPortfolioPercent: 30, priority: 3, status: "아이디어", invalidationCondition: "", expectedHoldingPeriod: "", memo: "", conditions: [] } as unknown as BuyPlan));
  const [condition, setCondition] = useState("");
  const [draftStock, setDraftStock] = useState<Stock | null>(null);
  const [restoreStockId, setRestoreStockId] = useState<string | null>(null);
  const [onlineResults, setOnlineResults] = useState<InstrumentSearchResult[]>([]);
  const [onlineState, setOnlineState] = useState<"idle" | "loading" | "empty" | "error" | "unavailable">("idle");
  const [onlineMessage, setOnlineMessage] = useState("");
  const [pendingResult, setPendingResult] = useState<PendingResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const set = (name: keyof BuyPlan, next: unknown) => setValue((current) => ({ ...current, [name]: next }));
  const field = "mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm";
  const risk = calculatePlanRisk(value);
  const addCondition = () => { if (condition.trim()) { set("conditions", [...value.conditions, { id: crypto.randomUUID(), label: condition.trim(), isRequired: true, isSatisfied: null }]); setCondition(""); } };
  const numberField = (name: keyof BuyPlan) => (event: React.ChangeEvent<HTMLInputElement>) => set(name, event.target.value ? Number(event.target.value) : null);

  const selectableStocks = draftStock ? [draftStock, ...stocks] : stocks;
  const selectedStock = selectableStocks.find((item) => item.id === value.stockId);

  async function searchOnline(query: string) {
    const trimmed = query.trim();
    if (!trimmed) return;
    setOnlineMessage(""); setOnlineResults([]);
    if (!isTauriApp()) { setOnlineState("unavailable"); return; }
    setOnlineState("loading");
    try {
      const results = await invoke<InstrumentSearchResult[]>("search_instruments", { request: { provider: "eodhd", query: trimmed, countryCode: null, limit: 20 } });
      setOnlineResults(results); setOnlineState(results.length ? "idle" : "empty");
    } catch {
      setOnlineState("error");
    }
  }

  function selectRegistered(stockId: string | null) {
    set("stockId", stockId ?? ""); setDraftStock(null); setRestoreStockId(null); setSaveError(""); setOnlineMessage("");
  }

  function reviewOnlineResult(result: InstrumentSearchResult) {
    const issue = instrumentSearchResultIssue(result);
    if (issue) { setOnlineMessage(t(issue === "unsupported-currency" ? "지원하지 않는 통화입니다." : "온라인 검색 결과를 사용할 수 없습니다.")); return; }
    const resolution = resolveInstrumentStockIdentity(result, stocks);
    if (resolution.status === "active") {
      selectRegistered(resolution.stock.id); setOnlineMessage(t("이미 등록된 종목을 선택했습니다.")); return;
    }
    if (resolution.status === "ambiguous") { setOnlineMessage(t("같은 식별 정보의 종목이 여러 개 있어 자동으로 선택할 수 없습니다.")); return; }
    setPendingResult(resolution.status === "deleted" ? { kind: "restore", result, stock: resolution.stock } : { kind: "create", result });
  }

  function confirmOnlineResult() {
    if (!pendingResult) return;
    if (pendingResult.kind === "restore") {
      setDraftStock(null); setRestoreStockId(pendingResult.stock.id); set("stockId", pendingResult.stock.id);
    } else {
      try {
        const stock = createStockFromInstrumentSearchResult(pendingResult.result, { id: crypto.randomUUID(), now: new Date().toISOString() });
        setDraftStock(stock); setRestoreStockId(null); set("stockId", stock.id);
      } catch (error) {
        setOnlineMessage(error instanceof Error && error.message === "UNSUPPORTED_INSTRUMENT_CURRENCY" ? t("지원하지 않는 통화입니다.") : t("온라인 검색 결과를 사용할 수 없습니다."));
      }
    }
    setPendingResult(null); setOnlineResults([]); setOnlineState("idle");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !value.title.trim() || !selectedStock) return;
    const now = new Date().toISOString();
    const nextPlan = { ...value, id: plan?.id ?? crypto.randomUUID(), stockName: selectedStock.name, ticker: selectedStock.ticker, title: value.title.trim(), createdAt: plan?.createdAt ?? now, updatedAt: now, executedAt: value.status === "완료" ? now : null, deletedAt: null };
    setSaving(true); setSaveError("");
    try {
      if (draftStock) await onSave(nextPlan, { kind: "create", stock: draftStock });
      else if (restoreStockId) await onSave(nextPlan, { kind: "restore", stockId: restoreStockId });
      else await onSave(nextPlan);
    } catch {
      setSaveError(t("종목과 매수 계획을 저장하지 못했습니다. 다시 시도해 주세요."));
    } finally { setSaving(false); }
  }

  const form = <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="dialog" aria-modal="true"><form className="h-full w-full max-w-2xl overflow-y-auto bg-[var(--surface)]" onSubmit={submit}>
    <div className="sticky top-0 flex items-center justify-between border-b bg-[var(--surface)] p-5"><div><h2 className="text-lg font-semibold">{t(plan ? "매수 계획 수정" : "새 매수 계획")}</h2><p className="mt-1 text-xs text-[var(--muted)]">{t("진입 전에 조건과 무효화 기준을 작성하세요.")}</p></div><button type="button" onClick={onCancel} aria-label={t("닫기")}><X /></button></div>
    <div className="grid gap-5 p-5 sm:grid-cols-2">
      <div>
      <RegisteredStockPicker
        stocks={selectableStocks}
        value={value.stockId || null}
        onChange={selectRegistered}
        label={t("종목")}
        required
        includeDeletedSelected={Boolean(plan?.stockId)}
        noResultsAction={(query, closePicker) => <button type="button" className="font-medium text-[var(--accent)] underline" onMouseDown={(event) => event.preventDefault()} onClick={() => { closePicker(); void searchOnline(query); }}>{t("온라인에서 ‘{query}’ 검색", { query })}</button>}
      />
      {draftStock && <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("계획을 저장할 때 이 종목을 관찰 상태로 함께 추가합니다.")}</p>}
      {restoreStockId && <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("계획을 저장할 때 삭제된 종목을 함께 복원합니다.")}</p>}
      {onlineState === "loading" && <p className="mt-2 text-xs text-[var(--muted)]">{t("온라인 검색 중...")}</p>}
      {onlineState === "empty" && <p className="mt-2 text-xs text-[var(--muted)]">{t("온라인 검색 결과가 없습니다.")}</p>}
      {onlineState === "error" && <p role="alert" className="mt-2 text-xs text-red-600">{t("온라인 검색에 실패했습니다. 연결 상태와 API 키를 확인해 주세요.")}</p>}
      {onlineState === "unavailable" && <p className="mt-2 text-xs text-[var(--muted)]">{t("온라인 종목 검색은 Mac 앱에서만 사용할 수 있습니다.")}</p>}
      {onlineMessage && <p role="status" className="mt-2 text-xs text-[var(--muted)]">{onlineMessage}</p>}
      {onlineResults.length > 0 && <div className="mt-2 max-h-52 space-y-2 overflow-y-auto rounded-lg border p-2" aria-label={t("온라인 검색 결과")}>{onlineResults.map((result) => { const issue = instrumentSearchResultIssue(result); return <button type="button" disabled={Boolean(issue)} key={`${result.provider}:${result.providerSymbol}:${result.exchangeCode}`} onClick={() => reviewOnlineResult(result)} className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"><b>{result.ticker} · {result.name}</b><span className="mt-0.5 block text-xs text-[var(--muted)]">{result.exchangeName || result.exchangeCode} · {result.currency}</span>{issue && <span className="mt-1 block text-xs text-red-600">{t(issue === "unsupported-currency" ? "지원하지 않는 통화입니다." : "온라인 검색 결과를 사용할 수 없습니다.")}</span>}</button>; })}</div>}
      </div>
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
    {saveError && <p role="alert" className="mx-5 mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">{saveError}</p>}
    <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-[var(--surface)] p-4"><button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">{t("취소")}</button><button disabled={saving} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm text-white disabled:opacity-50">{t(saving ? "저장 중..." : "저장")}</button></div>
  </form></div>;

  return <>{form}{pendingResult && <div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4" role="alertdialog" aria-modal="true" aria-labelledby="plan-stock-confirm-title"><div className="w-full max-w-md rounded-xl border bg-[var(--surface)] p-5 shadow-2xl"><h2 id="plan-stock-confirm-title" className="text-lg font-semibold">{t(pendingResult.kind === "restore" ? "삭제된 종목 복원" : "종목 추가 확인")}</h2><p className="mt-3 font-medium">{pendingResult.result.ticker} · {pendingResult.result.name}</p><p className="mt-1 text-sm text-[var(--muted)]">{pendingResult.result.exchangeName || pendingResult.result.exchangeCode} · {pendingResult.result.currency}</p><p className="mt-4 text-sm leading-6 text-[var(--muted)]">{t(pendingResult.kind === "restore" ? "이 종목은 이전에 삭제된 종목과 일치합니다. 계획을 저장할 때 기존 종목을 복원합니다." : "이 종목은 아직 Rationale에 등록되어 있지 않습니다. 계획을 저장할 때 종목 목록에 관찰 상태로 함께 추가합니다.")}</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setPendingResult(null)} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button type="button" onClick={confirmOnlineResult} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white">{t(pendingResult.kind === "restore" ? "종목 복원 후 계획 만들기" : "추가하고 계획 만들기")}</button></div></div></div>}</>;
}
function Label({ text, children }: { text: string; children: React.ReactNode }) { return <label className="text-sm font-medium">{text}{children}</label>; }
