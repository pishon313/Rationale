"use client";

import { Plus, RefreshCw, WifiOff } from "lucide-react";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauriApp } from "@/lib/local-repository";
import type { Stock } from "./types";
import { StockForm } from "./stock-form";
import { StockTable } from "./stock-table";
import { useStockStore } from "./use-stock-store";

export function StocksPageClient() {
  const { stocks, addStock, updateStock, deleteStock } = useStockStore();
  const [editing, setEditing] = useState<Stock | null | "new">(null);
  const [deleting, setDeleting] = useState<Stock | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [quoteMessage, setQuoteMessage] = useState("");
  async function refreshQuotes() {
    if (!navigator.onLine) { stocks.forEach((stock) => updateStock({ ...stock, priceStatus: "offline" })); setQuoteMessage("인터넷 연결 없음 — 마지막 저장 가격을 표시합니다."); return; }
    if (!isTauriApp()) { setQuoteMessage("자동 시세 갱신은 Mac 앱에서 사용할 수 있습니다."); return; }
    setRefreshing(true); let success = 0; const failures: string[] = [];
    for (const stock of stocks) {
      try {
        const quote = await invoke<{ price: number; currency: string; exchange: string; quotedAt: string; isMarketOpen: boolean | null; source: string }>("fetch_quote", { symbol: stock.ticker, market: stock.market });
        updateStock({ ...stock, currentPrice: quote.price, priceUpdatedAt: new Date().toISOString(), priceQuotedAt: quote.quotedAt || null, priceSource: "twelve-data", priceStatus: "online", updatedAt: new Date().toISOString() }); success++;
      } catch (error) { failures.push(`${stock.name}: ${quoteErrorMessage(String(error))}`); }
    }
    setRefreshing(false); setQuoteMessage(failures.length ? `${success}개 갱신 · ${failures[0]}${failures.length > 1 ? ` 외 ${failures.length - 1}건` : ""}` : `${success}개 종목의 가격을 갱신했습니다.`);
  }
  return <><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm text-[var(--muted)]">투자 아이디어와 보유 자산</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">종목</h1></div><div className="flex gap-2"><button disabled={refreshing} onClick={() => void refreshQuotes()} className="flex items-center gap-2 rounded-lg border bg-[var(--surface)] px-4 py-2.5 text-sm"><RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />{refreshing ? "갱신 중" : "현재가 갱신"}</button><button onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white"><Plus size={17} />종목 추가</button></div></div>{quoteMessage && <div className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--surface)] p-3 text-sm text-[var(--muted)]"><WifiOff size={16} />{quoteMessage}</div>}<section className="mt-6 overflow-hidden rounded-xl border bg-[var(--surface)]"><StockTable stocks={stocks} onEdit={setEditing} onDelete={setDeleting} /></section>{editing && <StockForm stock={editing === "new" ? undefined : editing} onCancel={() => setEditing(null)} onSave={(stock) => { if (editing === "new") addStock(stock); else updateStock(stock); setEditing(null); }} />}{deleting && <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="alertdialog" aria-modal="true"><div className="w-full max-w-sm rounded-xl bg-[var(--surface)] p-5 shadow-2xl"><h2 className="text-lg font-semibold">{deleting.name}을(를) 삭제할까요?</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">관련 계획과 매매가 생길 수 있으므로 실제 데이터는 남기고 목록에서 숨기는 방식으로 처리합니다.</p><div className="mt-5 flex justify-end gap-2"><button onClick={() => setDeleting(null)} className="rounded-lg border px-4 py-2 text-sm">취소</button><button onClick={() => { deleteStock(deleting.id); setDeleting(null); }} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white">삭제</button></div></div></div>}</>;
}

function quoteErrorMessage(error: string) {
  if (error.includes("API_KEY_MISSING")) return "설정에서 API 키를 입력해 주세요";
  if (error.includes("NETWORK_TIMEOUT")) return "요청 시간이 초과됐습니다";
  if (error.includes("NETWORK_ERROR")) return "인터넷 연결을 확인해 주세요";
  if (error.includes("PROVIDER_ERROR")) return error.split("PROVIDER_ERROR:")[1] ?? "제공자 오류";
  return "가격을 가져오지 못했습니다";
}
