"use client";

import { Coins, Download, HardDrive, KeyRound, Languages, RefreshCw, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { currencies, fallbackCurrencyPreference, type CurrencyPreference } from "@/domain/currency";
import { normalizeTrade } from "@/domain/trading-ledger";
import type { Note } from "@/features/notes/types";
import { sampleObservations } from "@/features/observations/sample-data";
import type { Observation } from "@/features/observations/types";
import { samplePlans } from "@/features/plans/sample-data";
import type { BuyPlan } from "@/features/plans/types";
import { sampleReviews } from "@/features/reviews/sample-data";
import type { Review } from "@/features/reviews/types";
import { sampleRules } from "@/features/rules/sample-data";
import type { InvestmentRule } from "@/features/rules/types";
import { sampleStocks } from "@/features/stocks/sample-data";
import type { Stock } from "@/features/stocks/types";
import { sampleTrades } from "@/features/trades/sample-data";
import type { Trade } from "@/features/trades/types";
import { useI18n } from "@/i18n/i18n-provider";
import { languageNames, locales, type Locale } from "@/i18n/types";
import { isTauriApp, loadCollection, saveCollectionsAtomically } from "@/lib/local-repository";
import { localDateValue } from "@/lib/local-date";
import { useCurrencyPreference, useExchangeRates } from "@/lib/use-exchange-rates";
import { validateBackupPayload, type DashboardNoteBackup, type EarningsEventBackup } from "./backup";

type Backup = { version: 4; exportedAt: string; stocks: Stock[]; plans: BuyPlan[]; trades: Trade[]; observations: Observation[]; reviews: Review[]; rules: InvestmentRule[]; notes: Note[]; language: Locale; dashboardNotes: DashboardNoteBackup[]; earningsEvents: EarningsEventBackup[]; displayCurrency: CurrencyPreference["displayCurrency"] };

export function SettingsPageClient() {
  const { locale, setLocale, t } = useI18n();
  const [keyValue, setKeyValue] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { if (isTauriApp()) void invoke<boolean>("has_api_key", { provider: "twelve-data" }).then(setHasKey); }, []);

  async function exportBackup() {
    const backup: Backup = {
      version: 4,
      exportedAt: new Date().toISOString(),
      stocks: await loadCollection("stocks", sampleStocks),
      plans: await loadCollection("plans", samplePlans),
      trades: (await loadCollection("trades", sampleTrades)).map(normalizeTrade),
      observations: await loadCollection("observations", sampleObservations),
      reviews: await loadCollection("reviews", sampleReviews),
      rules: await loadCollection("rules", sampleRules),
      notes: await loadCollection<Note>("notes", []),
      language: locale,
      dashboardNotes: await loadCollection<DashboardNoteBackup>("dashboard-notes", [{ id: "dashboard-note", content: "", updatedAt: "" }]),
      earningsEvents: await loadCollection<EarningsEventBackup>("earnings-events", []),
      displayCurrency: (await loadCollection<CurrencyPreference>("preferences", [fallbackCurrencyPreference]))[0]?.displayCurrency ?? fallbackCurrencyPreference.displayCurrency,
    };
    const content = JSON.stringify(backup, null, 2);
    const filename = `tradejournal-backup-${localDateValue()}.json`;
    if (isTauriApp()) {
      const path = await save({ defaultPath: filename, filters: [{ name: "TradeJournal", extensions: ["json"] }] });
      if (path) await writeTextFile(path, content);
    } else {
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
    }
    setMessage(t("전체 백업 파일을 저장했습니다."));
  }

  async function importBackup() {
    try {
      let content: string | null = null;
      if (isTauriApp()) {
        const path = await open({ multiple: false, filters: [{ name: "TradeJournal", extensions: ["json"] }] });
        if (typeof path === "string") content = await readTextFile(path);
      } else content = await pickBrowserFile();
      if (!content) return;
      const parsed = validateBackupPayload(JSON.parse(content));
      const writes = [
        { collection: "stocks", values: parsed.stocks },
        { collection: "plans", values: parsed.plans },
        { collection: "trades", values: parsed.trades.map(normalizeTrade) },
        ...(parsed.version === 1 ? [] : [{ collection: "observations", values: parsed.observations }, { collection: "reviews", values: parsed.reviews }, { collection: "rules", values: parsed.rules }]),
        ...(parsed.version === 4 ? [
          { collection: "notes", values: parsed.notes },
          { collection: "language-preferences", values: [{ id: "language", locale: parsed.language, updatedAt: new Date().toISOString() }] },
          ...(parsed.dashboardNotes === undefined ? [] : [{ collection: "dashboard-notes", values: parsed.dashboardNotes }]),
          ...(parsed.earningsEvents === undefined ? [] : [{ collection: "earnings-events", values: parsed.earningsEvents }]),
          ...(parsed.displayCurrency === undefined ? [] : [{ collection: "preferences", values: [{ id: "currency", displayCurrency: parsed.displayCurrency, updatedAt: new Date().toISOString() }] }]),
        ] : []),
      ];
      await saveCollectionsAtomically(writes);
      setMessage(t("복원했습니다. 화면을 새로고침해 주세요."));
    } catch {
      setMessage(t("복원 실패: 백업 파일을 확인해 주세요."));
    }
  }

  async function storeKey() {
    if (!isTauriApp()) { localStorage.setItem("tradejournal.stock-api-key", keyValue); setHasKey(Boolean(keyValue)); }
    else { await invoke("save_api_key", { provider: "twelve-data", value: keyValue }); setHasKey(Boolean(keyValue)); }
    setKeyValue(""); setMessage(t("API 키 설정을 저장했습니다."));
  }

  return <>
    <div><p className="text-sm text-[var(--muted)]">{t("개인용 로컬 앱 관리")}</p><h1 className="mt-1 text-2xl font-semibold">{t("설정")}</h1></div>
    {message && <div className="mt-5 rounded-lg bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">{message}</div>}
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <LanguageCard locale={locale} setLocale={setLocale} />
      <CurrencyCard />
      <section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center gap-2"><HardDrive size={19} className="text-[var(--accent)]" /><h2 className="font-semibold">{t("데이터 백업")}</h2></div><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("모든 투자 기록과 Note, 언어 설정을 하나의 JSON 파일로 저장합니다. Mac 교체 전에 백업하세요.")}</p><div className="mt-5 flex flex-wrap gap-2"><button onClick={() => void exportBackup()} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white"><Download size={16} />{t("전체 백업")}</button><button onClick={() => void importBackup()} className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm"><Upload size={16} />{t("백업 복원")}</button></div></section>
      <section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center gap-2"><KeyRound size={19} className="text-[var(--accent)]" /><h2 className="font-semibold">Twelve Data API</h2></div><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("API 키를 macOS Keychain에 안전하게 저장합니다.")} <a className="text-[var(--accent)] underline" href="https://twelvedata.com/" target="_blank" rel="noreferrer">{t("키 발급 사이트")}</a></p><p className="mt-3 text-xs font-medium">{t("상태")}: {hasKey ? t("키 저장됨") : t("설정되지 않음")}</p><div className="mt-3 flex gap-2"><input type="password" aria-label={t("주가 API 키")} value={keyValue} onChange={(event) => setKeyValue(event.target.value)} className="h-10 min-w-0 flex-1 rounded-lg border px-3 text-sm" placeholder={t("API 키 입력")} /><button onClick={() => void storeKey()} className="rounded-lg border px-4 text-sm">{t("저장")}</button></div></section>
    </div>
    <section className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><b>{t("로컬 저장 안내")}</b><p className="mt-1 leading-6">{t("투자 기록은 서버에 전송하지 않습니다. 주가 갱신 시 티커만 Twelve Data로, 환율 갱신 시 통화 코드만 Frankfurter로 전송됩니다. 다른 Mac과 자동 동기화되지 않으므로 정기적으로 백업하세요.")}</p></section>
  </>;
}

