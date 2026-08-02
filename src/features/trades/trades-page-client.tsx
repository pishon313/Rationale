"use client";

import { AlertTriangle, FileUp, Pencil, Plus, Trash2, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fromKrw } from "@/domain/currency";
import { buildTradingLedger, cashBalanceKrw, normalizeTrade, tradeAmount } from "@/domain/trading-ledger";
import { samplePlans } from "@/features/plans/sample-data";
import type { BuyPlan } from "@/features/plans/types";
import { sampleRules } from "@/features/rules/sample-data";
import type { InvestmentRule } from "@/features/rules/types";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { Stock } from "@/features/stocks/types";
import { useI18n } from "@/i18n/i18n-provider";
import { useLocalCollection } from "@/lib/use-local-collection";
import { useCurrencyPreference, useExchangeRates } from "@/lib/use-exchange-rates";
import { CsvImportDialog } from "./csv-import-dialog";
import { migrateTrades, projectStocksFromTrades } from "./migrate-trades";
import { sampleTrades } from "./sample-data";
import { TradeForm } from "./trade-form";
import { displayTradeSystemText, translateTradeText } from "./trade-i18n";
import type { Trade } from "./types";

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
  const { allItems: storedTrades, ready: tradesReady, replaceAsync: replaceTradesAsync } = useLocalCollection<Trade>("trades", sampleTrades);
  const { allItems: allStocks, ready: stocksReady, replaceAsync: replaceStocksAsync } = useLocalCollection<Stock>("stocks", sampleStocks);
  const { items: plans, ready: plansReady } = useLocalCollection<BuyPlan>("plans", samplePlans);
  const { items: rules, ready: rulesReady } = useLocalCollection<InvestmentRule>("rules", sampleRules);
  const [editing, setEditing] = useState<Trade | "new" | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrationFailed, setMigrationFailed] = useState(false);
  const migrationInProgress = useRef(false);
  const migration = useMemo(() => migrateTrades(allStocks, storedTrades), [allStocks, storedTrades]);
  const allTrades = migration.trades;
  const trades = useMemo(() => allTrades.filter((trade) => !trade.deletedAt), [allTrades]);
  const ledger = useMemo(() => buildTradingLedger(trades), [trades]);
  const openStockIds = useMemo(() => new Set(ledger.positions.filter((position) => position.quantity > 0).map((position) => position.stockId)), [ledger]);
  const tradableStocks = useMemo(() => projectStocksFromTrades(allStocks, allTrades).filter((stock) => !stock.deletedAt || stock.quantity > 0 || openStockIds.has(stock.id)), [allStocks, allTrades, openStockIds]);
  const editingId = editing && editing !== "new" ? editing.id : null;
  const formLedger = useMemo(() => editingId ? buildTradingLedger(trades.filter((trade) => trade.id !== editingId)) : ledger, [editingId, ledger, trades]);
  const dataReady = tradesReady && stocksReady && plansReady && rulesReady && !isMigrating && !migrationFailed && migration.initializedStockIds.length === 0;

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
    const candidate = buildTradingLedger(next);
    const direct = changedId ? candidate.calculations[changedId]?.error : null;
    const previous = new Set(ledger.errors.map((item) => `${item.tradeId}:${item.message}`));
    const introduced = candidate.errors.find((item) => !previous.has(`${item.tradeId}:${item.message}`));
    const validationError = direct || (introduced ? `${introduced.tradeId}: ${introduced.message}` : "");
    if (validationError) {
      if (showInForm) setFormError(validationError);
      else setMessage(validationError);
      return false;
    }
    try {
      await replaceTradesAsync(next.map(normalizeTrade));
      setMessage("");
      setFormError("");
      setEditing(null);
      return true;
    } catch {
      const error = "원장 기록을 저장하지 못했습니다. 다시 시도해 주세요.";
      if (showInForm) setFormError(error);
      else setMessage(error);
      return false;
    }
  }

  async function saveTrade(trade: Trade) {
    setFormError("");
    const next = editing === "new" ? [trade, ...allTrades] : allTrades.map((item) => item.id === trade.id ? trade : item);
    await validateAndCommit(next, trade.id, true);
  }

  async function importCsv(imported: Trade[]) {
    const saved = await validateAndCommit([...imported, ...allTrades]);
    if (saved) {
      setCsvOpen(false);
      setMessage(`${imported.length}건의 거래 내역을 원장에 추가했습니다.`);
    }
    return saved;
  }

  async function deleteTrade(trade: Trade) {
    const subject = trade.stockName || t(trade.tradeType);
    if (!window.confirm(t("{date} {subject} 기록을 삭제할까요? 이후 포지션과 손익이 다시 계산됩니다.", {
      date: safeFormatDate(trade.tradedAt.slice(0, 10), formatDate, { dateStyle: "medium" }),
      subject,
    }))) return;
    const next = allTrades.map((item) => item.id === trade.id ? { ...item, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : item);
    if (await validateAndCommit(next)) setMessage("기록을 삭제하고 전체 원장을 다시 계산했습니다.");
  }

  const activePositions = ledger.positions.filter((item) => item.quantity > 0);
  const investedKrw = activePositions.reduce((sum, item) => sum + item.investedAmountKrw, 0);
  const ordered = [...trades].sort((a, b) => (Date.parse(b.tradedAt) || 0) - (Date.parse(a.tradedAt) || 0) || b.id.localeCompare(a.id));
  const negativeUnreconciled = ledger.cashBalances.some((item) => !item.isReconciled);
  const successMessage = message.includes("추가") || message.includes("삭제");
  const rateDate = exchangeRates.snapshot.rateDate
    ? safeFormatDate(exchangeRates.snapshot.rateDate, formatDate, { dateStyle: "medium" })
    : t("기본값");

  return <>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-sm text-[var(--muted)]">{t("매매·배당·입출금을 시간순으로 재계산")}</p><h1 className="mt-1 text-2xl font-semibold">{t("매매 원장")}</h1></div>
      <div className="flex gap-2">
        <button disabled={!dataReady} onClick={() => setCsvOpen(true)} className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm disabled:opacity-50"><FileUp size={17} />{t("파일 가져오기")}</button>
        <button disabled={!dataReady} onClick={() => { setMessage(""); setFormError(""); setEditing("new"); }} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"><Plus size={17} />{t("원장 기록")}</button>
      </div>
    </div>
    {message && <div className={`mt-4 rounded-lg p-3 text-sm ${successMessage ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-200"}`}>{translateTradeText(message, t, formatNumber)}</div>}
    {migration.warnings.length > 0 && <Notice title="기존 보유 수량 확인 필요" lines={migration.warnings} />}
    {negativeUnreconciled && <Notice title="기초 현금이 등록되지 않은 계좌가 있습니다" lines={["표시된 현금은 현재 기록의 순현금흐름입니다. 실제 잔액을 맞추려면 가장 오래된 날짜로 입금 기록을 추가하세요."]} />}
    <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label={t("열린 포지션")} value={t("{count}개", { count: formatNumber(activePositions.length) })} note={t("완료된 사이클 {count}개", { count: formatNumber(ledger.cycles.filter((item) => item.closedAt).length) })} />
      <Metric label={t("보유 투자원금")} value={display(investedKrw)} note={t("거래 당시 환율 · {currency} 표시", { currency: currencyPreference.displayCurrency })} />
      <Metric label={t("누적 실현손익")} value={`${ledger.totalRealizedKrw >= 0 ? "+" : ""}${display(ledger.totalRealizedKrw)}`} note={t("수수료·세금·거래 환율 반영")} />
      <Metric label={t("기록 현금 환산")} value={display(cashBalanceKrw(ledger, exchangeRates.snapshot.ratesToKrw))} note={t("환율 {date} 기준", { date: rateDate })} />
    </section>
    <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5">
      <div className="flex items-center gap-2"><WalletCards size={18} className="text-[var(--accent)]" /><h2 className="font-semibold">{t("계좌별 현금")}</h2></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ledger.cashBalances.map((item) => <div key={`${item.accountName}-${item.currency}`} className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">{displayTradeSystemText(item.accountName, t)} · {item.currency}</p><p className="mt-1 font-semibold tabular-nums">{money(item.balance, item.currency)}</p><p className="mt-1 text-[11px] text-[var(--muted)]">{item.isReconciled ? t("입금 기록 기준") : t("순현금흐름 · 조정 필요")}</p></div>)}
        {!ledger.cashBalances.length && <p className="text-sm text-[var(--muted)]">{t("입출금 또는 매매 기록이 없습니다.")}</p>}
      </div>
    </section>
    <section className="mt-4 overflow-hidden rounded-xl border bg-[var(--surface)]">
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-[var(--surface-muted)] text-xs text-[var(--muted)]"><tr>{["일시", "계좌", "종목/구분", "수량", "가격/금액", "현금 변동", "실현손익", "포지션", ""].map((head) => <th key={head} className="whitespace-nowrap px-4 py-3 font-medium">{t(head)}</th>)}</tr></thead><tbody>{ordered.map((trade) => <TradeRow key={trade.id} trade={trade} ledger={ledger} onEdit={() => { setMessage(""); setFormError(""); setEditing(trade); }} onDelete={() => void deleteTrade(trade)} />)}</tbody></table></div>
      {!ordered.length && <div className="grid h-44 place-items-center text-sm text-[var(--muted)]">{t("아직 원장 기록이 없습니다.")}</div>}
    </section>
    {editing && <TradeForm trade={editing === "new" ? undefined : editing} stocks={tradableStocks} plans={plans} rules={rules} ledger={formLedger} formError={formError} onCancel={() => { setFormError(""); setEditing(null); }} onSave={saveTrade} />}
    {csvOpen && <CsvImportDialog stocks={tradableStocks} existing={allTrades} onCancel={() => setCsvOpen(false)} onImport={importCsv} />}
  </>;
}

function TradeRow({ trade, ledger, onEdit, onDelete }: { trade: Trade; ledger: ReturnType<typeof buildTradingLedger>; onEdit: () => void; onDelete: () => void }) {
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
    <td className="whitespace-nowrap px-4">{displayTradeSystemText(trade.accountName, t)}</td>
    <td className="px-4"><b>{trade.stockName || t(trade.tradeType)}</b><small className="block text-[var(--muted)]">{trade.isOpeningPosition ? t("기초 포지션") : t(trade.tradeType)}{trade.memo ? ` · ${displayTradeSystemText(trade.memo, t)}` : ""}</small></td>
    <td className="px-4 text-right tabular-nums">{trade.quantity ? formatNumber(trade.quantity) : "—"}</td>
    <td className="px-4 text-right tabular-nums">{money(tradeAmount(trade))}</td>
    <td className="px-4 text-right tabular-nums">{calculation ? `${calculation.cashEffect > 0 ? "+" : ""}${money(calculation.cashEffect)}` : "—"}</td>
    <td className={`px-4 text-right tabular-nums ${calculation?.realizedProfit ? calculation.realizedProfit > 0 ? "text-emerald-600" : "text-red-600" : ""}`}>{calculation?.realizedProfit ? `${calculation.realizedProfit > 0 ? "+" : ""}${money(calculation.realizedProfit)}` : "—"}</td>
    <td className="whitespace-nowrap px-4">{cycle ? `${cycle.stockName} #${formatNumber(cycle.sequence)}` : "—"}{calculation?.error && <small className="block text-red-600">{translateTradeText(calculation.error, t, formatNumber)}</small>}</td>
    <td className="px-4"><div className="flex"><button aria-label={t("기록 수정")} onClick={onEdit} className="grid size-8 place-items-center"><Pencil size={15} /></button>{!trade.isOpeningPosition && <button aria-label={t("기록 삭제")} onClick={onDelete} className="grid size-8 place-items-center text-red-600"><Trash2 size={15} /></button>}</div></td>
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
