"use client";

import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { currencies, fallbackRatesToKrw, fetchHistoricalRateToKrw } from "@/domain/currency";
import { planPriceDeviation } from "@/domain/portfolio";
import { evaluateTradeRules } from "@/domain/rules";
import { tradeAmount, type TradingLedger } from "@/domain/trading-ledger";
import type { BuyPlan } from "@/features/plans/types";
import type { InvestmentRule } from "@/features/rules/types";
import type { Stock } from "@/features/stocks/types";
import { useI18n } from "@/i18n/i18n-provider";
import { localDateTimeValue } from "@/lib/local-date";
import { useExchangeRates } from "@/lib/use-exchange-rates";
import { canonicalTradeAccount, displayTradeSystemText, translateTradeText } from "./trade-i18n";
import { emotions, tradeTypes, type Trade } from "./types";

type Props = {
  trade?: Trade;
  initialType?: Trade["tradeType"];
  stocks: Stock[];
  plans: BuyPlan[];
  rules: InvestmentRule[];
  ledger: TradingLedger;
  formError?: string;
  onCancel: () => void;
  onSave: (trade: Trade) => Promise<void> | void;
};

type RateNote = { key: string; date?: string };

const field = "mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm";
// 계획 연결 데이터와 저장 로직은 유지하되, 당분간 원장 입력 UI에서는 숨깁니다.
const showLinkedPlanField = false;

