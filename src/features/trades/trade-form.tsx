"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";
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
import { translateTradeText } from "./trade-i18n";
import { emotions, tradeTypes, type Trade } from "./types";
import type { InvestmentAccount } from "@/features/accounts/types";
import { createAccountFeeCalculationSnapshot } from "./trade-fee";
import {
  automaticFeeEligible,
  createInitialTradeFeeEntryState,
  evaluateAutomaticTradeFee,
  savedTradeFeeBasisKey,
  tradeFeeBasisKey,
  type AutomaticTradeFeeEvaluation,
  type TradeFeeBasis,
  type TradeFeeEntryState,
} from "./trade-fee-entry";

type Props = {
  trade?: Trade;
  initialType?: Trade["tradeType"];
  initialStockId?: string;
  lockedStockId?: string;
  initialAccountId?: string;
  lockedAccountId?: string;
  allowedTypes?: Trade["tradeType"][];
  openingPosition?: boolean;
  stocks: Stock[];
  plans: BuyPlan[];
  rules: InvestmentRule[];
  ledger: TradingLedger;
  accounts?: InvestmentAccount[];
  formError?: string;
  onCancel: () => void;
  onSave: (trade: Trade) => Promise<void> | void;
};

type RateNote = { key: string; date?: string };

const field = "mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm";
// 계획 연결 데이터와 저장 로직은 유지하되, 당분간 원장 입력 UI에서는 숨깁니다.
const showLinkedPlanField = false;