function LanguageCard({ locale, setLocale }: { locale: Locale; setLocale: (locale: Locale) => Promise<void> }) {
  const { t } = useI18n();
  return <section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center gap-2"><Languages size={19} className="text-[var(--accent)]" /><h2 className="font-semibold">{t("언어")}</h2></div><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("앱의 메뉴와 안내 문구를 표시할 언어를 선택합니다. 작성한 기록은 번역되지 않습니다.")}</p><label className="mt-4 block text-sm font-medium">{t("표시 언어")}<select aria-label={t("표시 언어")} value={locale} onChange={(event) => void setLocale(event.target.value as Locale)} className="mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3">{locales.map((item) => <option key={item} value={item}>{languageNames[item]}</option>)}</select></label></section>;
}

function CurrencyCard() {
  const rates = useExchangeRates(); const preference = useCurrencyPreference(); const values = rates.snapshot.ratesToKrw;
  const { formatDate, formatNumber, t } = useI18n();
  const rateDate = rates.snapshot.rateDate
    ? formatDate(`${rates.snapshot.rateDate}T00:00:00`, { dateStyle: "medium" })
    : t("기본값");
  return <section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center gap-2"><Coins size={19} className="text-[var(--accent)]" /><h2 className="font-semibold">{t("통화와 기준환율")}</h2></div><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("대시보드 합계를 표시할 기준 통화를 선택합니다. 거래 당시 환율은 각 거래에 별도로 보존됩니다.")}</p><label className="mt-4 block text-sm font-medium">{t("표시 기준 통화")}<select aria-label={t("표시 기준 통화")} value={preference.displayCurrency} onChange={(event) => void preference.setDisplayCurrency(event.target.value as typeof preference.displayCurrency)} className="mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3">{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label><div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs"><Rate label="1 USD" value={values.USD} formatNumber={formatNumber} /><Rate label="100 JPY" value={values.JPY * 100} formatNumber={formatNumber} /><Rate label="1 EUR" value={values.EUR} formatNumber={formatNumber} /></div><div className="mt-4 flex items-center justify-between gap-3"><p className="text-xs text-[var(--muted)]">{rates.snapshot.source === "frankfurter" ? `Frankfurter · ${rateDate}` : t("기본 환율 · 온라인 갱신 필요")}{rates.onlineError && ` · ${t(rates.onlineError)}`}</p><button type="button" disabled={rates.refreshing} onClick={() => void rates.refresh()} className="flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"><RefreshCw size={15} className={rates.refreshing ? "animate-spin" : ""} />{t("갱신")}</button></div></section>;
}

function Rate({ label, value, formatNumber }: { label: string; value: number; formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string }) {
  return <div className="rounded-lg bg-[var(--surface-muted)] p-3"><p className="text-[var(--muted)]">{label}</p><p className="mt-1 font-semibold">{formatNumber(value, { style: "currency", currency: "KRW", maximumFractionDigits: 0 })}</p></div>;
}

function pickBrowserFile() {
  return new Promise<string | null>((resolve) => { const input = document.createElement("input"); input.type = "file"; input.accept = ".json,application/json"; input.onchange = async () => resolve(input.files?.[0] ? input.files[0].text() : null); input.click(); });
}
