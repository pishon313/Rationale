"use client";

import { ArchiveRestore, Coins, Download, HardDrive, KeyRound, Languages, LockKeyhole, RefreshCw, ShieldAlert, ShieldCheck, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { currencies } from "@/domain/currency";
import { useI18n } from "@/i18n/i18n-provider";
import { languageNames, locales, type Locale } from "@/i18n/types";
import { isTauriApp, loadCollection } from "@/lib/local-repository";
import { localDateValue } from "@/lib/local-date";
import { useCurrencyPreference, useExchangeRates } from "@/lib/use-exchange-rates";
import { validateBackupPayload, type ValidatedBackup } from "./backup";
import { lastAutomaticBackupKey, lastAutomaticBackupPathKey } from "./automatic-backup";
import { backupCounts, createBackupPayload, restoreBackup, restoreSnapshotCollection, type RestoreSnapshot } from "./backup-service";
import { decryptBackupPayload, encryptedBackupErrorMessage, encryptedBackupExtension, encryptBackupPayload, minimumBackupPasswordLength, parseSelectedBackup, validateNewBackupPassword } from "./encrypted-backup";

export function SettingsPageClient() {
  const { locale, setLocale, t } = useI18n();
  const [keyValue, setKeyValue] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingRestore, setPendingRestore] = useState<ValidatedBackup | null>(null);
  const [restoreAvailable, setRestoreAvailable] = useState(false);
  const [automaticBackupAt, setAutomaticBackupAt] = useState("");
  const [automaticBackupPath, setAutomaticBackupPath] = useState("");
  const [showEncryptedExport, setShowEncryptedExport] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportPasswordConfirmation, setExportPasswordConfirmation] = useState("");
  const [exportPasswordError, setExportPasswordError] = useState("");
  const [encryptedImportContent, setEncryptedImportContent] = useState<string | null>(null);
  const [importPassword, setImportPassword] = useState("");
  const [importPasswordError, setImportPasswordError] = useState("");
  useEffect(() => {
    if (isTauriApp()) void invoke<boolean>("has_api_key", { provider: "twelve-data" }).then(setHasKey);
    void loadCollection<RestoreSnapshot>(restoreSnapshotCollection, []).then((items) => setRestoreAvailable(items.length > 0));
    const refreshBackupStatus = () => {
      setAutomaticBackupAt(localStorage.getItem(lastAutomaticBackupKey) ?? "");
      setAutomaticBackupPath(localStorage.getItem(lastAutomaticBackupPathKey) ?? "");
    };
    refreshBackupStatus();
    window.addEventListener("tradejournal:automatic-backup", refreshBackupStatus);
    return () => window.removeEventListener("tradejournal:automatic-backup", refreshBackupStatus);
  }, []);

  async function exportBackup() {
    try {
      const backup = await createBackupPayload(locale);
      const content = JSON.stringify(backup, null, 2);
      const filename = `rationale-backup-${localDateValue()}.json`;
      if (isTauriApp()) {
        const path = await save({ defaultPath: filename, filters: [{ name: "Rationale JSON", extensions: ["json"] }] });
        if (!path) return;
        await writeTextFile(path, content);
      } else {
        downloadBrowserFile(content, filename, "application/json");
      }
      setMessage(t("일반 백업 파일을 저장했습니다."));
    } catch {
      setMessage(t("백업 파일을 저장하지 못했습니다."));
    }
  }

  async function importBackup() {
    let selected: { content: string; filename: string } | null = null;
    try {
      if (isTauriApp()) {
        const path = await open({ multiple: false, filters: [{ name: "Rationale backup", extensions: ["json", encryptedBackupExtension] }] });
        if (typeof path === "string") selected = { content: await readTextFile(path), filename: path.split(/[\\/]/).at(-1) ?? "" };
      } else selected = await pickBrowserFile();
    } catch {
      setMessage(t("백업 파일을 읽지 못했습니다."));
      return;
    }
    if (!selected) return;
    try {
      const parsed = parseSelectedBackup(selected.content, selected.filename);
      if (parsed.kind === "encrypted") {
        setEncryptedImportContent(parsed.content);
        setImportPassword("");
        setImportPasswordError("");
      } else {
        setPendingRestore(parsed.backup);
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(code.includes("ENCRYPTED_BACKUP")
        ? t(encryptedBackupErrorMessage(error))
        : t("올바른 Rationale 백업 파일이 아니거나 데이터 형식이 손상되었습니다."));
    }
  }

  async function exportEncryptedBackup() {
    const passwordError = validateNewBackupPassword(exportPassword, exportPasswordConfirmation);
    if (passwordError) {
      setExportPasswordError(t(passwordError === "PASSWORD_TOO_SHORT" ? "백업 비밀번호는 10자 이상이어야 합니다." : "비밀번호 확인이 일치하지 않습니다."));
      return;
    }
    try {
      const backup = await createBackupPayload(locale);
      const content = await encryptBackupPayload(backup, exportPassword);
      const filename = `rationale-backup-${localDateValue()}.${encryptedBackupExtension}`;
      const path = await save({ defaultPath: filename, filters: [{ name: "Rationale encrypted backup", extensions: [encryptedBackupExtension] }] });
      if (!path) { setShowEncryptedExport(false); return; }
      await writeTextFile(path, content);
      setShowEncryptedExport(false);
      setMessage(t("암호화 백업 파일을 저장했습니다."));
    } catch (error) {
      setExportPasswordError(t(String(error).includes("ENCRYPTION_FAILED") ? "백업을 암호화하지 못했습니다." : "백업 파일을 저장하지 못했습니다."));
    } finally {
      setExportPassword("");
      setExportPasswordConfirmation("");
    }
  }

  async function decryptImportedBackup() {
    if (!encryptedImportContent || !importPassword) return;
    const content = encryptedImportContent;
    try {
      const backup = await decryptBackupPayload(content, importPassword);
      setPendingRestore(backup);
      setEncryptedImportContent(null);
      setImportPasswordError("");
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      setImportPasswordError(t(code.includes("DECRYPTED_BACKUP_INVALID")
        ? "복호화는 성공했지만 백업 데이터 형식이 손상되었습니다."
        : encryptedBackupErrorMessage(error)));
    } finally {
      setImportPassword("");
    }
  }

  function closeEncryptedExport() {
    setShowEncryptedExport(false);
    setExportPassword("");
    setExportPasswordConfirmation("");
    setExportPasswordError("");
  }

  function closeEncryptedImport() {
    setEncryptedImportContent(null);
    setImportPassword("");
    setImportPasswordError("");
  }

  async function confirmRestore() {
    if (!pendingRestore) return;
    try {
      const current = await createBackupPayload(locale, { allowCorrupted: true });
      await restoreBackup(current, pendingRestore);
      setRestoreAvailable(true);
      setPendingRestore(null);
      setMessage(t("복원했습니다. 화면을 새로고침해 주세요."));
      window.setTimeout(() => window.location.reload(), 600);
    } catch {
      setMessage(t("복원 실패: 백업 파일을 확인해 주세요."));
    }
  }

  async function undoRestore() {
    try {
      const snapshot = (await loadCollection<RestoreSnapshot>(restoreSnapshotCollection, []))[0];
      if (!snapshot) return;
      const previous = validateBackupPayload(JSON.parse(snapshot.content));
      const current = await createBackupPayload(locale, { allowCorrupted: true });
      await restoreBackup(current, previous);
      setMessage(t("마지막 복원을 되돌렸습니다."));
      window.setTimeout(() => window.location.reload(), 600);
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
      <section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center gap-2"><HardDrive size={19} className="text-[var(--accent)]" /><h2 className="font-semibold">{t("데이터 백업")}</h2></div><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("모든 투자 기록과 Note, 언어 설정을 하나의 파일로 저장합니다. Mac 교체 전에 백업하세요.")}</p><div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><p className="flex items-center gap-2 font-medium"><ShieldAlert size={15} />{t("백업 파일 보안")}</p><p className="mt-1">{t("일반 JSON과 자동 백업은 암호화되지 않으며 거래 내역, 계좌명, 메모와 감정 기록을 포함할 수 있습니다. 이메일·메신저·공유 폴더에 올릴 때 주의하세요.")}</p><p className="mt-1">{t("계좌번호, 비밀번호, 인증정보는 메모에 입력하지 말고 Mac의 FileVault를 사용하는 것을 권장합니다.")}</p></div><div className="mt-3 rounded-lg bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--muted)]"><p className="flex items-center gap-2 font-medium text-[var(--foreground)]"><ShieldCheck size={15} className="text-emerald-600" />{t("자동 백업")}</p><p className="mt-1">{t("Mac 앱은 하루 한 번 암호화되지 않은 JSON 자동 백업을 만들고 최근 7개를 보관합니다.")}</p><p className="mt-1">{t("민감한 기록을 외부에 보관할 때는 수동 암호화 백업을 사용하세요.")}</p><p className="mt-1">{t("최근 자동 백업")}: {automaticBackupAt ? formatBackupDate(automaticBackupAt, locale) : t("아직 없음")}</p>{automaticBackupPath && <p className="mt-1 break-all" title={automaticBackupPath}>{automaticBackupPath}</p>}</div><div className="mt-5 flex flex-wrap gap-2"><button onClick={() => void exportBackup()} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white"><Download size={16} />{t("일반 백업 저장")}</button><button type="button" disabled={!isTauriApp()} onClick={() => setShowEncryptedExport(true)} className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"><LockKeyhole size={16} />{t("암호화 백업 저장")}</button><button onClick={() => void importBackup()} className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm"><Upload size={16} />{t("백업 복원")}</button>{restoreAvailable && <button onClick={() => void undoRestore()} className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm"><ArchiveRestore size={16} />{t("마지막 복원 되돌리기")}</button>}</div>{!isTauriApp() && <p className="mt-2 text-xs text-[var(--muted)]">{t("암호화 백업은 Mac 앱에서 사용할 수 있습니다. 브라우저 미리보기에서는 일반 JSON 백업을 사용하세요.")}</p>}</section>
      <section className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex items-center gap-2"><KeyRound size={19} className="text-[var(--accent)]" /><h2 className="font-semibold">Twelve Data API</h2></div><p className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("API 키를 macOS Keychain에 안전하게 저장합니다.")} <a className="text-[var(--accent)] underline" href="https://twelvedata.com/" target="_blank" rel="noreferrer">{t("키 발급 사이트")}</a></p><p className="mt-3 text-xs font-medium">{t("상태")}: {hasKey ? t("키 저장됨") : t("설정되지 않음")}</p><div className="mt-3 flex gap-2"><input type="password" aria-label={t("주가 API 키")} value={keyValue} onChange={(event) => setKeyValue(event.target.value)} className="h-10 min-w-0 flex-1 rounded-lg border px-3 text-sm" placeholder={t("API 키 입력")} /><button onClick={() => void storeKey()} className="rounded-lg border px-4 text-sm">{t("저장")}</button></div></section>
    </div>
    <section className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><b>{t("로컬 저장 안내")}</b><p className="mt-1 leading-6">{t("투자 기록은 서버에 업로드되지 않습니다. 로컬 SQLite 파일에는 앱 자체 암호화가 적용되지 않으므로 macOS 사용자 계정과 FileVault로 Mac을 보호하세요. 공용 Mac이나 여러 사람이 공유하는 계정에서는 사용에 주의하고 민감한 인증정보를 메모에 저장하지 마세요.")}</p><p className="mt-1 leading-6">{t("주가 갱신 시 티커만 Twelve Data로, 환율 갱신 시 통화 코드만 Frankfurter로 전송됩니다. 다른 Mac과 자동 동기화되지 않으므로 정기적으로 백업하세요.")}</p></section>
    {pendingRestore && <RestorePreview backup={pendingRestore} cancel={() => setPendingRestore(null)} confirm={() => void confirmRestore()} />}
    {showEncryptedExport && <BackupPasswordDialog mode="create" password={exportPassword} confirmation={exportPasswordConfirmation} error={exportPasswordError} setPassword={(value) => { setExportPassword(value); setExportPasswordError(""); }} setConfirmation={(value) => { setExportPasswordConfirmation(value); setExportPasswordError(""); }} cancel={closeEncryptedExport} confirm={() => void exportEncryptedBackup()} />}
    {encryptedImportContent && <BackupPasswordDialog mode="restore" password={importPassword} error={importPasswordError} setPassword={(value) => { setImportPassword(value); setImportPasswordError(""); }} cancel={closeEncryptedImport} confirm={() => void decryptImportedBackup()} />}
  </>;
}

function BackupPasswordDialog({ mode, password, confirmation = "", error, setPassword, setConfirmation, cancel, confirm }: { mode: "create" | "restore"; password: string; confirmation?: string; error: string; setPassword: (value: string) => void; setConfirmation?: (value: string) => void; cancel: () => void; confirm: () => void }) {
  const { t } = useI18n();
  const creating = mode === "create";
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="backup-password-title"><section className="w-full max-w-md rounded-xl bg-[var(--surface)] p-5 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><h2 id="backup-password-title" className="text-lg font-semibold">{t(creating ? "암호화 백업 비밀번호" : "백업 비밀번호 입력")}</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t(creating ? `10자 이상의 비밀번호를 입력하세요. 비밀번호를 잊으면 백업을 복원할 수 없습니다.` : "암호화 백업을 복원할 때 사용한 비밀번호를 입력하세요.")}</p></div><button type="button" aria-label={t("닫기")} onClick={cancel}><X size={19} /></button></div>{error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">{error}</p>}<label className="mt-4 block text-sm font-medium">{t("비밀번호")}<input autoFocus type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>{creating && <label className="mt-3 block text-sm font-medium">{t("비밀번호 확인")}<input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation?.(event.target.value)} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={cancel} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button type="button" disabled={!password || (creating && password.length < minimumBackupPasswordLength)} onClick={confirm} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50">{t(creating ? "암호화하여 저장" : "복호화")}</button></div></section></div>;
}