export function TradeForm({ trade, initialType = "매수", initialStockId, lockedStockId, initialAccountId, lockedAccountId, allowedTypes, openingPosition: createOpeningPosition = false, stocks, plans, rules, ledger, accounts, formError = "", onCancel, onSave }: Props) {
  const { t, formatDate, formatNumber } = useI18n();
  const exchangeRates = useExchangeRates();
  const openingPosition = trade?.isOpeningPosition === true || createOpeningPosition;
  const contextualStockId = lockedStockId ?? initialStockId;
  const openingStock = stocks.find((item) => item.id === contextualStockId);
  const firstStock = openingStock ?? stocks[0];
  const [type, setType] = useState<Trade["tradeType"]>(openingPosition ? "매수" : trade?.tradeType ?? initialType);
  const [stockId, setStockId] = useState(lockedStockId ?? trade?.stockId ?? initialStockId ?? firstStock?.id ?? "");
  const [planId, setPlanId] = useState(trade?.planId ?? "");
  const [tradedAt, setTradedAt] = useState(() => toLocalDateTime(trade?.tradedAt));
  const [quantity, setQuantity] = useState(trade?.quantity ?? 0);
  const [price, setPrice] = useState(trade?.price ?? 0);
  const [amount, setAmount] = useState(trade ? tradeAmount(trade) : 0);
  const [currency, setCurrency] = useState<Trade["currency"]>(trade?.currency ?? firstStock?.currency ?? "KRW");
  const [exchangeRate, setExchangeRate] = useState(trade?.exchangeRate ?? fallbackRatesToKrw[currency]);
  const [rateNote, setRateNote] = useState<RateNote>(trade ? { key: "저장된 거래 환율" } : { key: "기준환율 확인 중" });
  const [tax, setTax] = useState(trade?.tax ?? 0);
  const legacyAccountName = trade?.accountName ?? openingStock?.openingAccountName ?? "기본 계좌";
  const resolvedAccounts = accounts ?? [{ id: trade?.accountId ?? "legacy-form-account", name: legacyAccountName, institution: "", kind: "brokerage" as const, subtype: "", baseCurrency: trade?.currency ?? openingStock?.currency ?? "KRW", isDefault: true, archivedAt: null, memo: "", createdAt: trade?.createdAt ?? "1970-01-01T00:00:00.000Z", updatedAt: trade?.updatedAt ?? trade?.createdAt ?? "1970-01-01T00:00:00.000Z" }];
  const activeAccounts = resolvedAccounts.filter((account) => !account.archivedAt);
  const legacyMatch = resolvedAccounts.find((account) => account.name === legacyAccountName);
  const initialAccount = resolvedAccounts.find((account) => account.id === lockedAccountId)
    ?? resolvedAccounts.find((account) => account.id === trade?.accountId)
    ?? resolvedAccounts.find((account) => account.id === initialAccountId)
    ?? legacyMatch
    ?? activeAccounts.find((account) => account.isDefault)
    ?? activeAccounts[0];
  const [accountId, setAccountId] = useState(initialAccount?.id ?? "");
  const initialFeeStock = stocks.find((item) => item.id === (lockedStockId ?? trade?.stockId ?? initialStockId ?? firstStock?.id)) ?? firstStock;
  const [feeEntryState, setFeeEntry] = useState(() => createInitialTradeFeeEntryState({ trade, account: initialAccount, stock: initialFeeStock, openingPosition, tradeType: type }));
  const [initialFeeBasisKey] = useState(() => trade ? savedTradeFeeBasisKey(trade) : null);
  const [memo, setMemo] = useState(trade?.memo ?? "");
  const [emotion, setEmotion] = useState(trade?.emotion ?? "평온");
  const [emotionIntensity, setEmotionIntensity] = useState(trade?.emotionIntensity ?? 2);
  const [conditionMet, setConditionMet] = useState((trade?.ruleComplianceScore ?? 5) >= 4);
  const [localError, setLocalError] = useState("");
  const [saving, setSaving] = useState(false);
  const visibleTradeTypes = allowedTypes ?? tradeTypes;

  const stock = stocks.find((item) => item.id === stockId);
  const isSecurity = type === "매수" || type === "매도";
  const isDividend = type === "배당";
  const linkedPlans = plans.filter((plan) => plan.stockId === stockId && (type === "매도" || !["완료", "취소", "무효화"].includes(plan.status)));
  const plan = plans.find((item) => item.id === planId);
  const deviation = plan?.targetPrice ? planPriceDeviation(plan.targetPrice, price) : null;
  const warnings = type === "매수" ? evaluateTradeRules(rules, { amount: quantity * price, planId: planId || null }) : [];
  const selectedAccount = resolvedAccounts.find((account) => account.id === accountId);
  const selectableAccounts = resolvedAccounts.filter((account) => !account.archivedAt || account.id === trade?.accountId);
  const available = ledger.positions
    .filter((item) => item.stockId === stockId && item.accountId === accountId && item.currency === currency)
    .reduce((sum, item) => sum + item.quantity, 0);
  const visibleError = localError || formError;
  const translatedError = visibleError ? translateTradeText(visibleError, t, formatNumber) : "";
  const money = (value: number, moneyCurrency: Trade["currency"]) => formatNumber(value, {
    style: "currency",
    currency: moneyCurrency,
    minimumFractionDigits: moneyCurrency === "KRW" || moneyCurrency === "JPY" ? 0 : 2,
    maximumFractionDigits: moneyCurrency === "KRW" || moneyCurrency === "JPY" ? 0 : 2,
  });
  const feeCurrency = isSecurity && stock ? stock.currency : currency;
  const feeBasis: TradeFeeBasis = { accountId, stockId, tradeType: type, tradedAt, quantity, price, currency: feeCurrency };
  const automaticFee = evaluateAutomaticTradeFee({ account: selectedAccount, stock, openingPosition, basis: feeBasis });
  const eligibleForAutomaticFee = automaticFeeEligible({ account: selectedAccount, stock, openingPosition, tradeType: type });
  const feeEntry: TradeFeeEntryState = !trade && feeEntryState.mode === "manual" && !feeEntryState.explicitlySelected && eligibleForAutomaticFee
    ? { mode: "auto" }
    : !trade && feeEntryState.mode === "auto" && !eligibleForAutomaticFee
      ? { mode: "manual", value: "0", explicitlySelected: false }
      : feeEntryState;
  const basisChanged = Boolean(trade && initialFeeBasisKey !== tradeFeeBasisKey(feeBasis));
  const preservedReviewRequired = feeEntry.mode === "preserved" && basisChanged && (feeEntry.feeMode === "accountPolicy" || feeEntry.feeMode === "sourceProvided");
  const visibleFee = feeEntry.mode === "auto" ? automaticFee.status === "matched" ? automaticFee.fee : "0" : feeEntry.value;

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

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onCancel(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onCancel, saving]);

  function syncStockCurrency(nextStock?: Stock) {
    if (!nextStock) return;
    const nextRate = exchangeRates.snapshot.ratesToKrw[nextStock.currency];
    setCurrency(nextStock.currency);
    setExchangeRate(nextRate);
  }

  function selectStock(id: string) {
    if (lockedStockId) return;
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

  function switchFeeToManual() {
    setFeeEntry({ mode: "manual", value: visibleFee, explicitlySelected: true });
    setLocalError("");
  }

  function recalculateFee() {
    setFeeEntry({ mode: "auto" });
    setLocalError("");
  }

  function changeManualFee(value: string) {
    setFeeEntry({ mode: "manual", value, explicitlySelected: true });
    setLocalError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (trade?.cashFlowKind === "transfer") {
      setLocalError("계좌 간 이체는 이체 전용 화면에서 수정해 주세요.");
      return;
    }
    setLocalError("");
    if (!selectedAccount) {
      setLocalError("계좌를 추가하거나 선택해 주세요.");
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

    let savedFee = Number(visibleFee);
    let feeMetadata: Partial<Pick<Trade, "feeMode" | "feeCalculation">>;
    if (feeEntry.mode === "auto") {
      if (automaticFee.status !== "matched") {
        setLocalError(automaticFee.status === "ambiguous" ? "겹치는 계좌 수수료 규칙을 해결하거나 수수료를 직접 입력해 주세요." : "적용되는 계좌 수수료 규칙이 없습니다. 수수료를 직접 입력하거나 계좌 정책을 수정해 주세요.");
        return;
      }
      savedFee = Number(automaticFee.fee);
      feeMetadata = {
        feeMode: "accountPolicy",
        feeCalculation: createAccountFeeCalculationSnapshot({
          policyAccountId: selectedAccount.id,
          side: type === "매수" ? "buy" : "sell",
          tradedAt,
          quantity,
          price,
          currency: feeCurrency,
          result: automaticFee,
        }),
      };
    } else if (feeEntry.mode === "manual") {
      feeMetadata = { feeMode: "manual", feeCalculation: null };
    } else {
      if (preservedReviewRequired) {
        setLocalError(feeEntry.feeMode === "sourceProvided" ? "거래 기준이 변경되어 원본 수수료를 직접 입력으로 확정해 주세요." : "거래 기준이 변경되어 현재 계좌 규칙으로 다시 계산하거나 직접 입력으로 확정해 주세요.");
        return;
      }
      feeMetadata = {
        ...(feeEntry.feeMode === undefined ? {} : { feeMode: feeEntry.feeMode }),
        ...(feeEntry.snapshot === undefined ? {} : { feeCalculation: feeEntry.snapshot }),
      };
    }
    if (!Number.isFinite(savedFee) || savedFee < 0 || !Number.isFinite(tax) || tax < 0) {
      setLocalError("수수료와 세금은 0 이상의 숫자로 입력해 주세요.");
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
      cashFlowKind: openingPosition ? "opening" : type === "입금" || type === "출금" ? (trade?.cashFlowKind ?? "external") : undefined,
      currency: savedCurrency,
      exchangeRate: savedCurrency === "KRW" ? 1 : exchangeRate,
      fee: savedFee,
      ...feeMetadata,
      tax,
      accountId: selectedAccount.id,
      accountName: trade?.accountName ?? selectedAccount.name,
      memo,
      emotion: isSecurity ? emotion : "평온",
      emotionIntensity: isSecurity ? emotionIntensity : 1,
      confidenceScore: trade?.confidenceScore ?? 3,
      ruleComplianceScore: isSecurity ? (warnings.length ? 2 : conditionMet ? 5 : 3) : 5,
      ruleViolations: isSecurity ? warnings : [],
      journalStatus: "recorded",
      origin: trade?.origin ?? { kind: "manual" },
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
    <div className="fixed inset-0 z-[300] flex justify-end bg-black/35" role="dialog" aria-modal="true" aria-labelledby="trade-form-title">
      <form className="h-full w-full max-w-2xl overflow-y-auto bg-[var(--surface)]" onSubmit={submit}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-[var(--surface)] p-5">
          <div>
            <h2 id="trade-form-title" className="text-lg font-semibold">{t(openingPosition && !trade ? "기초 포지션 등록" : trade ? "기록 수정" : "새 원장 기록")}</h2>
            <p className="mt-1 text-xs text-[var(--muted)]">{t(openingPosition ? "기존 보유 수량과 평균단가를 현금 흐름 없이 시작값으로 기록합니다." : "매매와 현금 흐름을 한 원장에 기록합니다.")}</p>
          </div>
          <button type="button" aria-label={t("닫기")} disabled={saving} onClick={onCancel} className="disabled:opacity-50"><X /></button>
        </div>

        <div className="grid gap-5 p-5 sm:grid-cols-2">
          {translatedError && <div role="alert" className="sm:col-span-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{translatedError}</div>}

          <div className="sm:col-span-2">
            <Label text={t("유형")} asGroup>
              <div className="mt-2 grid rounded-lg bg-[var(--surface-muted)] p-1" style={{ gridTemplateColumns: `repeat(${visibleTradeTypes.length}, minmax(0, 1fr))` }}>
                {visibleTradeTypes.map((item) => {
                  const locked = openingPosition && item !== "매수";
                  return <button key={item} type="button" disabled={saving || locked} onClick={() => selectType(item)} className={`rounded-md px-2 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${type === item ? "bg-[var(--surface)] font-medium text-[var(--accent)] shadow-sm" : "text-[var(--muted)]"}`}>{t(item)}</button>;
                })}
              </div>
              {openingPosition && <small className="mt-2 block text-[var(--muted)]">{t("기초 포지션은 매수 유형으로만 유지됩니다.")}</small>}
            </Label>
          </div>

          {(isSecurity || isDividend) && <Label text={t("종목")}><select required={isSecurity} disabled={Boolean(lockedStockId)} className={`${field} disabled:cursor-not-allowed disabled:opacity-70`} value={stockId} onChange={(event) => selectStock(event.target.value)}><option value="">{t("종목 선택")}</option>{!stock && trade?.stockId && <option value={trade.stockId}>{t("{stock} (현재 목록에 없음)", { stock: trade.stockName })}</option>}{stocks.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.ticker}){item.deletedAt ? ` · ${t("삭제됨")}` : ""}</option>)}</select></Label>}
          {isSecurity && <>
            <Label text={t("수량")}><input required type="number" min="0" step="any" className={field} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />{type === "매도" && <small className="mt-1 block text-[var(--muted)]">{t("현재 원장 보유: {quantity}주", { quantity: formatNumber(available) })}</small>}</Label>
            <Label text={t(openingPosition ? "평균단가" : "체결 가격")}><input required type="number" min="0" step="any" className={field} value={price} onChange={(event) => setPrice(Number(event.target.value))} /></Label>
          </>}
          {!isSecurity && <Label text={type === "배당" ? t("세전 배당금") : t("{type} 금액", { type: t(type) })}><input required type="number" min="0" step="any" className={field} value={amount} onChange={(event) => setAmount(Number(event.target.value))} /></Label>}
          <Label text={t("거래 일시")}><input required type="datetime-local" step="1" className={field} value={tradedAt} onChange={(event) => setTradedAt(event.target.value)} /></Label>
          <Label text={t("계좌")}><select required disabled={Boolean(lockedAccountId)} className={`${field} disabled:cursor-not-allowed disabled:opacity-70`} value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">{t("계좌 추가 필요")}</option>{selectableAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}{account.institution ? ` · ${account.institution}` : ""}{account.archivedAt ? ` · ${t("보관됨")}` : ""}</option>)}</select></Label>
          {(!isSecurity || !stock) && <Label text={t("통화")}><select className={field} value={currency} onChange={(event) => { const next = event.target.value as Trade["currency"]; setCurrency(next); setExchangeRate(exchangeRates.snapshot.ratesToKrw[next]); }}>{currencies.map((item) => <option key={item}>{item}</option>)}</select></Label>}
          {currency !== "KRW" && <Label text={t("적용 환율")}><input aria-label={t("적용 환율")} required type="number" min="0" step="any" className={field} value={exchangeRate} onChange={(event) => { setExchangeRate(Number(event.target.value)); setRateNote({ key: "직접 입력한 환율" }); }} /><small className="mt-1 block text-[var(--muted)]">{t("1 {currency}당 KRW · {note}", { currency, note: localizedRateNote })}</small></Label>}
          {isSecurity && !openingPosition ? <section className="sm:col-span-2 rounded-xl border bg-[var(--surface-muted)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p id="trade-fee-title" className="text-sm font-medium">{t("수수료")}</p><p className="mt-1 text-xs text-[var(--muted)]">{t("계좌 정책은 새 거래의 수수료를 계산하며 저장된 수수료는 거래의 확정 기록입니다.")}</p></div><div className="inline-flex rounded-lg border bg-[var(--surface)] p-1" role="group" aria-label={t("수수료 입력 방식")}><button type="button" aria-pressed={feeEntry.mode === "auto" || feeEntry.mode === "preserved" && feeEntry.feeMode === "accountPolicy"} disabled={!automaticFeeEligible({ account: selectedAccount, stock, openingPosition, tradeType: type })} onClick={recalculateFee} className={`rounded-md px-3 py-1.5 text-xs disabled:opacity-40 ${feeEntry.mode === "auto" || feeEntry.mode === "preserved" && feeEntry.feeMode === "accountPolicy" ? "bg-[var(--accent-soft)] text-[var(--accent)]" : ""}`}>{t("자동 계산")}</button><button type="button" aria-pressed={feeEntry.mode === "manual" || feeEntry.mode === "preserved" && feeEntry.feeMode === "manual"} onClick={switchFeeToManual} className={`rounded-md px-3 py-1.5 text-xs ${feeEntry.mode === "manual" || feeEntry.mode === "preserved" && feeEntry.feeMode === "manual" ? "bg-[var(--accent-soft)] text-[var(--accent)]" : ""}`}>{t("직접 입력")}</button></div></div>
            <label className="mt-3 block text-sm"><span className="sr-only">{t("수수료")}</span><input aria-label={t("수수료")} aria-readonly={feeEntry.mode === "auto" || feeEntry.mode === "preserved" && feeEntry.feeMode === "accountPolicy"} readOnly={feeEntry.mode === "auto" || feeEntry.mode === "preserved" && feeEntry.feeMode === "accountPolicy"} type="number" min="0" step="any" className={`${field} read-only:cursor-not-allowed read-only:bg-[var(--surface-muted)]`} value={visibleFee} onChange={(event) => changeManualFee(event.target.value)} /></label>
            <TradeFeeExplanation feeEntry={feeEntry} automaticFee={automaticFee} basisChanged={basisChanged} account={selectedAccount} onManual={switchFeeToManual} onRecalculate={recalculateFee} t={t} formatNumber={formatNumber} currency={feeCurrency} />
          </section> : <Label text={t("수수료")}><input type="number" min="0" step="any" className={field} value={visibleFee} onChange={(event) => changeManualFee(event.target.value)} /></Label>}
          <div className="text-sm font-medium"><label htmlFor="trade-tax">{t("세금")}</label><input id="trade-tax" aria-describedby="trade-tax-help" type="number" min="0" step="any" className={field} value={tax} onChange={(event) => setTax(Number(event.target.value))} /><small id="trade-tax-help" className="mt-1 block text-[var(--muted)]">{t("세금과 제비용은 자동 계산하지 않습니다. 증권사 내역을 확인해 직접 입력하세요.")}</small></div>

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
          <button disabled={saving} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm text-white disabled:opacity-60">{saving ? t("저장 중...") : openingPosition && !trade ? t("기초 포지션 저장") : trade ? t("변경 저장") : t("기록 저장")}</button>
        </div>
      </form>
    </div>
  );
}

