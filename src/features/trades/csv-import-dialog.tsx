"use client";

import { FileSpreadsheet, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { detectImportMapping, exactProfileToAutoApply, headerSignature, importFieldLabels, optionalImportFields, profileMatch, requiredImportFields, validateImportMapping } from "@/features/import/column-mapping";
import { buildImportPreview, preflightImport } from "@/features/import/import-pipeline";
import type { ImportCandidateStatus, ImportIssue, ImportMapping, ImportMappingProfile, ParsedTabularFile } from "@/features/import/import-types";
import { parseImportFile } from "@/features/import/tabular-parser";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import { useI18n } from "@/i18n/i18n-provider";
import { useLocalCollection } from "@/lib/use-local-collection";
import { translateTradeText } from "./trade-i18n";
import type { Trade } from "./types";

const statusLabels: Record<ImportCandidateStatus, string> = {
  ready: "추가 가능", exact_duplicate: "정확한 중복", possible_duplicate: "중복 가능성", source_conflict: "원본 충돌", rejected: "제외됨",
};

export function CsvImportDialog({ stocks, accounts, existing, onCancel, onImport }: { stocks: Stock[]; accounts: InvestmentAccount[]; existing: Trade[]; onCancel: () => void; onImport: (trades: Trade[]) => Promise<boolean> }) {
  const { t, formatNumber } = useI18n();
  const profileStore = useLocalCollection<ImportMappingProfile>("import-mapping-profiles", []);
  const [parsed, setParsed] = useState<ParsedTabularFile | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [detectionIssues, setDetectionIssues] = useState<ImportIssue[]>([]);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof buildImportPreview>> | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [fileName, setFileName] = useState("");
  const [importBatchId, setImportBatchId] = useState("");
  const [fileError, setFileError] = useState("");
  const [provider, setProvider] = useState("");
  const [profileName, setProfileName] = useState("");
  const [profileError, setProfileError] = useState("");
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [saving, setSaving] = useState(false);
  const activeAccounts = accounts.filter((account) => !account.archivedAt);
  const [targetAccountId, setTargetAccountId] = useState(activeAccounts.find((account) => account.isDefault)?.id ?? activeAccounts[0]?.id ?? "");
  const mappingIssues = parsed ? [...detectionIssues, ...validateImportMapping(mapping, parsed.columns)] : [];
  const hasMappingErrors = mappingIssues.some((issue) => issue.severity === "error");
  const matchingProfiles = useMemo(() => parsed ? profileStore.items.map((profile) => ({ profile, match: profileMatch(profile, parsed.columns) })).filter((item) => item.match !== "incompatible") : [], [parsed, profileStore.items]);

  useEffect(() => {
    if (!parsed || hasMappingErrors) return;
    let active = true;
    buildImportPreview(parsed, mapping, { stocks, accounts, existingTrades: existing, targetAccountId, provider, importBatchId })
      .then((next) => {
        if (!active) return;
        setPreview(next);
        setSelectedIds(new Set(next.candidates.filter((candidate) => candidate.selectedByDefault).map((candidate) => candidate.id)));
      })
      .catch(() => { if (active) setFileError("가져오기 미리보기를 만들지 못했습니다."); });
    return () => { active = false; };
  }, [accounts, existing, hasMappingErrors, importBatchId, mapping, parsed, provider, stocks, targetAccountId]);

  const preflight = useMemo(() => preview ? preflightImport(preview, selectedIds, { existingTrades: existing, accounts }) : null, [accounts, existing, preview, selectedIds]);
  const canImport = Boolean(preflight?.ok && !saving);

  async function load(file?: File) {
    if (!file) return;
    setFileError("");
    setParsed(null); setPreview(null); setSelectedIds(new Set()); setFileName(file.name);
    try {
      const next = await parseImportFile(file);
      if (!next.columns.length || !next.rows.length) throw new Error("첫 번째 시트에서 헤더와 거래 행을 찾지 못했습니다.");
      const detected = detectImportMapping(next.columns);
      const exact = exactProfileToAutoApply(profileStore.items, next.columns);
      setParsed(next); setImportBatchId(`file:v1:batch:${crypto.randomUUID()}`);
      setPreview(null); setSelectedIds(new Set());
      setMapping(exact?.bindings ?? detected.mapping);
      setDetectionIssues(exact ? [] : detected.issues.filter((issue) => issue.code === "IMPORT_AMBIGUOUS_COLUMN"));
      setSelectedProfileId(exact?.id ?? "");
      setProfileName(exact?.name ?? "");
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "거래 내역 파일을 읽지 못했습니다.");
    }
  }

  function map(field: keyof ImportMapping, referenceKey: string) {
    setPreview(null); setSelectedIds(new Set());
    setDetectionIssues((current) => current.filter((issue) => issue.field !== field));
    setSelectedProfileId("");
    setMapping((current) => {
      const next = { ...current };
      const column = parsed?.columns.find((item) => `${item.reference.normalizedHeader}#${item.reference.occurrence}` === referenceKey);
      if (!column) delete next[field]; else next[field] = column.reference;
      return next;
    });
  }

  function applyProfile(id: string) {
    setPreview(null); setSelectedIds(new Set());
    setSelectedProfileId(id);
    const profile = profileStore.items.find((item) => item.id === id);
    if (!profile) return;
    setMapping(profile.bindings); setDetectionIssues([]); setProfileName(profile.name);
  }

  async function saveProfile() {
    if (!parsed || !profileName.trim() || hasMappingErrors) return;
    const now = new Date().toISOString();
    const existingProfile = profileStore.items.find((item) => item.id === selectedProfileId);
    const profile: ImportMappingProfile = { id: existingProfile?.id ?? crypto.randomUUID(), name: profileName.trim(), version: 1, bindings: mapping, headerSignature: headerSignature(parsed.columns), createdAt: existingProfile?.createdAt ?? now, updatedAt: now };
    setProfileError("");
    try {
      await profileStore.replaceAsync(existingProfile ? profileStore.allItems.map((item) => item.id === profile.id ? profile : item) : [profile, ...profileStore.allItems]);
      setSelectedProfileId(profile.id);
    } catch { setProfileError("매핑 프로필을 저장하지 못했습니다."); }
  }

  async function deleteProfile() {
    if (!selectedProfileId || !window.confirm(t("이 매핑 프로필을 삭제할까요?"))) return;
    setProfileError("");
    try {
      await profileStore.replaceAsync(profileStore.allItems.filter((profile) => profile.id !== selectedProfileId));
      setSelectedProfileId(""); setProfileName("");
    } catch { setProfileError("매핑 프로필을 삭제하지 못했습니다."); }
  }

  function toggleCandidate(id: string) {
    setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function submit() {
    if (!canImport || !preflight?.ok) return;
    setSaving(true);
    try { await onImport(preflight.trades); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="dialog" aria-modal="true" aria-labelledby="csv-import-title">
      <div className="h-full w-full max-w-5xl overflow-y-auto bg-[var(--surface)]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-[var(--surface)] p-5">
          <div><h2 id="csv-import-title" className="text-lg font-semibold">{t("증권사 거래 내역 가져오기")}</h2><p className="mt-1 text-xs text-[var(--muted)]">{t("후보를 검토한 뒤 선택한 거래만 원장에 안전하게 추가합니다.")}</p></div>
          <button type="button" disabled={saving} onClick={onCancel} aria-label={t("닫기")} className="disabled:opacity-50"><X /></button>
        </div>

        <div className="space-y-5 p-5">
          <section className="rounded-xl border border-dashed p-6 text-center">
            <FileSpreadsheet className="mx-auto text-[var(--accent)]" />
            <p className="mt-3 text-sm font-medium">{fileName || t("CSV, TSV, XLS 또는 XLSX 파일을 선택하세요")}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("원본 파일과 매핑 프로필은 이 기기에서만 처리되며 동기화나 백업에 포함되지 않습니다.")}</p>
            <label className="mt-4 inline-block cursor-pointer rounded-lg border px-4 py-2 text-sm"><input type="file" accept=".csv,.tsv,.xls,.xlsx,text/csv,text/tab-separated-values,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={saving} onChange={(event) => void load(event.target.files?.[0])} />{t("파일 선택")}</label>
            {fileError && <p role="alert" className="mt-3 text-sm text-red-600">{t(fileError)}</p>}
          </section>

          {parsed && <>
            <section className="grid gap-4 rounded-xl border p-5 sm:grid-cols-2">
              <label className="text-sm font-medium">{t("증권사 또는 파일 출처")}<input className="mt-2 h-10 w-full rounded-lg border bg-[var(--surface)] px-3" value={provider} onChange={(event) => { setPreview(null); setSelectedIds(new Set()); setProvider(event.target.value); }} placeholder={t("선택 사항 · 예: 미래에셋")}/></label>
              {mapping.accountName === undefined && <label className="text-sm font-medium">{t("이 거래를 어느 계좌로 가져올까요?")}<select required className="mt-2 h-10 w-full rounded-lg border bg-[var(--surface)] px-3" value={targetAccountId} onChange={(event) => { setPreview(null); setSelectedIds(new Set()); setTargetAccountId(event.target.value); }}><option value="">{t("계좌 추가 필요")}</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
            </section>

            <section className="rounded-xl border p-5">
              <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-semibold">{t("열 연결")}</h3><p className="mt-1 text-xs text-[var(--muted)]">{t("중복된 헤더도 이름과 출현 순서로 안정적으로 구분합니다.")}</p></div>
                <div className="flex flex-wrap items-end gap-2"><label className="text-xs text-[var(--muted)]">{t("매핑 프로필")}<select className="mt-1 block h-9 min-w-40 rounded-lg border bg-[var(--surface)] px-2 text-sm" value={selectedProfileId} onChange={(event) => applyProfile(event.target.value)}><option value="">{t("프로필 선택")}</option>{matchingProfiles.map(({ profile, match }) => <option key={profile.id} value={profile.id}>{profile.name} · {t(match === "exact" ? "정확히 일치" : "호환 가능")}</option>)}</select></label></div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[...requiredImportFields, ...optionalImportFields].map((field) => <label key={field} className="text-sm"><span>{t(importFieldLabels[field])}{requiredImportFields.includes(field) && " *"}</span><select className="mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3" value={mapping[field] ? `${mapping[field]?.normalizedHeader}#${mapping[field]?.occurrence}` : ""} onChange={(event) => map(field, event.target.value)}><option value="">{t("연결 안 함")}</option>{parsed.columns.map((column) => <option key={`${column.reference.normalizedHeader}-${column.reference.occurrence}`} value={`${column.reference.normalizedHeader}#${column.reference.occurrence}`}>{column.label}{parsed.columns.filter((item) => item.reference.normalizedHeader === column.reference.normalizedHeader).length > 1 ? ` (${column.reference.occurrence + 1})` : ""}</option>)}</select></label>)}
              </div>
              {mappingIssues.length > 0 && <div className="mt-3 space-y-1 text-sm">{mappingIssues.map((issue, index) => <p key={`${issue.code}-${issue.field}-${index}`} className={issue.severity === "error" ? "text-red-600" : "text-amber-700"}>{localizeIssue(issue, t, formatNumber)}</p>)}</div>}
              <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-4"><label className="text-xs text-[var(--muted)]">{t("프로필 이름")}<input className="mt-1 block h-9 rounded-lg border bg-[var(--surface)] px-3 text-sm" value={profileName} onChange={(event) => setProfileName(event.target.value)} /></label><button type="button" disabled={!profileName.trim() || hasMappingErrors} onClick={() => void saveProfile()} className="h-9 rounded-lg border px-3 text-sm disabled:opacity-50">{t(selectedProfileId ? "프로필 업데이트" : "새 프로필 저장")}</button>{selectedProfileId && <button type="button" aria-label={t("프로필 삭제")} onClick={() => void deleteProfile()} className="destructive-icon-action grid size-9 place-items-center rounded-lg border"><Trash2 size={15}/></button>}</div>
              {profileError && <p role="alert" className="mt-2 text-sm text-red-600">{t(profileError)}</p>}
            </section>

            <section className="overflow-hidden rounded-xl border">
              <div className="flex flex-wrap items-center justify-between gap-2 p-4"><div><h3 className="font-semibold">{t("가져오기 후보")}</h3><p className="mt-1 text-xs text-[var(--muted)]">{t("가능한 중복은 기본 선택되지 않으며 직접 확인해야 합니다.")}</p></div>{preview && <div className="flex flex-wrap gap-2 text-xs">{(Object.keys(statusLabels) as ImportCandidateStatus[]).map((status) => <span key={status} className="rounded-full bg-[var(--surface-muted)] px-2 py-1">{t(statusLabels[status])} {formatNumber(preview.summary[status])}</span>)}<span className="rounded-full bg-[var(--accent-soft)] px-2 py-1 text-[var(--accent)]">{t("가져오기 선택")} {formatNumber(selectedIds.size)}</span></div>}</div>
              {!preview && !hasMappingErrors ? <p className="border-t p-5 text-sm text-[var(--muted)]">{t("미리보기를 검증하고 있습니다...")}</p> : preview && <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-[var(--surface-muted)]"><tr><th className="px-3 py-2">{t("선택")}</th><th className="px-3 py-2">{t("행")}</th><th className="px-3 py-2">{t("상태")}</th><th className="px-3 py-2">{t("거래 일시")}</th><th className="px-3 py-2">{t("종목")}</th><th className="px-3 py-2">{t("유형")}</th><th className="px-3 py-2">{t("수량")}</th><th className="px-3 py-2">{t("체결 가격")}</th><th className="px-3 py-2">{t("검토")}</th></tr></thead><tbody>{preview.candidates.slice(0, 100).map((candidate) => { const selectable = candidate.status === "ready" || candidate.status === "possible_duplicate"; return <tr key={candidate.id} className="border-t align-top"><td className="px-3 py-2"><input aria-label={t("행 {row} 선택", { row: formatNumber(candidate.row) })} type="checkbox" disabled={!selectable} checked={selectedIds.has(candidate.id)} onChange={() => toggleCandidate(candidate.id)} /></td><td className="px-3 py-2">{formatNumber(candidate.row)}</td><td className="whitespace-nowrap px-3 py-2">{t(statusLabels[candidate.status])}</td><td className="whitespace-nowrap px-3 py-2 tabular-nums">{candidate.trade?.tradedAt ?? "—"}</td><td className="whitespace-nowrap px-3 py-2">{candidate.trade?.stockName ?? "—"}</td><td className="px-3 py-2">{candidate.trade ? t(candidate.trade.tradeType) : "—"}</td><td className="px-3 py-2 tabular-nums">{candidate.trade ? formatNumber(candidate.trade.quantity) : "—"}</td><td className="px-3 py-2 tabular-nums">{candidate.trade ? formatNumber(candidate.trade.price) : "—"}</td><td className="min-w-56 px-3 py-2">{candidate.issues.map((issue, index) => <p key={`${issue.code}-${index}`} className={issue.severity === "error" ? "text-red-600" : issue.severity === "warning" ? "text-amber-700" : "text-[var(--muted)]"}>{localizeIssue(issue, t, formatNumber)}</p>)}</td></tr>; })}</tbody></table></div>}
              {preview && preview.candidates.length > 100 && <p className="border-t p-3 text-xs text-[var(--muted)]">{t("처음 100개 후보만 표시합니다. 모든 후보는 검증과 가져오기에 포함됩니다.")}</p>}
            </section>

            {preflight && !preflight.ok && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{preflight.issues.map((issue) => <p key={issue.code}>{localizeIssue(issue, t, formatNumber)}</p>)}</div>}
          </>}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t bg-[var(--surface)] p-4"><p className="text-xs text-[var(--muted)]">{t("저장은 전체 원장을 다시 검증한 뒤 한 번에 수행됩니다.")}</p><div className="flex gap-2"><button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">{t("취소")}</button><button type="button" disabled={!canImport} onClick={() => void submit()} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm text-white disabled:opacity-50">{saving ? t("저장 중...") : t("{count}건 가져오기", { count: formatNumber(preflight?.trades.length ?? 0) })}</button></div></div>
      </div>
    </div>
  );
}

function localizeIssue(issue: ImportIssue, t: (key: string, params?: Record<string, string | number>) => string, formatNumber: (value: number) => string) {
  const labels: Record<string, string> = {
    IMPORT_AMBIGUOUS_COLUMN: "자동으로 연결할 수 없는 열이 있습니다. 직접 선택해 주세요.", IMPORT_COLUMN_MISSING: "저장된 매핑의 열을 현재 파일에서 찾을 수 없습니다.", IMPORT_COLUMN_COLLISION: "하나의 열을 여러 필드에 동시에 연결할 수 없습니다.", IMPORT_REQUIRED_COLUMN: "필수 열을 연결해 주세요.", IMPORT_INSTRUMENT_COLUMN: "종목코드 또는 종목명 열을 연결해 주세요.",
    IMPORT_EXACT_DUPLICATE: "이미 가져온 동일 체결입니다.", IMPORT_POSSIBLE_DUPLICATE: "기존 기록과 같은 체결일 가능성이 있습니다.", IMPORT_AMBIGUOUS_IDENTICAL_ROW: "파일 안에 동일한 체결 행이 있어 직접 포함 여부를 확인해야 합니다.", IMPORT_SOURCE_CONFLICT: "같은 원본 체결 ID가 기존 기록과 다른 값을 가집니다.", IMPORT_TIME_MISSING: "거래 시간이 없어 오전 9시로 해석했습니다.", IMPORT_UNSUPPORTED_TIMEZONE: "일반 파일 가져오기는 시간대가 포함된 값을 지원하지 않습니다.", IMPORT_AMBIGUOUS_INTRADAY_ORDER: "같은 날짜의 거래 순서를 확정할 수 없어 시간을 입력해야 합니다.",
    IMPORT_DATE_MISSING: "거래일이 없습니다.", IMPORT_AMBIGUOUS_DATE: "날짜가 모호합니다. YYYY-MM-DD 형식을 사용해 주세요.", IMPORT_INVALID_DATE: "거래일 형식을 확인해 주세요.", IMPORT_INVALID_TIME: "거래 시간을 확인해 주세요.", IMPORT_INVALID_NUMBER: "숫자 형식을 확인해 주세요.", IMPORT_NON_POSITIVE_NUMBER: "수량과 체결가는 0보다 커야 합니다.", IMPORT_NEGATIVE_NUMBER: "수수료와 세금은 0 이상이어야 합니다.", IMPORT_INVALID_SIDE: "매수/매도 구분을 확인해 주세요.", IMPORT_INVALID_CURRENCY: "지원하지 않는 통화입니다.", IMPORT_CURRENCY_CONFLICT: "파일 통화와 등록된 종목 통화가 다릅니다.", IMPORT_CURRENCY_FALLBACK: "통화가 없어 등록된 종목 통화를 사용했습니다.", IMPORT_EXCHANGE_RATE_FALLBACK: "환율이 없어 현재 기본 환율을 사용했습니다.",
    IMPORT_AMBIGUOUS_INSTRUMENT: "종목 연결 후보가 여러 개입니다.", IMPORT_INSTRUMENT_CONFLICT: "종목코드와 종목명이 서로 다른 종목을 가리킵니다.", IMPORT_INSTRUMENT_NOT_FOUND: "연결할 종목을 찾을 수 없습니다.", IMPORT_AMBIGUOUS_ACCOUNT: "같은 이름의 계좌가 여러 개입니다.", IMPORT_ACCOUNT_NOT_FOUND: "등록되지 않은 계좌입니다.", IMPORT_ARCHIVED_ACCOUNT: "보관된 계좌로는 가져올 수 없습니다.", IMPORT_ACCOUNT_REQUIRED: "가져올 대상 계좌를 선택해 주세요.", IMPORT_ROW_REJECTED: "가져오기 행을 확인해 주세요.", IMPORT_NOTHING_SELECTED: "가져올 거래를 하나 이상 선택해 주세요.", IMPORT_LEDGER_CONFLICT: "선택한 거래가 원장 사전 검증을 통과하지 못했습니다.",
  };
  const message = t(labels[issue.code] ?? "가져오기 행을 확인해 주세요.");
  const reason = issue.code === "IMPORT_LEDGER_CONFLICT" && typeof issue.details?.reason === "string" ? translateTradeText(issue.details.reason, t, formatNumber) : "";
  return reason ? `${message} ${reason}` : message;
}
