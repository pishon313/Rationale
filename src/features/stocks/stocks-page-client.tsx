"use client";

import Link from "next/link";
import { Plus, RefreshCw, WalletCards, WifiOff } from "lucide-react";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "@/i18n/i18n-provider";
import { isTauriApp } from "@/lib/local-repository";
import type { Stock } from "./types";
import { StockForm } from "./stock-form";
import { StockTable } from "./stock-table";
import { useStockStore } from "./use-stock-store";
import { applyQuote, planQuoteRequests, validateQuote, type MarketQuote } from "./market-data";

export function StocksPageClient() {
  const { t, formatNumber } = useI18n();
  const { stocks, storedTrades, accountHoldingsByStockId, addStock, updateStock, updateStocksAsync, correctStockCurrency, deleteStock } = useStockStore();
  const [editing, setEditing] = useState<Stock | null | "new">(null);
  const [deleting, setDeleting] = useState<Stock | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [quoteMessage, setQuoteMessage] = useState("");
  async function refreshQuotes() {
    if (!navigator.onLine) { setQuoteMessage(t("인터넷 연결 없음 — 마지막 저장 가격을 표시합니다.")); return; }
    if (!isTauriApp()) { setQuoteMessage(t("자동 시세 갱신은 Mac 앱에서 사용할 수 있습니다.")); return; }
    setRefreshing(true); let success = 0; const failures: string[] = []; const updates = new Map<string, Stock>(); const rateLimited = new Set<string>();
    for (const stock of stocks) {
      const requests = planQuoteRequests(stock); if (!requests.length) continue; let lastError: unknown;
      for (const [index, request] of requests.entries()) { if (rateLimited.has(request.provider)) continue; try { const quote = validateQuote(stock, request, await invoke<MarketQuote>("fetch_market_quote", { request })); updates.set(stock.id, applyQuote(stock, quote)); success++; lastError = null; break; } catch (error) { lastError = error; const code = String(error); if (code.includes("RATE_LIMITED")) rateLimited.add(request.provider); if (index === requests.length - 1 || !["API_KEY_MISSING", "PROVIDER_ENTITLEMENT_REQUIRED", "SYMBOL_NOT_FOUND", "RATE_LIMITED"].some((allowed) => code.includes(allowed))) break; } }
      if (lastError) failures.push(`${stock.name}: ${quoteErrorMessage(String(lastError), t)}`);
    }
    if (updates.size) await updateStocksAsync(updates);
    setRefreshing(false);
    setQuoteMessage(failures.length
      ? `${t("{success}개 갱신 · {failure}", { success: formatNumber(success), failure: failures[0] })}${failures.length > 1 ? t(" 외 {count}건", { count: formatNumber(failures.length - 1) }) : ""}`
      : t("{success}개 종목의 가격을 갱신했습니다.", { success: formatNumber(success) }));
  }
  return <><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-[var(--muted)]">{t("투자 아이디어와 보유 자산")}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{t("종목")}</h1></div><div className="flex flex-wrap gap-2"><Link href="/trades" className="flex items-center gap-2 rounded-lg border bg-[var(--surface)] px-4 py-2.5 text-sm text-[var(--muted)]"><WalletCards size={16} />{t("매매 원장")}</Link><button disabled={refreshing} onClick={() => void refreshQuotes()} className="flex items-center gap-2 rounded-lg border bg-[var(--surface)] px-4 py-2.5 text-sm"><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />{t(refreshing ? "갱신 중" : "현재가 갱신")}</button><button onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white"><Plus size={17} />{t("종목 추가")}</button></div></div>{quoteMessage && <div className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--surface)] p-3 text-sm text-[var(--muted)]"><WifiOff size={16} />{quoteMessage}</div>}<section className="mt-6 overflow-hidden rounded-xl border bg-[var(--surface)]"><StockTable stocks={stocks} accountHoldingsByStockId={accountHoldingsByStockId} onEdit={setEditing} onDelete={setDeleting} /></section>{editing && <StockForm stock={editing === "new" ? undefined : editing} holdings={editing === "new" ? [] : accountHoldingsByStockId.get(editing.id) ?? []} trades={editing === "new" ? [] : storedTrades.filter((trade) => trade.stockId === editing.id)} onCancel={() => setEditing(null)} onSave={async (stock) => { if (editing === "new") addStock(stock); else if (editing.currency !== stock.currency) await correctStockCurrency(stock); else updateStock(stock); setEditing(null); }} />}{deleting && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="alertdialog" aria-modal="true"><div className="w-full max-w-sm rounded-xl bg-[var(--surface)] p-5 shadow-2xl"><h2 className="text-lg font-semibold">{t("{name}을(를) 삭제할까요?", { name: deleting.name })}</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("관련 계획과 매매가 생길 수 있으므로 실제 데이터는 남기고 목록에서 숨기는 방식으로 처리합니다.")}</p><div className="mt-5 flex justify-end gap-2"><button onClick={() => setDeleting(null)} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button onClick={() => { if (!deleteStock(deleting.id)) setQuoteMessage(t("보유 수량이 남은 종목은 삭제할 수 없습니다. 먼저 매매 원장에서 포지션을 정리해 주세요.")); setDeleting(null); }} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white">{t("삭제")}</button></div></div></div>}</>;
}

function quoteErrorMessage(error: string, translate: (key: string) => string) {
  if (error.includes("API_KEY_MISSING")) return translate("설정에서 API 키를 입력해 주세요");
  if (error.includes("NETWORK_TIMEOUT")) return translate("요청 시간이 초과됐습니다");
  if (error.includes("NETWORK_ERROR")) return translate("인터넷 연결을 확인해 주세요");
  if (error.includes("PROVIDER_ERROR")) return error.split("PROVIDER_ERROR:")[1] ?? translate("제공자 오류");
  return translate("가격을 가져오지 못했습니다");
}
