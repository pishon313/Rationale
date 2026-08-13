"use client";

import { FileSpreadsheet, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { columnReferenceKey, detectImportMapping, exactProfileToAutoApply, hasDuplicateMappingProfileName, headerSignature, profileMatch, updatedMappingProfile, validateImportMapping } from "@/features/import/column-mapping";
import { buildImportPreview, preflightImport } from "@/features/import/import-pipeline";
import { applySourceColumnAssignment, mappedSourceColumnKeys, mappingAdvisories, mappingReady, requiredMappingCoverage, sourceColumnAssignments, type MappingAdvisoryCode, type SourceColumnAssignment, type SourceColumnAssignmentTarget } from "@/features/import/source-column-mapping";
import type { ImportCandidateStatus, ImportIssue, ImportMapping, ImportMappingProfile, ImportMutationPlan, ParsedTabularFile } from "@/features/import/import-types";
import { parseImportFile } from "@/features/import/tabular-parser";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import { useI18n } from "@/i18n/i18n-provider";
import { useLocalCollection } from "@/lib/use-local-collection";
import { translateTradeText } from "./trade-i18n";
import { SourceColumnMappingTable } from "./source-column-mapping-table";
import type { Trade } from "./types";

const statusLabels: Record<ImportCandidateStatus, string> = {
  ready: "추가 가능", exact_duplicate: "정확한 중복", possible_duplicate: "중복 가능성", previously_deleted: "삭제된 기록", source_conflict: "원본 충돌", rejected: "제외됨",
};
const pageSize = 100;
type ImportStage = "file" | "mapping" | "review";

export function CsvImportDialog({ stocks, accounts, existing, onCancel, onImport }: { stocks: Stock[]; accounts: InvestmentAccount[]; existing: Trade[]; onCancel: () => void; onImport: (plan: ImportMutationPlan) => Promise<boolean> }) {
  const { t, formatNumber } = useI18n();
  const profileStore = useLocalCollection<ImportMappingProfile>("import-mapping-profiles", []);
  const [parsed, setParsed] = useState<ParsedTabularFile | null>(null);
  const [stage, setStage] = useState<ImportStage>("file");
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
  const [isProfileDirty, setIsProfileDirty] = useState(false);
  const [profileBindings, setProfileBindings] = useState<ImportMapping | undefined>();
  const [manuallyChanged, setManuallyChanged] = useState<Set<string>>(new Set());
  const [explicitlyIgnored, setExplicitlyIgnored] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [buildingPreview, setBuildingPreview] = useState(false);
  const previewGeneration = useRef(0);
  const activeAccounts = accounts.filter((account) => !account.archivedAt);
  const [targetAccountId, setTargetAccountId] = useState(activeAccounts.find((account) => account.isDefault)?.id ?? activeAccounts[0]?.id ?? "");
  const mappingIssues = parsed ? [...detectionIssues, ...validateImportMapping(mapping, parsed.columns)] : [];
  const mappingDetailIssues = mappingIssues.filter((issue) => issue.code !== "IMPORT_REQUIRED_COLUMN" && issue.code !== "IMPORT_INSTRUMENT_COLUMN");
  const hasMappingErrors = mappingIssues.some((issue) => issue.severity === "error");
  const matchingProfiles = useMemo(() => parsed ? profileStore.items.map((profile) => ({ profile, match: profileMatch(profile, parsed.columns) })).filter((item) => item.match !== "incompatible") : [], [parsed, profileStore.items]);
  const assignments = useMemo(() => parsed ? sourceColumnAssignments(parsed, mapping, { profileBindings, manuallyChanged, explicitlyIgnored }) : [], [parsed, mapping, profileBindings, manuallyChanged, explicitlyIgnored]);
  const coverage = useMemo(() => requiredMappingCoverage(mapping), [mapping]);
  const advisories = useMemo(() => mappingAdvisories(mapping), [mapping]);
  const canReview = Boolean(parsed && mappingReady(mapping, parsed.columns, targetAccountId) && !buildingPreview);

  const preflight = useMemo(() => preview ? preflightImport(preview, selectedIds, { existingTrades: existing, accounts }) : null, [accounts, existing, preview, selectedIds]);
  const canImport = Boolean(preflight?.ok && !saving);
  const pageCount = Math.max(1, Math.ceil((preview?.candidates.length ?? 0) / pageSize));
  const pageCandidates = preview?.candidates.slice(page * pageSize, (page + 1) * pageSize) ?? [];
  const pageCandidateIds = new Set(pageCandidates.map((candidate) => candidate.id));
  const selectedOnPage = [...selectedIds].filter((id) => pageCandidateIds.has(id)).length;
  const selectedOutsidePage = selectedIds.size - selectedOnPage;
  const blockedCount = preview ? preview.summary.exact_duplicate + preview.summary.source_conflict + preview.summary.rejected : 0;

  function cancelPendingPreviewBuild() {
    previewGeneration.current += 1;
    setBuildingPreview(false);
  }

  async function load(file?: File) {
    if (!file) return;
    cancelPendingPreviewBuild();
    const generation = previewGeneration.current;
    setFileError("");
    setParsed(null); setPreview(null); setSelectedIds(new Set()); setFileName(file.name); setStage("file");
    try {
      const next = await parseImportFile(file);
      if (generation !== previewGeneration.current) return;
      if (!next.columns.length || !next.rows.length) throw new Error("첫 번째 시트에서 헤더와 거래 행을 찾지 못했습니다.");
      const detected = detectImportMapping(next.columns);
      const exact = exactProfileToAutoApply(profileStore.items, next.columns);
      setParsed(next); setImportBatchId(`file:v1:batch:${crypto.randomUUID()}`);
      setPreview(null); setSelectedIds(new Set());
      setMapping(exact?.bindings ?? detected.mapping);
      setDetectionIssues(exact ? [] : detected.issues.filter((issue) => issue.code === "IMPORT_AMBIGUOUS_COLUMN"));
      setSelectedProfileId(exact?.id ?? "");
      setProfileName(exact?.name ?? "");
      setProfileBindings(exact?.bindings); setManuallyChanged(new Set()); setExplicitlyIgnored(new Set());
      setIsProfileDirty(false); setPage(0); setStage("mapping");
    } catch (error) {
      if (generation === previewGeneration.current) setFileError(error instanceof Error ? error.message : "거래 내역 파일을 읽지 못했습니다.");
    }
  }

  function invalidatePreview() {
    cancelPendingPreviewBuild();
    setPreview(null); setSelectedIds(new Set()); setStage(parsed ? "mapping" : "file");
  }

  function detachProfileKeepingCurrentMapping() {
    setSelectedProfileId("");
    setProfileBindings(undefined);
    setManuallyChanged(mappedSourceColumnKeys(mapping));
    setIsProfileDirty(true);
  }

  function assignSource(assignment: SourceColumnAssignment, target: SourceColumnAssignmentTarget) {
    const result = applySourceColumnAssignment(mapping, assignment.column, target);
    if (!result.ok) { setProfileError("선택한 Rationale 필드는 다른 업로드 열에서 이미 사용 중입니다."); return; }
    invalidatePreview(); setProfileError(""); setMapping(result.mapping); setIsProfileDirty(true);
    const key = columnReferenceKey(assignment.column.reference);
    setManuallyChanged((current) => new Set(current).add(key));
    setExplicitlyIgnored((current) => { const next = new Set(current); if (target === "ignore") next.add(key); else next.delete(key); return next; });
    const touched = new Set<keyof ImportMapping>([...assignment.suggestedTargets, ...(assignment.target === "ignore" ? [] : [assignment.target]), ...(target === "ignore" ? [] : [target])]);
    setDetectionIssues((current) => current.filter((issue) => !issue.field || !touched.has(issue.field)));
  }

  function applyProfile(id: string) {
    invalidatePreview();
    const profile = profileStore.items.find((item) => item.id === id);
    if (!profile) { detachProfileKeepingCurrentMapping(); return; }
    setSelectedProfileId(id);
    setMapping(profile.bindings); setProfileBindings(profile.bindings); setManuallyChanged(new Set()); setExplicitlyIgnored(new Set()); setDetectionIssues([]); setProfileName(profile.name); setIsProfileDirty(false);
  }

  async function reviewCandidates() {
    if (!parsed || !canReview) return;
    const generation = ++previewGeneration.current;
    setBuildingPreview(true); setFileError("");
    try {
      const next = await buildImportPreview(parsed, mapping, { stocks, accounts, existingTrades: existing, targetAccountId, provider, importBatchId });
      if (generation !== previewGeneration.current) return;
      setPreview(next); setPage(0);
      const defaults = next.candidates.length > pageSize ? next.candidates.slice(0, pageSize) : next.candidates;
      setSelectedIds(new Set(defaults.filter((candidate) => candidate.selectedByDefault).map((candidate) => candidate.id)));
      setStage("review");
    } catch { if (generation === previewGeneration.current) setFileError("가져오기 미리보기를 만들지 못했습니다."); }
    finally { if (generation === previewGeneration.current) setBuildingPreview(false); }
  }

  async function saveProfile(mode: "update" | "new") {
    if (!parsed || !profileName.trim() || hasMappingErrors) return;
    const now = new Date().toISOString();
    const selectedProfile = profileStore.items.find((item) => item.id === selectedProfileId);
    if (mode === "update" && (!selectedProfile || !isProfileDirty)) return;
    const duplicateName = hasDuplicateMappingProfileName(profileStore.items, profileName, mode === "update" ? selectedProfileId : undefined);
    if (duplicateName) { setProfileError("같은 이름의 매핑 프로필이 이미 있습니다."); return; }
    const profile: ImportMappingProfile = mode === "update" ? updatedMappingProfile(selectedProfile!, profileName, mapping, parsed.columns, now) : { id: crypto.randomUUID(), name: profileName.trim(), version: 1, bindings: mapping, headerSignature: headerSignature(parsed.columns), createdAt: now, updatedAt: now };
    setProfileError("");
    try {
      await profileStore.replaceAsync(mode === "update" ? profileStore.allItems.map((item) => item.id === profile.id ? profile : item) : [profile, ...profileStore.allItems]);
      setSelectedProfileId(profile.id); setProfileBindings(profile.bindings); setManuallyChanged(new Set()); setExplicitlyIgnored(new Set()); setIsProfileDirty(false);
    } catch { setProfileError("매핑 프로필을 저장하지 못했습니다."); }
  }

  async function deleteProfile() {
    if (!selectedProfileId || !window.confirm(t("이 매핑 프로필을 삭제할까요?"))) return;
    setProfileError("");
    try {
      await profileStore.replaceAsync(profileStore.allItems.filter((profile) => profile.id !== selectedProfileId));
      invalidatePreview();
      detachProfileKeepingCurrentMapping();
    } catch { setProfileError("매핑 프로필을 삭제하지 못했습니다."); }
  }

  function toggleCandidate(id: string) {
    setSelectedIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function selectCandidates(ids: string[]) { setSelectedIds((current) => new Set([...current, ...ids])); }
  function deselectCandidates(ids: string[]) { const removed = new Set(ids); setSelectedIds((current) => new Set([...current].filter((id) => !removed.has(id)))); }

  async function submit() {
    if (!canImport || !preview) return;
    const latest = preflightImport(preview, selectedIds, { existingTrades: existing, accounts });
    if (!latest.ok) return;
    setSaving(true);
    try { await onImport(latest.plan); }
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
          <nav aria-label={t("가져오기 단계")} className="flex gap-2 text-xs">{(["file", "mapping", "review"] as ImportStage[]).map((item, index) => <span key={item} aria-current={stage === item ? "step" : undefined} className={`rounded-full px-3 py-1.5 ${stage === item ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--surface-muted)] text-[var(--muted)]"}`}>{index + 1}. {t(item === "file" ? "파일" : item === "mapping" ? "열 연결" : "거래 검토")}</span>)}</nav>
          <section className="rounded-xl border border-dashed p-6 text-center">
            <FileSpreadsheet className="mx-auto text-[var(--accent)]" />
            <p className="mt-3 text-sm font-medium">{fileName || t("CSV, TSV, XLS 또는 XLSX 파일을 선택하세요")}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">{t("원본 파일과 매핑 프로필은 이 기기에서만 처리되며 동기화나 백업에 포함되지 않습니다.")}</p>
            <label className="mt-4 inline-block cursor-pointer rounded-lg border px-4 py-2 text-sm"><input type="file" accept=".csv,.tsv,.xls,.xlsx,text/csv,text/tab-separated-values,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" disabled={saving} onChange={(event) => void load(event.target.files?.[0])} />{t(fileName ? "다른 파일 선택" : "파일 선택")}</label>
            {fileError && <p role="alert" className="mt-3 text-sm text-red-600">{t(fileError)}</p>}
          </section>

          {parsed && <>
            {stage === "mapping" && <section className="grid gap-4 rounded-xl border p-5 sm:grid-cols-2">
              <label className="text-sm font-medium">{t("증권사 또는 파일 출처")}<input className="mt-2 h-10 w-full rounded-lg border bg-[var(--surface)] px-3" value={provider} onChange={(event) => { invalidatePreview(); setProvider(event.target.value); }} placeholder={t("선택 사항 · 예: 미래에셋")}/></label>
              {mapping.accountName === undefined && <label className="text-sm font-medium">{t("이 거래를 어느 계좌로 가져올까요?")}<select required className="mt-2 h-10 w-full rounded-lg border bg-[var(--surface)] px-3" value={targetAccountId} onChange={(event) => { invalidatePreview(); setTargetAccountId(event.target.value); }}><option value="">{t("계좌 추가 필요")}</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>}
            </section>}

            {stage === "mapping" && <section className="overflow-hidden rounded-xl border">
              <div className="p-5">
              <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-semibold">{t("열 연결")}</h3><p className="mt-1 text-xs text-[var(--muted)]">{t("중복된 헤더도 이름과 출현 순서로 안정적으로 구분합니다.")}</p></div>
                <div className="flex flex-wrap items-end gap-2"><label className="text-xs text-[var(--muted)]">{t("매핑 프로필")}<select className="mt-1 block h-9 min-w-40 rounded-lg border bg-[var(--surface)] px-2 text-sm" value={selectedProfileId} onChange={(event) => applyProfile(event.target.value)}><option value="">{t("프로필 선택")}</option>{matchingProfiles.map(({ profile, match }) => <option key={profile.id} value={profile.id}>{profile.name} · {t(match === "exact" ? "정확히 일치" : "호환 가능")}</option>)}</select></label></div>
              </div>
              </div>
              <SourceColumnMappingTable assignments={assignments} onAssign={assignSource} />
              <div className="grid gap-4 border-t p-5 md:grid-cols-2">
                <section aria-labelledby="mapping-coverage"><div className="flex items-center justify-between"><h4 id="mapping-coverage" className="text-sm font-semibold">{t("필수 연결")}</h4><span className="text-xs text-[var(--muted)]">{t("필수 {complete}/{total}", { complete: coverage.filter((item) => item.complete).length, total: coverage.length })}</span></div><ul className="mt-2 grid gap-1 text-sm">{coverage.map((item) => <li key={item.id}>{item.complete ? "✓" : "○"} {t(item.label)}</li>)}</ul></section>
                <details open className="rounded-lg bg-[var(--surface-muted)] p-3"><summary className="cursor-pointer text-sm font-semibold">{t("정확도 및 안전성 확인")}</summary><div role="status" className="mt-2 space-y-1 text-xs text-[var(--muted)]">{advisories.map((code) => <p key={code}>{t(advisoryMessage(code))}</p>)}</div></details>
              </div>
              {mappingDetailIssues.length > 0 && <div role={mappingDetailIssues.some((issue) => issue.severity === "error") ? "alert" : undefined} className="space-y-1 border-t p-4 text-sm">{mappingDetailIssues.map((issue, index) => <p key={`${issue.code}-${issue.field}-${index}`} className={issue.severity === "error" ? "text-red-600" : "text-amber-700"}>{localizeIssue(issue, t, formatNumber)}</p>)}</div>}
              <div className="flex flex-wrap items-end gap-2 border-t p-5"><label className="text-xs text-[var(--muted)]">{t("프로필 이름")}<input className="mt-1 block h-9 rounded-lg border bg-[var(--surface)] px-3 text-sm" value={profileName} onChange={(event) => { setProfileName(event.target.value); setIsProfileDirty(true); }} /></label>{selectedProfileId && <button type="button" disabled={!isProfileDirty || !profileName.trim() || hasMappingErrors} onClick={() => void saveProfile("update")} className="h-9 rounded-lg border px-3 text-sm disabled:opacity-50">{t("프로필 업데이트")}</button>}<button type="button" disabled={!profileName.trim() || hasMappingErrors} onClick={() => void saveProfile("new")} className="h-9 rounded-lg border px-3 text-sm disabled:opacity-50">{t("새 프로필로 저장")}</button>{selectedProfileId && <button type="button" aria-label={t("프로필 삭제")} onClick={() => void deleteProfile()} className="destructive-icon-action grid size-9 place-items-center rounded-lg border"><Trash2 size={15}/></button>}{isProfileDirty && <span className="pb-2 text-xs text-amber-700">{t("저장되지 않은 변경")}</span>}</div>
              {profileError && <p role="alert" className="mt-2 text-sm text-red-600">{t(profileError)}</p>}
            </section>}

            {stage === "review" && preview && <><div className="flex items-center justify-between rounded-xl border p-4"><div><p className="text-sm font-medium">{t("열 연결 완료")}</p><p className="text-xs text-[var(--muted)]">{t("{mapped}개 필드 연결 · {ignored}개 열 제외", { mapped: Object.keys(mapping).length, ignored: assignments.filter((item) => item.target === "ignore").length })}</p></div><button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setStage("mapping")}>{t("열 연결로 돌아가기")}</button></div><section className="overflow-hidden rounded-xl border">
              <div className="flex flex-wrap items-center justify-between gap-2 p-4"><div><h3 className="font-semibold">{t("가져오기 후보")}</h3><p className="mt-1 text-xs text-[var(--muted)]">{t("가능한 중복과 삭제된 기록은 기본 선택되지 않으며 직접 확인해야 합니다.")}</p></div>{preview && <div className="flex flex-wrap gap-2 text-xs">{(Object.keys(statusLabels) as ImportCandidateStatus[]).map((status) => <span key={status} className="rounded-full bg-[var(--surface-muted)] px-2 py-1">{t(statusLabels[status])} {formatNumber(preview.summary[status])}</span>)}<span className="rounded-full bg-[var(--accent-soft)] px-2 py-1 text-[var(--accent)]">{t("전체 선택 {count}건", { count: formatNumber(selectedIds.size) })}</span><span>{t("현재 페이지 선택 {count}건", { count: formatNumber(selectedOnPage) })}</span><span>{t("다른 페이지 선택 {count}건", { count: formatNumber(selectedOutsidePage) })}</span><span>{t("차단 {count}건", { count: formatNumber(blockedCount) })}</span></div>}</div>
              {preview && <div className="flex flex-wrap gap-2 border-t p-3"><button type="button" className="rounded-md border px-3 py-1.5 text-xs" onClick={() => selectCandidates(pageCandidates.filter((item) => item.status === "ready").map((item) => item.id))}>{t("이 페이지의 추가 가능 항목 선택")}</button><button type="button" className="rounded-md border px-3 py-1.5 text-xs" onClick={() => deselectCandidates(pageCandidates.map((item) => item.id))}>{t("이 페이지 선택 해제")}</button><button type="button" className="rounded-md border px-3 py-1.5 text-xs" onClick={() => selectCandidates(preview.candidates.filter((item) => item.status === "ready").map((item) => item.id))}>{t("모든 추가 가능 항목 선택")}</button><button type="button" className="rounded-md border px-3 py-1.5 text-xs" onClick={() => setSelectedIds(new Set())}>{t("전체 선택 해제")}</button></div>}
              <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-[var(--surface-muted)]"><tr><th className="px-3 py-2">{t("선택")}</th><th className="px-3 py-2">{t("행")}</th><th className="px-3 py-2">{t("상태")}</th><th className="px-3 py-2">{t("거래 일시")}</th><th className="px-3 py-2">{t("종목")}</th><th className="px-3 py-2">{t("유형")}</th><th className="px-3 py-2">{t("수량")}</th><th className="px-3 py-2">{t("체결 가격")}</th><th className="px-3 py-2">{t("검토")}</th></tr></thead><tbody>{pageCandidates.map((candidate) => { const selectable = candidate.action !== "none"; return <tr key={candidate.id} className="border-t align-top"><td className="px-3 py-2"><input aria-label={t("행 {row} 선택", { row: formatNumber(candidate.row) })} type="checkbox" disabled={!selectable} checked={selectedIds.has(candidate.id)} onChange={() => toggleCandidate(candidate.id)} /></td><td className="px-3 py-2">{formatNumber(candidate.row)}</td><td className="whitespace-nowrap px-3 py-2">{t(statusLabels[candidate.status])}</td><td className="whitespace-nowrap px-3 py-2 tabular-nums">{candidate.trade?.tradedAt ?? "—"}</td><td className="whitespace-nowrap px-3 py-2">{candidate.trade?.stockName ?? "—"}</td><td className="px-3 py-2">{candidate.trade ? t(candidate.trade.tradeType) : "—"}</td><td className="px-3 py-2 tabular-nums">{candidate.trade ? formatNumber(candidate.trade.quantity) : "—"}</td><td className="px-3 py-2 tabular-nums">{candidate.trade ? formatNumber(candidate.trade.price) : "—"}</td><td className="min-w-56 px-3 py-2">{candidate.issues.map((issue, index) => <p key={`${issue.code}-${index}`} className={issue.severity === "error" ? "text-red-600" : issue.severity === "warning" ? "text-amber-700" : "text-[var(--muted)]"}>{localizeIssue(issue, t, formatNumber)}</p>)}{candidate.trade && <details className="mt-1"><summary className="cursor-pointer">{t("세부 정보")}</summary><p>{t("계좌")}: {candidate.trade.accountName}</p><p>{t("통화")}: {candidate.trade.currency} · {t("환율")}: {formatNumber(candidate.trade.exchangeRate)}</p><p>{t("수수료")}: {formatNumber(candidate.trade.fee)} · {t("세금")}: {formatNumber(candidate.trade.tax)}</p><p>{t("출처")}: {candidate.execution?.provider || t("일반 파일")}</p>{candidate.execution?.externalExecutionId && <p>{t("체결 ID")}: {candidate.execution.externalExecutionId}</p>}{candidate.matchedTradeIds.length > 0 && <p>{t("연결된 기존 기록")}: {candidate.matchedTradeIds.join(", ")}</p>}</details>}</td></tr>; })}</tbody></table></div>
              {preview && <nav aria-label={t("가져오기 후보 페이지")} className="flex items-center justify-between border-t p-3"><button type="button" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-50">{t("이전")}</button><span aria-live="polite" className="text-xs">{t("현재 페이지 {current} / {total}", { current: formatNumber(page + 1), total: formatNumber(pageCount) })}</span><button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-50">{t("다음")}</button></nav>}
            </section></>}

            {stage === "review" && preflight && !preflight.ok && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{preflight.issues.map((issue) => <p key={issue.code}>{localizeIssue(issue, t, formatNumber)}</p>)}</div>}
          </>}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t bg-[var(--surface)] p-4"><p className="text-xs text-[var(--muted)]">{stage === "review" ? t("저장은 전체 원장을 다시 검증한 뒤 한 번에 수행됩니다.") : t("필수 열을 연결한 뒤 거래 후보를 검토할 수 있습니다.")}</p><div className="flex gap-2"><button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">{t("취소")}</button>{stage === "mapping" && <button type="button" disabled={!canReview} onClick={() => void reviewCandidates()} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm text-white disabled:opacity-50">{buildingPreview ? t("거래 후보를 만들고 있습니다...") : t("거래 후보 검토")}</button>}{stage === "review" && <button type="button" disabled={!canImport} onClick={() => void submit()} className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm text-white disabled:opacity-50">{saving ? t("저장 중...") : t("{inserted}건 추가 · {restored}건 복원", { inserted: formatNumber(preflight?.plan.insertedTrades.length ?? 0), restored: formatNumber(preflight?.plan.restoredTradeIds.length ?? 0) })}</button>}</div></div>
      </div>
    </div>
  );
}

function localizeIssue(issue: ImportIssue, t: (key: string, params?: Record<string, string | number>) => string, formatNumber: (value: number) => string) {
  const labels: Record<string, string> = {
    IMPORT_AMBIGUOUS_COLUMN: "자동으로 연결할 수 없는 열이 있습니다. 직접 선택해 주세요.", IMPORT_COLUMN_MISSING: "저장된 매핑의 열을 현재 파일에서 찾을 수 없습니다.", IMPORT_COLUMN_COLLISION: "하나의 열을 여러 필드에 동시에 연결할 수 없습니다.", IMPORT_REQUIRED_COLUMN: "필수 열을 연결해 주세요.", IMPORT_INSTRUMENT_COLUMN: "종목코드 또는 종목명 열을 연결해 주세요.",
    IMPORT_EXACT_DUPLICATE: "이미 가져온 동일 체결입니다.", IMPORT_POSSIBLE_DUPLICATE: "기존 기록과 같은 체결일 가능성이 있습니다.", IMPORT_PREVIOUSLY_DELETED: "이전에 삭제한 동일 기록입니다. 선택하면 기존 기록을 그대로 복원합니다.", IMPORT_AMBIGUOUS_IDENTICAL_ROW: "파일 안에 동일한 체결 행이 있어 직접 포함 여부를 확인해야 합니다.", IMPORT_BATCH_EXACT_DUPLICATE: "같은 파일에 동일한 체결 ID와 동일한 내용이 반복되어 한 건만 가져옵니다.", IMPORT_BATCH_SOURCE_IDENTITY_CONFLICT: "같은 파일의 동일한 체결 ID에 서로 다른 내용이 있어 모든 관련 행을 가져올 수 없습니다.", IMPORT_SOURCE_CONFLICT: "같은 원본 체결 ID가 기존 기록과 다른 값을 가집니다.", IMPORT_SOURCE_IDENTITY_AMBIGUOUS: "같은 원본 식별자를 가진 기존 기록이 여러 개여서 가져올 수 없습니다.", IMPORT_PREVIEW_STALE: "원장이 변경되어 미리보기가 오래되었습니다. 후보를 다시 확인해 주세요.", IMPORT_TIME_MISSING: "거래 시간이 없어 오전 9시로 해석했습니다.", IMPORT_TIME_CONFLICT: "거래일시의 시간과 별도 시간 열의 값이 서로 다릅니다.", IMPORT_UNSUPPORTED_TIMEZONE: "일반 파일 가져오기는 시간대가 포함된 값을 지원하지 않습니다.", IMPORT_AMBIGUOUS_INTRADAY_ORDER: "같은 날짜의 거래 순서를 확정할 수 없어 시간을 입력해야 합니다.",
    IMPORT_DATE_MISSING: "거래일이 없습니다.", IMPORT_AMBIGUOUS_DATE: "날짜가 모호합니다. YYYY-MM-DD 형식을 사용해 주세요.", IMPORT_INVALID_DATE: "거래일 형식을 확인해 주세요.", IMPORT_INVALID_TIME: "거래 시간을 확인해 주세요.", IMPORT_INVALID_NUMBER: "숫자 형식을 확인해 주세요.", IMPORT_NON_POSITIVE_NUMBER: "수량과 체결가는 0보다 커야 합니다.", IMPORT_NEGATIVE_NUMBER: "수수료와 세금은 0 이상이어야 합니다.", IMPORT_INVALID_SIDE: "매수/매도 구분을 확인해 주세요.", IMPORT_INVALID_CURRENCY: "지원하지 않는 통화입니다.", IMPORT_CURRENCY_CONFLICT: "파일 통화와 등록된 종목 통화가 다릅니다.", IMPORT_CURRENCY_FALLBACK: "통화가 없어 등록된 종목 통화를 사용했습니다.", IMPORT_EXCHANGE_RATE_FALLBACK: "환율이 없어 현재 기본 환율을 사용했습니다.",
    IMPORT_AMBIGUOUS_INSTRUMENT: "종목 연결 후보가 여러 개입니다.", IMPORT_INSTRUMENT_CONFLICT: "종목코드와 종목명이 서로 다른 종목을 가리킵니다.", IMPORT_INSTRUMENT_NOT_FOUND: "연결할 종목을 찾을 수 없습니다.", IMPORT_AMBIGUOUS_ACCOUNT: "같은 이름의 계좌가 여러 개입니다.", IMPORT_ACCOUNT_NOT_FOUND: "등록되지 않은 계좌입니다.", IMPORT_ARCHIVED_ACCOUNT: "보관된 계좌로는 가져올 수 없습니다.", IMPORT_ACCOUNT_REQUIRED: "가져올 대상 계좌를 선택해 주세요.", IMPORT_ROW_REJECTED: "가져오기 행을 확인해 주세요.", IMPORT_NOTHING_SELECTED: "가져올 거래를 하나 이상 선택해 주세요.", IMPORT_LEDGER_CONFLICT: "선택한 거래가 원장 사전 검증을 통과하지 못했습니다.",
  };
  const message = t(labels[issue.code] ?? "가져오기 행을 확인해 주세요.");
  const duplicateOf = issue.code === "IMPORT_BATCH_EXACT_DUPLICATE" && typeof issue.details?.duplicateOfRow === "number" ? t("대표 행: {row}", { row: formatNumber(issue.details.duplicateOfRow) }) : "";
  const reason = issue.code === "IMPORT_LEDGER_CONFLICT" && typeof issue.details?.reason === "string" ? translateTradeText(issue.details.reason, t, formatNumber) : "";
  return [message, duplicateOf, reason].filter(Boolean).join(" ");
}

function advisoryMessage(code: MappingAdvisoryCode) {
  const messages: Record<MappingAdvisoryCode, string> = {
    MAPPING_TIME_UNMAPPED: "시간 열이 없으면 거래일에 포함된 시간을 사용하고, 없을 때는 오전 9시로 처리합니다.",
    MAPPING_FEE_UNMAPPED: "수수료 열이 없으면 수수료를 0으로 계산합니다.",
    MAPPING_TAX_UNMAPPED: "세금 열이 없으면 세금을 0으로 계산합니다.",
    MAPPING_CURRENCY_UNMAPPED: "통화 열이 없으면 등록된 종목 통화를 사용합니다.",
    MAPPING_EXCHANGE_RATE_UNMAPPED: "환율 열이 없으면 외화 거래에 기존 환율 기준을 사용할 수 있습니다.",
    MAPPING_ACCOUNT_TARGET_APPLIED: "계좌 열이 없으면 모든 행을 선택한 대상 계좌로 가져옵니다.",
    MAPPING_EXECUTION_ID_UNMAPPED: "체결 ID 열이 없으면 재가져오기 중복 판단에 보수적인 대체 식별을 사용합니다.",
  };
  return messages[code];
}