function TradeFeeExplanation({ feeEntry, automaticFee, basisChanged, account, onManual, onRecalculate, t, formatNumber, currency }: {
  feeEntry: TradeFeeEntryState;
  automaticFee: AutomaticTradeFeeEvaluation;
  basisChanged: boolean;
  account?: InvestmentAccount;
  onManual: () => void;
  onRecalculate: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  currency: Trade["currency"];
}) {
  const amount = (value: string) => formatNumber(Number(value), { style: "currency", currency, maximumFractionDigits: currency === "KRW" || currency === "JPY" ? 0 : 2 });
  if (feeEntry.mode === "auto") {
    if (automaticFee.status === "matched") {
      const roundingLabel = t(automaticFee.breakdown.roundingMode === "floor" ? "내림" : automaticFee.breakdown.roundingMode === "ceil" ? "올림" : "반올림");
      return <div className="mt-3 text-xs leading-5 text-[var(--muted)]"><p className="font-medium text-[var(--foreground)]">{t("자동 계산 · 계좌 규칙: {name}", { name: automaticFee.rule.name })}</p><p>{t("계좌: {name}", { name: account?.name ?? t("알 수 없음") })}</p><p>{t("총 거래금액 {gross} × {rate}% + 고정 {fixed} → 수수료 {fee}", { gross: amount(automaticFee.grossAmount), rate: automaticFee.rule.ratePercent, fixed: amount(automaticFee.rule.fixedFee), fee: amount(automaticFee.fee) })}</p><p>{t("최소 한도 후 {minimum} · 최대 한도 후 {maximum} · {mode} {unit} → {fee}", { minimum: amount(automaticFee.breakdown.afterMinimum), maximum: amount(automaticFee.breakdown.afterMaximum), mode: roundingLabel, unit: automaticFee.breakdown.roundingUnit, fee: amount(automaticFee.fee) })}</p><p>{t("총 거래금액: {amount}", { amount: amount(automaticFee.grossAmount) })}</p></div>;
    }
    if (automaticFee.status === "incomplete") return <p className="mt-3 text-xs text-[var(--muted)]">{t("수량과 체결 가격을 입력하면 계좌 규칙으로 계산합니다.")}</p>;
    if (automaticFee.status === "ambiguous") {
      const names = automaticFee.ruleIds.map((id) => account?.feePolicy?.rules.find((rule) => rule.id === id)?.name ?? id).join(", ");
      return <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200" role="alert"><p>{t("겹치는 계좌 수수료 규칙이 있습니다: {rules}", { rules: names })}</p><p className="mt-1">{t("계좌 정책을 수정하거나 수수료를 직접 입력해 주세요.")}</p><div className="mt-2 flex gap-2"><button type="button" onClick={onManual} className="rounded-md border px-2 py-1">{t("직접 입력으로 전환")}</button><a href="/accounts" className="rounded-md border px-2 py-1">{t("계좌 정책 편집")}</a></div></div>;
    }
    if (automaticFee.status === "no-match" || automaticFee.status === "invalid-input") return <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100" role="alert"><p>{t("적용되는 계좌 수수료 규칙이 없습니다.")}</p><p className="mt-1">{t("0원으로 자동 저장하지 않습니다. 계좌 정책을 수정하거나 직접 입력해 주세요.")}</p><div className="mt-2 flex gap-2"><button type="button" onClick={onManual} className="rounded-md border px-2 py-1">{t("직접 입력으로 전환")}</button><a href="/accounts" className="rounded-md border px-2 py-1">{t("계좌 정책 편집")}</a></div></div>;
    return <p className="mt-3 text-xs text-[var(--muted)]">{t("선택한 계좌에 자동 수수료 정책이 없습니다. 수수료를 직접 확인해 입력하세요.")}</p>;
  }
  if (feeEntry.mode === "manual") return <div className="mt-3 text-xs leading-5 text-[var(--muted)]"><p>{t("직접 입력한 수수료로 저장하며 계좌 정책 계산 기록은 남기지 않습니다.")}</p>{automaticFee.status === "ineligible" && automaticFee.reason === "policy-disabled" && <p>{t("선택한 계좌에 자동 수수료 정책이 없습니다. 수수료를 직접 확인해 입력하세요.")}</p>}{automaticFee.status !== "ineligible" && <button type="button" onClick={onRecalculate} className="mt-2 rounded-md border bg-[var(--surface)] px-2 py-1">{t("계좌 규칙으로 다시 계산")}</button>}</div>;

  if (feeEntry.feeMode === "accountPolicy") {
    const canRecalculate = automaticFee.status !== "ineligible";
    if (basisChanged) return <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100" role="alert"><p>{t("거래 기준이 변경되어 저장된 자동 계산이 더 이상 유효하지 않습니다.")}</p><p className="mt-1">{t("현재 계좌 규칙으로 다시 계산하거나 직접 입력으로 확정해 주세요.")}</p><div className="mt-2 flex gap-2"><button type="button" disabled={!canRecalculate} onClick={onRecalculate} className="rounded-md border px-2 py-1 disabled:opacity-40">{t("현재 계좌 규칙으로 다시 계산")}</button><button type="button" onClick={onManual} className="rounded-md border px-2 py-1">{t("직접 입력으로 확정")}</button></div></div>;
    return <div className="mt-3 text-xs leading-5 text-[var(--muted)]"><p className="font-medium text-[var(--foreground)]">{t("보존된 자동 계산 · 계좌 규칙: {name}", { name: feeEntry.snapshot?.ruleName ?? t("알 수 없음") })}</p><p>{t("이 거래를 저장할 때 확정된 수수료와 계산 근거를 유지합니다.")}</p>{canRecalculate && <button type="button" onClick={onRecalculate} className="mt-2 rounded-md border bg-[var(--surface)] px-2 py-1">{t("현재 계좌 규칙으로 다시 계산")}</button>}</div>;
  }
  if (feeEntry.feeMode === "sourceProvided") {
    if (basisChanged) return <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100" role="alert"><p>{t("원본에서 제공된 수수료가 거래 변경 후에는 맞지 않을 수 있습니다.")}</p><button type="button" onClick={onManual} className="mt-2 rounded-md border px-2 py-1">{t("직접 입력으로 확정")}</button></div>;
    return <p className="mt-3 text-xs text-[var(--muted)]">{t("원본 파일 또는 증권사에서 제공된 수수료를 보존합니다.")}</p>;
  }
  if (basisChanged) return <p className="mt-3 text-xs text-[var(--muted)]">{t("거래 기준이 변경되었습니다. 저장 전 수수료를 다시 확인해 주세요.")}</p>;
  return <p className="mt-3 text-xs text-[var(--muted)]">{t(feeEntry.feeMode === "manual" ? "직접 입력한 수수료입니다." : "기존 거래의 수수료 출처를 그대로 보존합니다.")}</p>;
}

function Label({ text, children, asGroup = false }: { text: string; children: React.ReactNode; asGroup?: boolean }) {
  return asGroup ? <div className="text-sm font-medium"><p>{text}</p>{children}</div> : <label className="text-sm font-medium">{text}{children}</label>;
}

function toLocalDateTime(value?: string) {
  if (value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return value.length === 16 ? `${value}:00` : value;
  const date = value ? new Date(value) : null;
  if (!date) return localDateTimeValue(new Date(), true);
  if (Number.isNaN(date.getTime())) return value?.slice(0, 19) ?? "";
  return localDateTimeValue(date, true);
}