function RestorePreview({ backup, cancel, confirm }: { backup: ValidatedBackup; cancel: () => void; confirm: () => void }) {
  const { formatDate, formatNumber, t } = useI18n();
  const counts = backupCounts(backup);
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-black/45 p-4" role="alertdialog" aria-modal="true" aria-labelledby="restore-preview-title"><section className="w-full max-w-lg rounded-xl bg-[var(--surface)] p-5 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><h2 id="restore-preview-title" className="text-lg font-semibold">{t("복원할 백업 확인")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("기존 기록은 안전 사본으로 보관한 뒤 이 백업으로 교체됩니다.")}</p></div><button type="button" aria-label={t("닫기")} onClick={cancel}><X size={19} /></button></div><div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">{Object.entries(counts).map(([label, count]) => <div key={label} className="rounded-lg bg-[var(--surface-muted)] p-3 text-center"><p className="text-xs text-[var(--muted)]">{t(restoreLabel(label))}</p><p className="mt-1 font-semibold">{formatNumber(count)}</p></div>)}</div><p className="mt-4 text-xs text-[var(--muted)]">{t("백업 생성일")}: {backup.exportedAt ? formatDate(backup.exportedAt, { dateStyle: "medium", timeStyle: "short" }) : t("알 수 없음")}</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={cancel} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button type="button" onClick={confirm} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white">{t("확인 후 복원")}</button></div></section></div>;
}

function restoreLabel(value: string) {
  return ({ stocks: "종목", plans: "매수 계획", trades: "매매", observations: "관찰 기록", reviews: "회고", notes: "Note" } as Record<string, string>)[value] ?? value;
}

function formatBackupDate(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
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

function downloadBrowserFile(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
}

function pickBrowserFile() {
  return new Promise<{ content: string; filename: string } | null>((resolve, reject) => { const input = document.createElement("input"); input.type = "file"; input.accept = ".json,application/json"; input.onchange = async () => { const file = input.files?.[0]; if (!file) { resolve(null); return; } try { resolve({ content: await file.text(), filename: file.name }); } catch (error) { reject(error); } }; input.click(); });
}