export function TradeForm({ trade, initialType = "매수", stocks, plans, rules, ledger, formError = "", onCancel, onSave }: Props) {
  const { t, formatDate, formatNumber } = useI18n();
  const exchangeRates = useExchangeRates();
  const firstStock = stocks[0];
  const openingPosition = trade?.isOpeningPosition === true;
  const [type, setType] = useState<Trade["tradeType"]>(openingPosition ? "매수" : trade?.tradeType ?? initialType);
  const [stockId, setStockId] = useState(trade?.stockId ?? firstStock?.id ?? "");
  const [planId, setPlanId] = useState(trade?.planId ?? "");
  const [tradedAt, setTradedAt] = useState(() => toLocalDateTime(trade?.tradedAt));
  const [quantity, setQuantity] = useState(trade?.quantity ?? 0);
  const [price, setPrice] = useState(trade?.price ?? 0);
  const [amount, setAmount] = useState(trade ? tradeAmount(trade) : 0);
  const [currency, setCurrency] = useState<Trade["currency"]>(trade?.currency ?? firstStock?.currency ?? "KRW");
  const [exchangeRate, setExchangeRate] = useState(trade?.exchangeRate ?? fallbackRatesToKrw[currency]);
  const [rateNote, setRateNote] = useState<RateNote>(trade ? { key: "저장된 거래 환율" } : { key: "기준환율 확인 중" });
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
  const linkedPlans = plans.filter((plan) => plan.stockId === stockId && (type === "매도" || !["완료", "취소", "무효화"].includes(plan.status)));
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
  const translatedError = visibleError ? translateTradeText(visibleError, t, formatNumber) : "";
  const money = (value: number, moneyCurrency: Trade["currency"]) => formatNumber(value, {
    style: "currency",
    currency: moneyCurrency,
    minimumFractionDigits: moneyCurrency === "KRW" || moneyCurrency === "JPY" ? 0 : 2,
    maximumFractionDigits: moneyCurrency === "KRW" || moneyCurrency === "JPY" ? 0 : 2,
  });

  useEffect(() => {
    if (currency === "KRW" || trade && trade.currency === currency) return;
    let active = true;
    fetchHistoricalRateToKrw(currency, tradedAt.slice(0, 10))
      .then((result) => {
        if (active) {
          setExchangeRate(result.rate);
          setRateNote({ key: "{date} 기준환율 · 직접 수정 가능", date: result.date });
        }
      })
      .catch(() => {
        if (active) {
          setExchangeRate(exchangeRates.snapshot.ratesToKrw[currency]);
          setRateNote(exchangeRates.snapshot.rateDate
            ? { key: "{date} 환율 · 오프라인", date: exchangeRates.snapshot.rateDate }
            : { key: "저장된 환율 · 오프라인" });
        }
      });
    return () => { active = false; };
  }, [currency, exchangeRates.snapshot.rateDate, exchangeRates.snapshot.ratesToKrw, trade, tradedAt]);

  function syncStockCurrency(nextStock?: Stock) {
    if (!nextStock) return;
    const nextRate = exchangeRates.snapshot.ratesToKrw[nextStock.currency];
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
    if (next !== "매수" && next !== "매도") setPlanId("");
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
      planId: isSecurity ? planId || null : null,
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
      ruleViolations: isSecurity ? warnings : [],
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

  const localizedRateNote = rateNote.date
    ? t(rateNote.key, { date: formatDate(`${rateNote.date}T00:00:00`, { dateStyle: "medium" }) })
    : t(rateNote.key);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="dialog" aria-modal="true" aria-labelledby="trade-form-title">
      <form className="h-full w-full max-w-2xl overflow-y-auto bg-[var(--surface)]" onSubmit={submit}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-[var(--surface)] p-5">
          <div>
            <h2 id="trade-form-title" className="text-lg font-semibold">{trade ? t("기록 수정") : t("새 원장 기록")}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("매매와 현금 흐름을 한 원장에 기록합니다.")}</p>
          </div>
          <button type="button" aria-label={t("닫기")} disabled={saving} onClick={onCancel} className="disabled:opacity-50"><X /></button>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-2">
          {translatedError && <div role="alert" className="sm:col-span-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{translatedError}</div>}

          <div className="sm:col-span-2">
            <Label text={t("유형")} asGroup>
              <div className="mt-2 grid grid-cols-5 rounded-lg bg-[var(--surface-muted)] p-1">
                {tradeTypes.map((item) => {
                  const locked = openingPosition && item !== "매수";
                  return <button key={item} type="button" disabled={saving || locked} onClick={() => selectType(item)} className={`rounded-md px-2 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${type === item ? "bg-[var(--surface)] font-medium text-[var(--accent)] shadow-sm" : "text-[var(--muted)]"}`}>{t(item)}</button>;
                })}
              </div>
              {openingPosition && <small className="mt-2 block text-[var(--muted)]">{t("기초 포지션은 매수 유형으로만 유지됩니다.")}</small>}
            </Label>
          </div>

          {(isSecurity || isDividend) && <Label text={t("종목")}><select required={isSecurity} className={field} value={stockId} onChange={(event) => selectStock(event.target.value)}><option value="">{t("종목 선택")}</option>{!stock && trade?.stockId && <option value={trade.stockId}>{t("{stock} (현재 목록에 없음)", { stock: trade.stockName })}</option>}{stocks.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.ticker}){item.deletedAt ? ` · ${t("삭제됨")}` : ""}</option>)}</select></Label>}
          {isSecurity && <>
            <Label text={t("수량")}><input required type="number" min="0" step="any" className={field} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />{type === "매도" && <small className="mt-1 block text-[var(--muted)]">{t("현재 원장 보유: {quantity}주", { quantity: formatNumber(available) })}</small>}</Label>
            <Label text={t("체결 가격")}><input required type="number" min="0" step="any" className={field} value={price} onChange={(event) => setPrice(Number(event.target.value))} /></Label>
          </>}
          {!isSecurity && <Label text={type === "배당" ? t("세전 배당금") : t("{type} 금액", { type: t(type) })}><input required type="number" min="0" step="any" className={field} value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></Label>}
          <Label text={t("거래 일시")}><input required type="datetime-local" className={field} value={tradedAt} onChange={(event) => setTradedAt(event.target.value)} /></Label>
          <Label text={t("계좌")}><input required list="account-names" className={field} value={displayTradeSystemText(accountName, t)} onChange={(event) => setAccountName(canonicalTradeAccount(event.target.value, t))} /><datalist id="account-names">{accounts.map((item) => <option key={item} value={displayTradeSystemText(item, t)} />)}</datalist></Label>
          {(!isSecurity || !stock) && <Label text={t("통화")}><select className={field} value={currency} onChange={(event) => { const next = event.target.value as Trade["currency"]; setCurrency(next); setExchangeRate(exchangeRates.snapshot.ratesToKrw[next]); }}>{currencies.map((item) => <option key={item}>{item}</option>)}</select></Label>}
          {currency !== "KRW" && <Label text={t("적용 환율")}><input aria-label={t("적용 환율")} required type="number" min="0" step="any" className={field} value={exchangeRate} onChange={(event) => { setExchangeRate(Number(event.target.value)); setRateNote({ key: "직접 입력한 환율" }); }} /><small className="mt-1 block text-[var(--muted)]">{t("1 {currency}당 KRW · {note}", { currency, note: localizedRateNote })}</small></Label>}
          <Label text={t("수수료")}><input type="number" min="0" step="any" className={field} value={fee} onChange={(event) => setFee(Number(event.target.value))} /></Label>
          <Label text={t("세금")}><input type="number" min="0" step="any" className={field} value={tax} onChange={(event) => setTax(Number(event.target.value))} /></Label>

          {showLinkedPlanField && isSecurity && <div className="sm:col-span-2"><Label text={t("연결된 매매 계획")}><select className={field} value={planId} onChange={(event) => setPlanId(event.target.value)}><option value="">{t("비계획 매매")}</option>{linkedPlans.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select></Label></div>}
          {showLinkedPlanField && plan && <div className="sm:col-span-2 rounded-lg bg-[var(--surface-muted)] p-4 text-sm"><p className="font-medium">{t("계획 대비 확인")}</p><div className="mt-2 grid gap-1 sm:grid-cols-3"><p>{t("가격 오차: {value}", { value: deviation ? formatNumber(deviation.dividedBy(100).toNumber(), { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" }) : t("계산 대기") })}</p><p>{t("수량: {actual} / {planned}", { actual: formatNumber(quantity), planned: formatNumber(plan.plannedQuantity) })}</p><p>{t("금액: {actual} / {planned}", { actual: formatNumber(quantity * price), planned: formatNumber(plan.plannedAmount) })}</p></div>{type === "매수" && <label className="mt-3 flex gap-2"><input type="checkbox" checked={conditionMet} onChange={(event) => setConditionMet(event.target.checked)} />{t("계획 조건이 충족되었음을 확인")}</label>}</div>}
          {warnings.length > 0 && <div className="sm:col-span-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><p className="font-semibold">{t("원칙 위반 가능성 {count}건", { count: formatNumber(warnings.length) })}</p>{warnings.map((warning) => <p key={warning.ruleId} className="mt-2">[{t(warning.severity)}] {translateTradeText(warning.message, t, formatNumber)}</p>)}</div>}
          {isSecurity && <>
            <Label text={t("감정")}><select className={field} value={emotion} onChange={(event) => setEmotion(event.target.value)}>{emotions.map((item) => <option key={item} value={item}>{t(item)}</option>)}</select></Label>
            <Label text={t("감정 강도")}><input type="range" min="1" max="5" className="mt-3 w-full" value={emotionIntensity} onChange={(event) => setEmotionIntensity(Number(event.target.value))} /><small className="block text-center text-[var(--muted)]">{formatNumber(emotionIntensity)} / 5</small></Label>
          </>}
          <div className="sm:col-span-2"><Label text={t("메모")}><textarea className="mt-1 min-h-20 w-full rounded-lg border bg-[var(--surface)] p-3 text-sm" value={memo} onChange={(event) => setMemo(event.target.value)} /></Label></div>
          <div className="sm:col-span-2 rounded-lg bg-[var(--surface-muted)] p-4"><p className="text-xs text-[var(--muted)]">{t("예상 원장 금액")}</p><p className="mt-1 text-lg font-semibold tabular-nums">{money(isSecurity ? quantity * price : amount, isSecurity && stock ? stock.currency : currency)}</p></div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-[var(--surface)] p-4">
          <button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">{t("취소")}</button>
          <button disabled={saving} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm text-white disabled:opacity-60">{saving ? t("저장 중...") : trade ? t("변경 저장") : t("기록 저장")}</button>
        </div>
      </form>
    </div>
  );
}

function Label({ text, children, asGroup = false }: { text: string; children: React.ReactNode; asGroup?: boolean }) {
  return asGroup ? <div className="text-sm font-medium"><p>{text}</p>{children}</div> : <label className="text-sm font-medium">{text}{children}</label>;
}

function toLocalDateTime(value?: string) {
  const date = value ? new Date(value) : null;
  if (!date) return localDateTimeValue();
  if (Number.isNaN(date.getTime())) return value?.slice(0, 16) ?? "";
  return localDateTimeValue(date);
}
