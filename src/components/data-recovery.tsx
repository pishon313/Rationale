"use client";

import { AlertTriangle, Download, HardDriveDownload, RotateCcw } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useI18n } from "@/i18n/i18n-provider";
import { exportQuarantinedData, getCorruptionSnapshot, isTauriApp, resetCorruptedCollections, subscribeCorruption } from "@/lib/local-repository";

export function DataRecovery() {
  const { t } = useI18n();
  const snapshot = useSyncExternalStore(subscribeCorruption, getCorruptionSnapshot, getCorruptionSnapshot);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  if (!snapshot.collections.length) return null;
  const affected = snapshot.collections.reduce((sum, item) => sum + item.affectedRecordCount, 0);
  const names = snapshot.collections.map((item) => collectionLabel(item.collection)).join(", ");

  async function resetAffected() {
    if (!window.confirm(t("영향을 받은 컬렉션만 빈 상태로 초기화할까요? 격리된 원본은 삭제되지 않습니다."))) return;
    setWorking(true); setError("");
    try { await resetCorruptedCollections(snapshot.collections.map((item) => item.collection)); }
    catch { setError(t("초기화하지 못했습니다. 손상 데이터 보호 상태를 유지합니다.")); }
    finally { setWorking(false); }
  }

  async function exportData() {
    if (!window.confirm(t("진단 파일에는 투자 기록과 메모가 포함될 수 있습니다. 안전한 위치에 저장할까요?"))) return;
    setWorking(true); setError("");
    try {
      const content = await exportQuarantinedData();
      const filename = `rationale-corrupt-data-${new Date().toISOString().slice(0, 10)}.json`;
      if (isTauriApp()) {
        const path = await save({ defaultPath: filename, filters: [{ name: "Rationale diagnostic data", extensions: ["json"] }] });
        if (path) await writeTextFile(path, content);
      } else {
        const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
      }
    } catch { setError(t("격리된 원본을 내보내지 못했습니다.")); }
    finally { setWorking(false); }
  }

  return <aside className="fixed inset-x-4 top-4 z-[90] mx-auto max-w-3xl rounded-xl border border-amber-400 bg-[var(--surface)] p-4 shadow-2xl" role="alert" aria-live="assertive"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={20} /><div className="min-w-0 flex-1"><h2 className="font-semibold">{t("손상된 로컬 데이터가 발견됐습니다")}</h2><p className="mt-1 text-sm leading-6 text-[var(--muted)]">{t("원본은 별도 격리 영역에 보존했습니다. 복구 방법을 선택하기 전까지 영향을 받은 컬렉션의 저장이 제한됩니다.")}</p><dl className="mt-2 grid gap-1 text-xs text-[var(--muted)] sm:grid-cols-2"><div><dt className="inline font-medium text-[var(--foreground)]">{t("영향 범위")}: </dt><dd className="inline">{names}</dd></div><div><dt className="inline font-medium text-[var(--foreground)]">{t("손상 항목")}: </dt><dd className="inline">{affected}{t("개")}</dd></div><div><dt className="inline font-medium text-[var(--foreground)]">{t("저장소")}: </dt><dd className="inline">{snapshot.collections.some((item) => item.source === "sqlite") ? "Mac SQLite" : "Browser localStorage"}</dd></div></dl>{error && <p className="mt-2 text-xs text-red-600">{error}</p>}<div className="mt-3 flex flex-wrap gap-2"><a href="/settings#data-backup" className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs text-white"><HardDriveDownload size={14} />{t("백업에서 복원")}</a><button type="button" disabled={working} onClick={() => void resetAffected()} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs disabled:opacity-50"><RotateCcw size={14} />{t("영향 받은 데이터만 비우기")}</button><button type="button" disabled={working} onClick={() => void exportData()} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs disabled:opacity-50"><Download size={14} />{t("격리 원본 내보내기")}</button></div></div></div></aside>;
}

function collectionLabel(collection: string) {
  return ({ accounts: "계좌", stocks: "종목", plans: "매수 계획", trades: "매매", observations: "관찰 기록", reviews: "회고", rules: "투자 원칙", notes: "Note", "portfolio-plan-state": "포트폴리오 계획 상태", "portfolio-plan-revisions": "포트폴리오 계획 리비전", "portfolio-allocation-groups": "포트폴리오 Allocation Group", "portfolio-allocation-targets": "포트폴리오 배분 대상", "language-preferences": "언어 설정", "dashboard-notes": "대시보드 메모", "earnings-events": "실적 발표 일정", preferences: "통화 설정", "exchange-rates": "환율", "restore-snapshots": "복원 안전 사본", "trade-ledger-reset-snapshots": "매매 원장 초기화 되돌리기", "import-mapping-profiles": "가져오기 매핑 프로필" } as Record<string, string>)[collection] ?? collection;
}
