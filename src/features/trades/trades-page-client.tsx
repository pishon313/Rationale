"use client";
import { AlertTriangle, Pencil, Plus, Trash2, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildTradingLedger, cashBalanceKrw, normalizeTrade, tradeAmount } from "@/domain/trading-ledger";
import { formatCurrency } from "@/domain/money";
import { useLocalCollection } from "@/lib/use-local-collection";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { Stock } from "@/features/stocks/types";
import { samplePlans } from "@/features/plans/sample-data";
import type { BuyPlan } from "@/features/plans/types";
import { sampleRules } from "@/features/rules/sample-data";
import type { InvestmentRule } from "@/features/rules/types";
import { sampleTrades } from "./sample-data";
import type { Trade } from "./types";
import { migrateTrades, projectStocksFromTrades } from "./migrate-trades";
import { TradeForm } from "./trade-form";

export function TradesPageClient() {
  const { allItems: storedTrades, ready: tradesReady, replaceAsync: replaceTradesAsync } = useLocalCollection<Trade>("trades", sampleTrades);
  const { allItems: allStocks, ready: stocksReady, replaceAsync: replaceStocksAsync } = useLocalCollection<Stock>("stocks", sampleStocks);
  const { items: plans, ready: plansReady } = useLocalCollection<BuyPlan>("plans", samplePlans);
  const { items: rules, ready: rulesReady } = useLocalCollection<InvestmentRule>("rules", sampleRules);
  const [editing, setEditing] = useState<Trade | "new" | null>(null);
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
      if (showInForm) setFormError(validationError); else setMessage(validationError);
      return false;
    }
    try {
      await replaceTradesAsync(next.map(normalizeTrade));
      setMessage(""); setFormError(""); setEditing(null); return true;
    } catch {
      const saveError = "원장 기록을 저장하지 못했습니다. 다시 시도해 주세요.";
      if (showInForm) setFormError(saveError); else setMessage(saveError);
      return false;
    }
  }
  async function saveTrade(trade: Trade) { setFormError(""); const next = editing === "new" ? [trade, ...allTrades] : allTrades.map((item) => item.id === trade.id ? trade : item); await validateAndCommit(next, trade.id, true); }
  async function deleteTrade(trade: Trade) { if (!window.confirm(`${trade.tradedAt.slice(0, 10)} ${trade.stockName || trade.tradeType} 기록을 삭제할까요? 이후 포지션과 손익이 다시 계산됩니다.`)) return; const next = allTrades.map((item) => item.id === trade.id ? { ...item, deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : item); if (await validateAndCommit(next)) setMessage("기록을 삭제하고 전체 원장을 다시 계산했습니다."); }
  function openNew() { setMessage(""); setFormError(""); setEditing("new"); }
  function openEdit(trade: Trade) { setMessage(""); setFormError(""); setEditing(trade); }
  function closeForm() { setFormError(""); setEditing(null); }
  const activePositions = ledger.positions.filter((item) => item.quantity > 0); const investedKrw = activePositions.reduce((sum, item) => sum + item.investedAmountKrw, 0);
  const ordered = [...trades].filter((trade) => !trade.deletedAt).sort((a, b) => (Date.parse(b.tradedAt) || 0) - (Date.parse(a.tradedAt) || 0) || b.id.localeCompare(a.id));
  const negativeUnreconciled = ledger.cashBalances.some((item) => !item.isReconciled);

  return <><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-[var(--muted)]">매매·배당·입출금을 시간순으로 재계산</p><h1 className="mt-1 text-2xl font-semibold">매매 원장</h1></div><button disabled={!dataReady} onClick={openNew} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"><Plus size={17} />원장 기록</button></div>{message && <div className={`mt-4 rounded-lg p-3 text-sm ${message.includes("삭제") ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-200"}`}>{message}</div>}{migration.warnings.length > 0 && <Notice title="기존 보유 수량 확인 필요" lines={migration.warnings} />}{negativeUnreconciled && <Notice title="기초 현금이 등록되지 않은 계좌가 있습니다" lines={["표시된 현금은 현재 기록의 순현금흐름입니다. 실제 잔액을 맞추려면 가장 오래된 날짜로 입금 기록을 추가하세요."]} />}<section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="열린 포지션" value={`${activePositions.length}개`} note={`완료된 사이클 ${ledger.cycles.filter((item) => item.closedAt).length}개`} /><Metric label="보유 투자원금" value={formatCurrency(investedKrw, "KRW")} note="거래 당시 환율 기준" /><Metric label="누적 실현손익" value={`${ledger.totalRealizedKrw >= 0 ? "+" : ""}${formatCurrency(ledger.totalRealizedKrw, "KRW")}`} note="수수료·세금·환율 반영" /><Metric label="기록 현금 환산" value={formatCurrency(cashBalanceKrw(ledger), "KRW")} note="USD 1,380원 참고 환산" /></section><section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center gap-2"><WalletCards size={18} className="text-[var(--accent)]" /><h2 className="font-semibold">계좌별 현금</h2></div><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{ledger.cashBalances.map((item) => <div key={`${item.accountName}-${item.currency}`} className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--muted)]">{item.accountName} · {item.currency}</p><p className="mt-1 font-semibold tabular-nums">{formatCurrency(item.balance, item.currency)}</p><p className="mt-1 text-[11px] text-[var(--muted)]">{item.isReconciled ? "입금 기록 기준" : "순현금흐름 · 조정 필요"}</p></div>)}{!ledger.cashBalances.length && <p className="text-sm text-[var(--muted)]">입출금 또는 매매 기록이 없습니다.</p>}</div></section><section className="mt-4 overflow-hidden rounded-xl border bg-[var(--surface)]"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-[var(--surface-muted)] text-xs text-[var(--muted)]"><tr>{["일시", "계좌", "종목/구분", "수량", "가격/금액", "현금 변동", "실현손익", "포지션", ""].map((head) => <th key={head} className="whitespace-nowrap px-4 py-3 font-medium">{head}</th>)}</tr></thead><tbody>{ordered.map((trade) => { const calculation = ledger.calculations[trade.id]; const cycle = ledger.cycles.find((item) => item.id === calculation?.positionCycleId); return <tr key={trade.id} className="border-t hover:bg-[var(--surface-muted)]"><td className="whitespace-nowrap px-4 py-4">{trade.tradedAt.replace("T", " ").slice(0, 16)}</td><td className="whitespace-nowrap px-4">{trade.accountName}</td><td className="px-4"><b>{trade.stockName || trade.tradeType}</b><small className="block text-[var(--muted)]">{trade.isOpeningPosition ? "기초 포지션" : trade.tradeType}{trade.memo ? ` · ${trade.memo}` : ""}</small></td><td className="px-4 text-right tabular-nums">{trade.quantity || "—"}</td><td className="px-4 text-right tabular-nums">{formatCurrency(tradeAmount(trade), trade.currency)}</td><td className="px-4 text-right tabular-nums">{calculation ? `${calculation.cashEffect > 0 ? "+" : ""}${formatCurrency(calculation.cashEffect, trade.currency)}` : "—"}</td><td className={`px-4 text-right tabular-nums ${calculation?.realizedProfit ? calculation.realizedProfit > 0 ? "text-emerald-600" : "text-red-600" : ""}`}>{calculation?.realizedProfit ? `${calculation.realizedProfit > 0 ? "+" : ""}${formatCurrency(calculation.realizedProfit, trade.currency)}` : "—"}</td><td className="whitespace-nowrap px-4">{cycle ? `${cycle.stockName} #${cycle.sequence}` : "—"}{calculation?.error && <small className="block text-red-600">{calculation.error}</small>}</td><td className="px-4"><div className="flex"><button aria-label="기록 수정" onClick={() => openEdit(trade)} className="grid size-8 place-items-center"><Pencil size={15} /></button>{!trade.isOpeningPosition && <button aria-label="기록 삭제" onClick={() => deleteTrade(trade)} className="grid size-8 place-items-center text-red-600"><Trash2 size={15} /></button>}</div></td></tr>; })}</tbody></table></div>{!ordered.length && <div className="grid h-44 place-items-center text-sm text-[var(--muted)]">아직 원장 기록이 없습니다.</div>}</section>{editing && <TradeForm trade={editing === "new" ? undefined : editing} stocks={tradableStocks} plans={plans} rules={rules} ledger={formLedger} formError={formError} onCancel={closeForm} onSave={saveTrade} />}</>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <article className="rounded-xl border bg-[var(--surface)] p-5"><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-3 text-xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-xs text-[var(--muted)]">{note}</p></article>; }
function Notice({ title, lines }: { title: string; lines: string[] }) { return <div className="mt-4 flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><AlertTriangle size={18} className="mt-0.5 shrink-0" /><div><p className="font-semibold">{title}</p>{lines.map((line) => <p key={line} className="mt-1">{line}</p>)}</div></div>; }
