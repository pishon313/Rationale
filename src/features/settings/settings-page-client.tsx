"use client";
import { Download, HardDrive, KeyRound, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { isTauriApp, loadCollection, saveCollection } from "@/lib/local-repository";
import { sampleStocks } from "@/features/stocks/sample-data";
import { samplePlans } from "@/features/plans/sample-data";
import { sampleTrades } from "@/features/trades/sample-data";
import { sampleObservations } from "@/features/observations/sample-data";
import { sampleReviews } from "@/features/reviews/sample-data";
import { sampleRules } from "@/features/rules/sample-data";
import type { Stock } from "@/features/stocks/types";
import type { BuyPlan } from "@/features/plans/types";
import type { Trade } from "@/features/trades/types";
import type { Observation } from "@/features/observations/types";
import type { Review } from "@/features/reviews/types";
import type { InvestmentRule } from "@/features/rules/types";

type Backup = { version: 2; exportedAt: string; stocks: Stock[]; plans: BuyPlan[]; trades: Trade[]; observations: Observation[]; reviews: Review[]; rules: InvestmentRule[] };
type LegacyBackup = Omit<Backup, "version" | "observations" | "reviews" | "rules"> & { version: 1 };

export function SettingsPageClient() {
  const [keyValue, setKeyValue] = useState(""); const [hasKey, setHasKey] = useState(false); const [message, setMessage] = useState("");
  useEffect(() => { if (isTauriApp()) invoke<boolean>("has_api_key", { provider: "twelve-data" }).then(setHasKey); }, []);
  async function exportBackup() {
    const backup: Backup = { version: 2, exportedAt: new Date().toISOString(), stocks: await loadCollection("stocks", sampleStocks), plans: await loadCollection("plans", samplePlans), trades: await loadCollection("trades", sampleTrades), observations: await loadCollection("observations", sampleObservations), reviews: await loadCollection("reviews", sampleReviews), rules: await loadCollection("rules", sampleRules) };
    const content = JSON.stringify(backup, null, 2); const filename = `tradejournal-backup-${new Date().toISOString().slice(0, 10)}.json`;
    if (isTauriApp()) { const path = await save({ defaultPath: filename, filters: [{ name: "TradeJournal 백업", extensions: ["json"] }] }); if (path) await writeTextFile(path, content); }
    else { const url = URL.createObjectURL(new Blob([content], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }
    setMessage("전체 백업 파일을 저장했습니다.");
  }
  async function importBackup() {
    let content: string | null = null;
    if (isTauriApp()) { const path = await open({ multiple: false, filters: [{ name: "TradeJournal 백업", extensions: ["json"] }] }); if (typeof path === "string") content = await readTextFile(path); }
    else content = await pickBrowserFile();
    if (!content) return;
    const parsed = JSON.parse(content) as Backup | LegacyBackup;
    if (![1, 2].includes(parsed.version) || !Array.isArray(parsed.stocks) || !Array.isArray(parsed.plans) || !Array.isArray(parsed.trades)) throw new Error("올바른 TradeJournal 백업이 아닙니다.");
    await saveCollection("stocks", parsed.stocks); await saveCollection("plans", parsed.plans); await saveCollection("trades", parsed.trades);
    if (parsed.version === 2) { await saveCollection("observations", parsed.observations); await saveCollection("reviews", parsed.reviews); await saveCollection("rules", parsed.rules); }
    setMessage("복원했습니다. 화면을 새로고침해 주세요.");
  }
  async function storeKey() {
    if (!isTauriApp()) { localStorage.setItem("tradejournal.stock-api-key", keyValue); setHasKey(Boolean(keyValue)); }
    else { await invoke("save_api_key", { provider: "twelve-data", value: keyValue }); setHasKey(Boolean(keyValue)); }
    setKeyValue(""); setMessage("API 키 설정을 저장했습니다.");
  }
  return <><div><p className="text-sm text-[var(--muted)]">개인용 로컬 앱 관리</p><h1 className="mt-1 text-2xl font-semibold">설정</h1></div>{message && <div className="mt-5 rounded-lg bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">{message}</div>}<div className="mt-6 grid gap-4 lg:grid-cols-2"><section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center gap-2"><HardDrive size={19} className="text-[var(--accent)]" /><h2 className="font-semibold">데이터 백업</h2></div><p className="mt-2 text-sm leading-6 text-[var(--muted)]">종목, 계획, 매매, 관찰, 회고와 투자 원칙을 하나의 JSON 파일로 저장합니다. Mac 교체 전에 백업하세요.</p><div className="mt-5 flex flex-wrap gap-2"><button onClick={() => void exportBackup()} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white"><Download size={16} />전체 백업</button><button onClick={() => void importBackup()} className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm"><Upload size={16} />백업 복원</button></div></section><section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center gap-2"><KeyRound size={19} className="text-[var(--accent)]" /><h2 className="font-semibold">Twelve Data API 키</h2></div><p className="mt-2 text-sm leading-6 text-[var(--muted)]">발급받은 키를 macOS Keychain에 저장합니다. 키는 웹뷰나 SQLite에 저장되지 않습니다. <a className="text-[var(--accent)] underline" href="https://twelvedata.com/" target="_blank" rel="noreferrer">키 발급 사이트</a></p><p className="mt-3 text-xs font-medium">상태: {hasKey ? "키 저장됨" : "설정되지 않음"}</p><div className="mt-3 flex gap-2"><input type="password" aria-label="주가 API 키" value={keyValue} onChange={(e) => setKeyValue(e.target.value)} className="h-10 min-w-0 flex-1 rounded-lg border px-3 text-sm" placeholder="API 키 입력" /><button onClick={() => void storeKey()} className="rounded-lg border px-4 text-sm">저장</button></div></section></div><section className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><b>로컬 저장 안내</b><p className="mt-1 leading-6">투자 기록은 서버에 전송하지 않습니다. 주가 갱신 시 티커만 Twelve Data로 전송됩니다. 다른 Mac과 자동 동기화되지 않으므로 정기적으로 백업하세요.</p></section></>;
}

function pickBrowserFile() { return new Promise<string | null>((resolve) => { const input = document.createElement("input"); input.type = "file"; input.accept = ".json,application/json"; input.onchange = async () => resolve(input.files?.[0] ? input.files[0].text() : null); input.click(); }); }
