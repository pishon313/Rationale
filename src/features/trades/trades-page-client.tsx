"use client";

import { AlertTriangle, ArrowLeftRight, FileUp, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { currencies, fromKrw, type Currency } from "@/domain/currency";
import { buildTradingLedger, tradeAmount } from "@/domain/trading-ledger";
import type { BuyPlan } from "@/features/plans/types";
import type { InvestmentRule } from "@/features/rules/types";
import type { Stock } from "@/features/stocks/types";
import { useI18n } from "@/i18n/i18n-provider";
import { useLocalCollection } from "@/lib/use-local-collection";
import { useCurrencyPreference, useExchangeRates } from "@/lib/use-exchange-rates";
import { localDateTimeValue } from "@/lib/local-date";
import { CsvImportDialog } from "./csv-import-dialog";
import { migrateTrades, projectStocksFromTrades } from "./migrate-trades";
import { TradeForm } from "./trade-form";
import { displayTradeSystemText, translateTradeText } from "./trade-i18n";
import { journalStatusOf, type Trade } from "./types";
import type { InvestmentAccount } from "@/features/accounts/types";
import { buildAccountTransfer, getTransferPair, updateAccountTransfer, type AccountTransferInput } from "@/features/accounts/account-transfer";
import { hasCashBaseline, upsertAccountCashBaseline, type AccountCashBaselineInput, type AccountCashCandidate } from "@/features/accounts/account-cash-actions";
import { AccountCashBaselineDialog } from "@/features/accounts/account-cash-baseline-dialog";
import { AccountCashSummary } from "@/features/accounts/account-cash-summary";
import { buildSoftDeletedTrades, commitTradeMutation } from "./trade-mutations";
import type { ImportMutationPlan } from "@/features/import/import-types";

export function TradesPageClient() {
  const { t, formatDate, formatNumber } = useI18n();
  const exchangeRates = useExchangeRates();
  const currencyPreference = useCurrencyPreference();
  const money = (value: number, currency: Trade["currency"]) => formatNumber(value, {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "KRW" || currency === "JPY" ? 0 : 2,
    maximumFractionDigits: currency === "KRW" || currency === "JPY" ? 0 : 2,
  });
  const display = (valueKrw: number) => money(fromKrw(valueKrw, currencyPreference.displayCurrency, exchangeRates.snapshot.ratesToKrw), currencyPreference.displayCurrency);
  const { allItems: storedTrades, ready: tradesReady, replaceAsync: replaceTradesAsync } = useLocalCollection<Trade>("trades", []);
  const { allItems: accounts, ready: accountsReady, replaceAsync: replaceAccountsAsync } = useLocalCollection<InvestmentAccount>("accounts", []);
  const { allItems: allStocks, ready: stocksReady, replaceAsync: replaceStocksAsync } = useLocalCollection<Stock>("stocks", []);
  const { items: plans, ready: plansReady } = useLocalCollection<BuyPlan>("plans", []);
  const { items: rules, ready: rulesReady } = useLocalCollection<InvestmentRule>("rules", []);
  const [editing, setEditing] = useState<Trade | "new" | null>(null);
  const [openingStockId, setOpeningStockId] = useState("");
  const [newTradeType, setNewTradeType] = useState<Trade["tradeType"]>("매수");
  const [cashDialogRequest, setCashDialogRequest] = useState<AccountCashCandidate | null>(null);
  const [cashReturnFocus, setCashReturnFocus] = useState<HTMLElement | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferEditingId, setTransferEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationFailed, setMigrationFailed] = useState(false);
  const migrationInProgress = useRef(false);
  const openingRequestHandled = useRef(false);
  const migration = useMemo(() => migrateTrades(allStocks, storedTrades), [allStocks, storedTrades]);
  const allTrades = migration.trades;
  const trades = useMemo(() => allTrades.filter((trade) => !trade.deletedAt), [allTrades]);
  const ledger = useMemo(() => buildTradingLedger(trades, accounts), [accounts, trades]);
  const openStockIds = useMemo(() => new Set(ledger.positions.filter((position) => position.quantity > 0).map((position) => position.stockId)), [ledger]);
  const tradableStocks = useMemo(() => projectStocksFromTrades(allStocks, allTrades).filter((stock) => !stock.deletedAt || stock.quantity > 0 || openStockIds.has(stock.id)), [allStocks, allTrades, openStockIds]);
  const editingId = editing && editing !== "new" ? editing.id : null;
  const formLedger = useMemo(() => editingId ? buildTradingLedger(trades.filter((trade) => trade.id !== editingId), accounts) : ledger, [accounts, editingId, ledger, trades]);
  const dataReady = accountsReady && tradesReady && stocksReady && plansReady && rulesReady && !isMigrating && !migrationFailed && migration.initializedStockIds.length === 0;

  useEffect(() => {
    if (!dataReady || openingRequestHandled.current) return;
    openingRequestHandled.current = true;
    const requested = new URLSearchParams(window.location.search).get("openingStockId") ?? "";
    const stock = tradableStocks.find((item) => item.id === requested && item.quantity === 0);
    if (!stock) return;
    const timer = window.setTimeout(() => {
      setOpeningStockId(stock.id);
      setNewTradeType("매수");
      setEditing("new");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dataReady, tradableStocks]);

  useEffect(() => {
    if (!tradesReady || !stocksReady || !plansReady || !rulesReady || !migration.initializedStockIds.length || migrationInProgress.current || migrationFailed) return;
    migrationInProgress.current = true;
    setIsMigrating(true);
    const initializedIds = new Set(migration.initializedStockIds);
    const now = new Date().toISOString();
    const migratedStocks = allStocks.map((stock) => initializedIds.has(stock.id) ? { ...stock, ledgerInitializedAt: now, updatedAt: now } : stock);
    void (async () => {
      try {
        await replaceTradesAsync(migration.trades);
        await replaceStocksAsync(migratedStocks);
      } catch {
        setMigrationFailed(true);
        setMessage("기존 보유 기록을 원장으로 옮기지 못했습니다. 앱을 다시 열어 재시도해 주세요.");
      } finally {
        migrationInProgress.current = false;
        setIsMigrating(false);
      }
    })();
  }, [allStocks, migration.initializedStockIds, migration.trades, migrationFailed, plansReady, replaceStocksAsync, replaceTradesAsync, rulesReady, stocksReady, tradesReady]);

  async function validateAndCommit(next: Trade[], changedId?: string, showInForm = false) {
    const result = await commitTradeMutation({ currentTrades: allTrades, nextTrades: next, accounts, changedId, replaceTrades: replaceTradesAsync });
    if (!result.ok) {
      if (showInForm) setFormError(result.error); else setMessage(result.error);
      return false;
    }
    setMessage("");
    setFormError("");
    setEditing(null);
    return true;
  }

  async function saveTrade(trade: Trade) {
    setFormError("");
    const next = editing === "new" ? [trade, ...allTrades] : allTrades.map((item) => item.id === trade.id ? trade : item);
    const saved = await validateAndCommit(next, trade.id, true);
    if (saved && openingStockId) {
      setOpeningStockId("");
      window.history.replaceState(null, "", "/trades");
      setMessage("기초 포지션을 등록하고 보유 수량과 평균단가를 계산했습니다.");
    }
  }

  function editTrade(trade: Trade) {
    setMessage(""); setFormError("");
    if (trade.cashFlowKind !== "transfer") { setEditing(trade); return; }
    try {
      getTransferPair(allTrades, trade.transferId ?? "");
      setTransferEditingId(trade.transferId ?? null);
      setTransferOpen(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이체 기록이 올바르지 않습니다.");
    }
  }

  async function importCsv(plan: ImportMutationPlan) {
    const saved = await validateAndCommit(plan.nextTrades);
    if (saved) {
      setCsvOpen(false);
      setMessage(`${plan.insertedTrades.length}건의 거래 내역을 추가하고 ${plan.restoredTradeIds.length}건을 복원했습니다.`);
    }
    return saved;
  }

  async function transfer(input: AccountTransferInput) {
    const rate = exchangeRates.snapshot.ratesToKrw[input.currency];
    const next = transferEditingId
      ? updateAccountTransfer(allTrades, accounts, transferEditingId, input).map((trade) => trade.transferId === transferEditingId && !trade.deletedAt ? { ...trade, exchangeRate: rate } : trade)
      : [...buildAccountTransfer(accounts, input).map((trade) => ({ ...trade, exchangeRate: rate })), ...allTrades];
    const saved = await validateAndCommit(next);
    if (saved) { setTransferOpen(false); setTransferEditingId(null); setMessage(transferEditingId ? "계좌 간 이체를 변경했습니다." : "계좌 간 이체를 기록했습니다."); }
    return saved;
  }

  function requestCash(accountId: string, currency: Currency, trigger: HTMLElement) {
    setCashReturnFocus(trigger);
    setCashDialogRequest({ accountId, currency });
  }

  async function saveCash(input: AccountCashBaselineInput) {
    await replaceAccountsAsync(upsertAccountCashBaseline(accounts, input));
  }

  async function deleteTrade(trade: Trade) {
    const subject = trade.stockName || t(trade.tradeType);
    if (!window.confirm(t("{date} {subject} 기록을 삭제할까요? 이후 포지션과 손익이 다시 계산됩니다.", {
      date: safeFormatDate(trade.tradedAt.slice(0, 10), formatDate, { dateStyle: "medium" }),
      subject,
    }))) return;
    const next = buildSoftDeletedTrades(allTrades, trade);
    if (await validateAndCommit(next)) setMessage("기록을 삭제하고 전체 원장을 다시 계산했습니다.");
  }

  const activePositions = ledger.positions.filter((item) => item.quantity > 0);
  const investedKrw = activePositions.reduce((sum, item) => sum + item.investedAmountKrw, 0);
  const ordered = [...trades].sort((a, b) => (Date.parse(b.tradedAt) || 0) - (Date.parse(a.tradedAt) || 0) || b.id.localeCompare(a.id));
  const successMessage = message.includes("추가") || message.includes("등록") || message.includes("삭제") || message.includes("변경") || message.includes("병합") || message.includes("저장");

  return <>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm text-[var(--muted)]">{t("매매·배당·입출금을 시간순으로 재계산")}</p><h1 className="mt-1 text-2xl font-semibold">{t("매매 원장")}</h1></div>
      <div className="flex gap-2">
        <Link href="/accounts" className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm"><RefreshCw size={17} />{t("계좌 관리")}</Link>
        <button disabled={!dataReady || accounts.filter((account) => !account.archivedAt).length < 2} onClick={() => { setTransferEditingId(null); setTransferOpen(true); }} className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm disabled:opacity-50"><ArrowLeftRight size={17} />{t("계좌 간 이체")}</button>
        <button disabled={!dataReady} onClick={() => setCsvOpen(true)} className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm disabled:opacity-50"><FileUp size={17} />{t("파일 가져오기")}</button>
        <button disabled={!dataReady} onClick={() => { setNewTradeType("매수"); setMessage(""); setFormError(""); setEditing("new"); }} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"><Plus size={17} />{t("원장 기록")}</button>
      </div>
    </div>
    {message && <div className={`mt-4 rounded-lg p-3 text-sm ${successMessage ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-200"}`}>{translateTradeText(message, t, formatNumber)}</div>}
    {migration.warnings.length > 0 && <Notice title="기존 보유 수량 확인 필요" lines={migration.warnings} />}
    <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label={t("열린 포지션")} value={t("{count}개", { count: formatNumber(activePositions.length) })} note={t("완료된 사이클 {count}개", { count: formatNumber(ledger.cycles.filter((item) => item.closedAt).length) })} />
      <Metric label={t("보유 투자원금")} value={display(investedKrw)} note={t("거래 당시 환율 · {currency} 표시", { currency: currencyPreference.displayCurrency })} />
      <Metric label={t("누적 순투입액")} value={`${ledger.totalNetTradeCapitalKrw > 0 ? "+" : ""}${display(ledger.totalNetTradeCapitalKrw)}`} note={t("매수 투입액에서 매도 회수액을 뺀 금액")} />
      <Metric label={t("누적 실현손익")} value={`${ledger.totalRealizedKrw >= 0 ? "+" : ""}${display(ledger.totalRealizedKrw)}`} note={t("수수료·세금·거래 환율 반영")} />
    </section>
    <section className="mt-4 overflow-hidden rounded-xl border bg-[var(--surface)]">
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-[var(--surface-muted)] text-xs text-[var(--muted)]"><tr>{["일시", "계좌", "종목/구분", "수량", "가격/금액", "순투입/회수", "실현손익", "포지션", ""].map((head) => <th key={head} className="whitespace-nowrap px-4 py-3 font-medium">{t(head)}</th>)}</tr></thead><tbody>{ordered.map((trade) => <TradeRow key={trade.id} trade={trade} accountName={accounts.find((account) => account.id === trade.accountId)?.name ?? trade.accountName} ledger={ledger} onEdit={() => editTrade(trade)} onDelete={() => void deleteTrade(trade)} />)}</tbody></table></div>
      {!ordered.length && <div className="grid h-44 place-items-center text-sm text-[var(--muted)]">{t("아직 원장 기록이 없습니다.")}</div>}
    </section>
    <AccountCashSummary accounts={accounts} trades={trades} ledger={ledger} onReplaceAccounts={replaceAccountsAsync} />
    {editing && <TradeForm trade={editing === "new" ? undefined : editing} initialType={editing === "new" ? newTradeType : undefined} initialStockId={editing === "new" ? openingStockId || undefined : undefined} openingPosition={editing === "new" && Boolean(openingStockId)} stocks={tradableStocks} plans={plans} rules={rules} ledger={formLedger} accounts={accounts} formError={formError} onRequestCash={requestCash} onCancel={() => { setFormError(""); setOpeningStockId(""); window.history.replaceState(null, "", "/trades"); setEditing(null); }} onSave={saveTrade} />}
    {csvOpen && <CsvImportDialog stocks={tradableStocks} accounts={accounts} existing={allTrades} onCancel={() => setCsvOpen(false)} onImport={importCsv} />}
    {transferOpen && <AccountTransferDialog accounts={accounts} pair={transferEditingId ? getTransferPair(allTrades, transferEditingId) : undefined} onRequestCash={requestCash} onClose={() => { setTransferOpen(false); setTransferEditingId(null); }} onSave={transfer} />}
    {cashDialogRequest && <AccountCashBaselineDialog accounts={accounts} initialAccountId={cashDialogRequest.accountId} initialCurrency={cashDialogRequest.currency} returnFocus={cashReturnFocus} onClose={() => setCashDialogRequest(null)} onSave={saveCash} onSaved={() => setMessage("현재 현금을 저장했습니다.")} />}
  </>;
}

export function AccountTransferDialog({accounts,pair,onRequestCash,onClose,onSave}:{accounts:InvestmentAccount[];pair?:ReturnType<typeof getTransferPair>;onRequestCash:(accountId:string,currency:Currency,trigger:HTMLElement)=>void;onClose:()=>void;onSave:(input:AccountTransferInput)=>Promise<boolean>}) {
  const {t}=useI18n(); const active=accounts.filter(account=>!account.archivedAt); const [source,setSource]=useState(pair?.outgoing.accountId??active.find(a=>a.isDefault)?.id??active[0]?.id??""); const [target,setTarget]=useState(pair?.incoming.accountId??active.find(a=>a.id!==source)?.id??""); const [amount,setAmount]=useState(pair?.outgoing.amount??0); const [currency,setCurrency]=useState<Currency>(pair?.outgoing.currency??"KRW"); const [tradedAt,setTradedAt]=useState(localDateTimeValue(pair ? new Date(pair.outgoing.tradedAt) : undefined)); const [memo,setMemo]=useState(pair?.outgoing.memo??""); const [saving,setSaving]=useState(false); const saveButton=useRef<HTMLButtonElement>(null);
  const sourceAccount=active.find(account=>account.id===source); const targetAccount=active.find(account=>account.id===target); const sourceMissing=Boolean(sourceAccount&&!hasCashBaseline(sourceAccount,currency)); const targetMissing=Boolean(targetAccount&&!hasCashBaseline(targetAccount,currency));
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="transfer-title"><form className="w-full max-w-md rounded-xl bg-[var(--surface)] p-5" onSubmit={e=>{e.preventDefault();if(sourceMissing||targetMissing)return;setSaving(true);void onSave({sourceAccountId:source,targetAccountId:target,amount,currency,tradedAt:new Date(tradedAt).toISOString(),memo}).finally(()=>setSaving(false));}}><h2 id="transfer-title" className="text-lg font-semibold">{t(pair ? "이체 수정" : "계좌 간 이체")}</h2><label className="mt-4 block text-sm">{t("보내는 계좌")}<select className="mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3" value={source} onChange={e=>setSource(e.target.value)}>{active.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label className="mt-3 block text-sm">{t("받는 계좌")}<select className="mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3" value={target} onChange={e=>setTarget(e.target.value)}>{active.filter(a=>a.id!==source).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label className="mt-3 block text-sm">{t("금액")}<input required type="number" min="0" step="any" value={amount} onChange={e=>setAmount(Number(e.target.value))} className="mt-1 h-10 w-full rounded-lg border px-3"/></label><label className="mt-3 block text-sm">{t("통화")}<select value={currency} onChange={e=>setCurrency(e.target.value as Currency)} className="mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3">{currencies.map(c=><option key={c}>{c}</option>)}</select></label>{(sourceMissing||targetMissing)&&<div role="alert" className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><p>{t("계좌 간 이체에는 양쪽 계좌의 현재 현금이 필요합니다.")}</p><div className="mt-2 flex flex-wrap gap-2">{sourceMissing&&sourceAccount&&<button type="button" onClick={event=>onRequestCash(sourceAccount.id,currency,saveButton.current??event.currentTarget)} className="rounded-md border px-2 py-1 text-xs">{t("보내는 계좌 현재 현금 입력")}</button>}{targetMissing&&targetAccount&&<button type="button" onClick={event=>onRequestCash(targetAccount.id,currency,saveButton.current??event.currentTarget)} className="rounded-md border px-2 py-1 text-xs">{t("받는 계좌 현재 현금 입력")}</button>}</div></div>}<label className="mt-3 block text-sm">{t("일시")}<input required type="datetime-local" step="1" value={tradedAt} onChange={e=>setTradedAt(e.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3"/></label><label className="mt-3 block text-sm">{t("메모")}<input value={memo} onChange={e=>setMemo(e.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3"/></label><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button ref={saveButton} disabled={saving||source===target||amount<=0||!tradedAt||sourceMissing||targetMissing} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50">{t("이체 저장")}</button></div></form></div>;
}

export function TradeRow({ trade, accountName, ledger, onEdit, onDelete }: { trade: Trade; accountName: string; ledger: ReturnType<typeof buildTradingLedger>; onEdit: () => void; onDelete: () => void }) {
  const { t, formatDate, formatNumber } = useI18n();
  const calculation = ledger.calculations[trade.id];
  const cycle = ledger.cycles.find((item) => item.id === calculation?.positionCycleId);
  const money = (value: number) => formatNumber(value, {
    style: "currency",
    currency: trade.currency,
    minimumFractionDigits: trade.currency === "KRW" || trade.currency === "JPY" ? 0 : 2,
    maximumFractionDigits: trade.currency === "KRW" || trade.currency === "JPY" ? 0 : 2,
  });
  return <tr className="border-t hover:bg-[var(--surface-muted)]">
    <td className="whitespace-nowrap px-4 py-4">{safeFormatDate(trade.tradedAt, formatDate, { dateStyle: "medium", timeStyle: "short" })}</td>
    <td className="whitespace-nowrap px-4">{displayTradeSystemText(accountName, t)}</td>
    <td className="px-4"><b>{trade.stockName || t(trade.tradeType)}</b><small className="block text-[var(--muted)]">{trade.isOpeningPosition ? t("기초 포지션") : t(trade.tradeType)}{journalStatusOf(trade) === "unreviewed" && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200">{t("검토 필요")}</span>}</small></td>
    <td className="px-4 text-right tabular-nums">{trade.quantity ? formatNumber(trade.quantity) : "—"}</td>
    <td className="px-4 text-right tabular-nums">{money(tradeAmount(trade))}</td>
    <td className="px-4 text-right tabular-nums">{calculation?.capitalEffect == null ? "—" : <span className={calculation.capitalEffect < 0 ? "text-blue-700 dark:text-blue-300" : ""}>{`${calculation.capitalEffect > 0 ? "+" : ""}${money(calculation.capitalEffect)}`}</span>}{calculation?.cashEffect != null && <small className="block text-[var(--muted)]">{t("현금 {amount}", { amount: `${calculation.cashEffect > 0 ? "+" : ""}${money(calculation.cashEffect)}` })}</small>}</td>
    <td className={`px-4 text-right tabular-nums ${calculation?.realizedProfit ? calculation.realizedProfit > 0 ? "text-emerald-600" : "text-red-600" : ""}`}>{calculation?.realizedProfit ? `${calculation.realizedProfit > 0 ? "+" : ""}${money(calculation.realizedProfit)}` : "—"}</td>
    <td className="whitespace-nowrap px-4">{cycle ? `${cycle.stockName} #${formatNumber(cycle.sequence)}` : "—"}{calculation?.error && <small className="block text-red-600">{translateTradeText(calculation.error, t, formatNumber)}</small>}</td>
    <td className="px-4"><div className="flex"><button aria-label={t("기록 수정")} onClick={onEdit} className="grid size-8 place-items-center"><Pencil size={15} /></button>{!trade.isOpeningPosition && <button aria-label={t("기록 삭제")} onClick={onDelete} className="destructive-icon-action grid size-8 place-items-center rounded-md"><Trash2 size={15} /></button>}</div></td>
  </tr>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="rounded-xl border bg-[var(--surface)] p-5"><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-3 text-xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-[var(--muted)]">{note}</p></article>;
}

function Notice({ title, lines }: { title: string; lines: string[] }) {
  const { t, formatNumber } = useI18n();
  return <div className="mt-4 flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><div><p className="font-semibold">{t(title)}</p>{lines.map((line) => <p key={line} className="mt-1">{translateTradeText(line, t, formatNumber)}</p>)}</div></div>;
}

function safeFormatDate(value: string, formatter: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string, options: Intl.DateTimeFormatOptions) {
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value.replace("T", " ").slice(0, 16) : formatter(date, options);
}
