"use client";

import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { formatCurrency } from "@/domain/money";
import { planPriceDeviation } from "@/domain/portfolio";
import { evaluateTradeRules } from "@/domain/rules";
import { tradeAmount, type TradingLedger } from "@/domain/trading-ledger";
import type { BuyPlan } from "@/features/plans/types";
import type { InvestmentRule } from "@/features/rules/types";
import type { Stock } from "@/features/stocks/types";
import { emotions, tradeTypes, type Trade } from "./types";

type Props = {
  trade?: Trade;
  stocks: Stock[];
  plans: BuyPlan[];
  rules: InvestmentRule[];
  ledger: TradingLedger;
  formError?: string;
  onCancel: () => void;
  onSave: (trade: Trade) => Promise<void> | void;
};

const field = "mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm";

export function TradeForm({ trade, stocks, plans, rules, ledger, formError = "", onCancel, onSave }: Props) {
  const firstStock = stocks[0];
  const openingPosition = trade?.isOpeningPosition === true;
  const [type, setType] = useState<Trade["tradeType"]>(openingPosition ? "매수" : trade?.tradeType ?? "매수");
  const [stockId, setStockId] = useState(trade?.stockId ?? firstStock?.id ?? "");
  const [planId, setPlanId] = useState(trade?.planId ?? "");
  const [tradedAt, setTradedAt] = useState(() => toLocalDateTime(trade?.tradedAt));
  const [quantity, setQuantity] = useState(trade?.quantity ?? 0);
  const [price, setPrice] = useState(trade?.price ?? 0);
  const [amount, setAmount] = useState(trade ? tradeAmount(trade) : 0);
  const [currency, setCurrency] = useState<Trade["currency"]>(trade?.currency ?? firstStock?.currency ?? "KRW");
  const [exchangeRate, setExchangeRate] = useState(trade?.exchangeRate ?? (currency === "KRW" ? 1 : 1380));
  const [fee, setFee] = useState(trade?.fee ?? 0);
  const [tax, setTax] = useState(trade?.tax ?? 0);
  const [accountName, setAccountName] = useState(trade?.accountName ?? "기본 계좌");
  const [memo, setMemo] = useState(trade?.memo ?? "");
  const [emotion, setEmotion] = useState(trade?.emotion ?? "평온");
  const [emotionIntensity, setEmotionIntensity] = useState(trade?.emotionIntensity ?? 2);
  const [conditionMet, setConditionMet] = useState((trade?.ruleComplianceScore ?? 5) >= 4);
  const [localError, setLocalError] = useState("");
  const [saving, setSaving] = useState(false);

  const stock = stocks.find((item) => item.id === stockId);
  const isSecurity = type === "매수" || type === "매도";
  const isDividend = type === "배당";
  const linkedPlans = plans.filter((plan) => plan.stockId === stockId && !["완료", "취소", "무효화"].includes(plan.status));
  const plan = plans.find((item) => item.id === planId);
  const deviation = plan?.targetPrice ? planPriceDeviation(plan.targetPrice, price) : null;
  const warnings = type === "매수" ? evaluateTradeRules(rules, { amount: quantity * price, planId: planId || null }) : [];
  const accounts = useMemo(
    () => [...new Set(["기본 계좌", ...ledger.cashBalances.map((item) => item.accountName), ...ledger.positions.map((item) => item.accountName)])],
    [ledger],
  );
  const available = ledger.positions
    .filter((item) => item.stockId === stockId && item.accountName === accountName && item.currency === currency)
    .reduce((sum, item) => sum + item.quantity, 0);
  const visibleError = localError || formError;

  function syncStockCurrency(nextStock?: Stock) {
    if (!nextStock) return;
    const nextRate = nextStock.currency === "KRW" ? 1 : currency === "KRW" || exchangeRate === 1 ? 1380 : exchangeRate || 1380;
    setCurrency(nextStock.currency);
    setExchangeRate(nextRate);
  }

  function selectStock(id: string) {
    setStockId(id);
    setPlanId("");
    setLocalError("");
    syncStockCurrency(stocks.find((item) => item.id === id));
  }

  function selectType(next: Trade["tradeType"]) {
    if (openingPosition && next !== "매수") return;
    setType(next);
    setLocalError("");
    if (next !== "매수") setPlanId("");
    if (next === "매수" || next === "매도") syncStockCurrency(stock);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setLocalError("");
    if (!accountName.trim()) {
      setLocalError("계좌명을 입력해 주세요.");
      return;
    }
    if (type === "매수" && stock?.deletedAt && !trade) {
      setLocalError("삭제된 종목은 새로 매수할 수 없습니다. 종목 목록에서 먼저 복원해 주세요.");
      return;
    }
    if (isSecurity && (!stockId || quantity <= 0 || price < 0 || (!openingPosition && price === 0))) {
      setLocalError(openingPosition ? "종목과 0 이상의 평균단가, 0보다 큰 수량을 입력해 주세요." : "종목과 0보다 큰 수량·체결가를 입력해 주세요.");
      return;
    }
    if (!isSecurity && amount <= 0) {
      setLocalError("금액은 0보다 커야 합니다.");
      return;
    }

    const now = new Date().toISOString();
    const savedCurrency = isSecurity && stock ? stock.currency : currency;
    const nextTrade: Trade = {
      id: trade?.id ?? crypto.randomUUID(),
      stockId: isSecurity || isDividend ? stockId || null : null,
      stockName: isSecurity || isDividend ? stock?.name ?? trade?.stockName ?? "" : "",
      planId: type === "매수" ? planId || null : null,
      tradeType: type,
      tradedAt,
      quantity: isSecurity ? quantity : 0,
      price: isSecurity ? price : 0,
      amount: isSecurity ? undefined : amount,
      isOpeningPosition: openingPosition && type === "매수" ? true : undefined,
      currency: savedCurrency,
      exchangeRate: savedCurrency === "KRW" ? 1 : exchangeRate,
      fee,
      tax,
      accountName: accountName.trim(),
      memo,
      emotion: isSecurity ? emotion : "평온",
      emotionIntensity: isSecurity ? emotionIntensity : 1,
      confidenceScore: trade?.confidenceScore ?? 3,
      ruleComplianceScore: isSecurity ? (warnings.length ? 2 : conditionMet ? 5 : 3) : 5,
      createdAt: trade?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    };

    setSaving(true);
    try {
      await onSave(nextTrade);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="dialog" aria-modal="true" aria-labelledby="trade-form-title">
      <form className="h-full w-full max-w-2xl overflow-y-auto bg-[var(--surface)]" onSubmit={submit}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-[var(--surface)] p-5">
          <div>
            <h2 id="trade-form-title" className="text-lg font-semibold">{trade ? "기록 수정" : "새 원장 기록"}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">매매와 현금 흐름을 한 원장에 기록합니다.</p>
          </div>
          <button type="button" aria-label="닫기" disabled={saving} onClick={onCancel} className="disabled:opacity-50"><X /></button>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-2">
          {visibleError && <div role="alert" className="sm:col-span-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{visibleError}</div>}

          <div className="sm:col-span-2">
            <Label text="유형">
              <div className="mt-2 grid grid-cols-5 rounded-lg bg-[var(--surface-muted)] p-1">
                {tradeTypes.map((item) => {
                  const locked = openingPosition && item !== "매수";
                  return <button key={item} type="button" disabled={saving || locked} onClick={() => selectType(item)} className={`rounded-md px-2 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${type === item ? "bg-[var(--surface)] font-medium text-[var(--accent)] shadow-sm" : "text-[var(--muted)]"}`}>{item}</button>;
                })}
              </div>
              {openingPosition && <small className="mt-2 block text-[var(--muted)]">기초 포지션은 매수 유형으로만 유지됩니다.</small>}
            </Label>
          </div>

          {(isSecurity || isDividend) && <Label text="종목"><select required={isSecurity} className={field} value={stockId} onChange={(event) => selectStock(event.target.value)}><option value="">종목 선택</option>{!stock && trade?.stockId && <option value={trade.stockId}>{trade.stockName} (현재 목록에 없음)</option>}{stocks.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.ticker}){item.deletedAt ? " · 삭제됨" : ""}</option>)}</select></Label>}
          {isSecurity && <>
            <Label text="수량"><input required type="number" min="0" step="any" className={field} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />{type === "매도" && <small className="mt-1 block text-[var(--muted)]">현재 원장 보유: {available.toLocaleString()}주</small>}</Label>
            <Label text="체결 가격"><input required type="number" min="0" step="any" className={field} value={price} onChange={(event) => setPrice(Number(event.target.value))} /></Label>
          </>}
          {!isSecurity && <Label text={type === "배당" ? "세전 배당금" : `${type} 금액`}><input required type="number" min="0" step="any" className={field} value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></Label>}
          <Label text="거래 일시"><input required type="datetime-local" className={field} value={tradedAt} onChange={(event) => setTradedAt(event.target.value)} /></Label>
          <Label text="계좌"><input required list="account-names" className={field} value={accountName} onChange={(event) => setAccountName(event.target.value)} /><datalist id="account-names">{accounts.map((item) => <option key={item}>{item}</option>)}</datalist></Label>
          {(!isSecurity || !stock) && <Label text="통화"><select className={field} value={currency} onChange={(event) => { const next = event.target.value as Trade["currency"]; setCurrency(next); setExchangeRate(next === "KRW" ? 1 : currency === "KRW" ? 1380 : exchangeRate || 1380); }}><option>KRW</option><option>USD</option></select></Label>}
          {currency === "USD" && <Label text="적용 환율"><input required type="number" min="0" step="any" className={field} value={exchangeRate} onChange={(event) => setExchangeRate(Number(event.target.value))} /></Label>}
          <Label text="수수료"><input type="number" min="0" step="any" className={field} value={fee} onChange={(event) => setFee(Number(event.target.value))} /></Label>
          <Label text="세금"><input type="number" min="0" step="any" className={field} value={tax} onChange={(event) => setTax(Number(event.target.value))} /></Label>

          {type === "매수" && <div className="sm:col-span-2"><Label text="연결된 매수 계획"><select className={field} value={planId} onChange={(event) => setPlanId(event.target.value)}><option value="">비계획 매매</option>{linkedPlans.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></Label></div>}
          {plan && <div className="sm:col-span-2 rounded-lg bg-[var(--surface-muted)] p-4 text-sm"><p className="font-medium">계획 대비 확인</p><p className="mt-2">가격 오차: {deviation ? `${deviation.greaterThan(0) ? "+" : ""}${deviation.toFixed(1)}%` : "계산 대기"}</p><label className="mt-3 flex gap-2"><input type="checkbox" checked={conditionMet} onChange={(event) => setConditionMet(event.target.checked)} />계획 조건이 충족되었음을 확인</label></div>}
          {warnings.length > 0 && <div className="sm:col-span-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-semibold">원칙 위반 가능성 {warnings.length}건</p>{warnings.map((warning) => <p key={warning.ruleId} className="mt-2">[{warning.severity}] {warning.message}</p>)}</div>}
          {isSecurity && <>
            <Label text="감정"><select className={field} value={emotion} onChange={(event) => setEmotion(event.target.value)}>{emotions.map((item) => <option key={item}>{item}</option>)}</select></Label>
            <Label text="감정 강도"><input type="range" min="1" max="5" className="mt-3 w-full" value={emotionIntensity} onChange={(event) => setEmotionIntensity(Number(event.target.value))} /><small className="block text-center text-[var(--muted)]">{emotionIntensity} / 5</small></Label>
          </>}
          <div className="sm:col-span-2"><Label text="메모"><textarea className="mt-1 min-h-20 w-full rounded-lg border bg-[var(--surface)] p-3 text-sm" value={memo} onChange={(event) => setMemo(event.target.value)} /></Label></div>
          <div className="sm:col-span-2 rounded-lg bg-[var(--surface-muted)] p-4"><p className="text-xs text-[var(--muted)]">예상 원장 금액</p><p className="mt-1 text-lg font-semibold tabular-nums">{formatCurrency(isSecurity ? quantity * price : amount, isSecurity && stock ? stock.currency : currency)}</p></div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-[var(--surface)] p-4">
          <button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">취소</button>
          <button disabled={saving} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm text-white disabled:opacity-60">{saving ? "저장 중..." : trade ? "변경 저장" : "기록 저장"}</button>
        </div>
      </form>
    </div>
  );
}

function Label({ text, children }: { text: string; children: React.ReactNode }) {
  return text === "유형" ? <div className="text-sm font-medium"><p>{text}</p>{children}</div> : <label className="text-sm font-medium">{text}{children}</label>;
}

function toLocalDateTime(value?: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return value?.slice(0, 16) ?? "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
