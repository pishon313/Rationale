"use client";

import { invoke } from "@tauri-apps/api/core";
import { AlertCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import { getPersistenceSnapshot, isTauriApp, subscribePersistence } from "@/lib/local-repository";
import { createBackupCandidate } from "./backup-service";

export const automaticBackupStatusEvent = "tradejournal:automatic-backup";
export const automaticBackupDebounceMs = 30_000;

export type AutomaticBackupCounts = {
  accounts: number;
  stocks: number;
  plans: number;
  trades: number;
  observations: number;
  reviews: number;
  rules: number;
  notes: number;
};

export type AutomaticBackupErrorCode =
  | "AUTOMATIC_BACKUP_STATUS_FAILED"
  | "AUTOMATIC_BACKUP_SOURCE_CORRUPTED"
  | "AUTOMATIC_BACKUP_SOURCE_COUNT_MISMATCH"
  | "AUTOMATIC_BACKUP_VALIDATION_FAILED"
  | "AUTOMATIC_BACKUP_WRITE_VERIFICATION_FAILED";

export type AutomaticBackupStatus = {
  path: string | null;
  createdAtMs: number | null;
  backupNeeded: boolean;
  created: boolean;
  verified: boolean;
  counts: AutomaticBackupCounts | null;
  ignoredInvalidFileCount: number;
  errorCode?: AutomaticBackupErrorCode | null;
};

const deprecatedStatusKeys = ["tradejournal.last-automatic-backup-at", "tradejournal.last-automatic-backup-path"];
const emptyStatus: AutomaticBackupStatus = { path: null, createdAtMs: null, backupNeeded: true, created: false, verified: false, counts: null, ignoredInvalidFileCount: 0, errorCode: null };

export function AutomaticBackup() {
  const { t } = useI18n();
  const [errorCode, setErrorCode] = useState<AutomaticBackupErrorCode | null>(null);

  useEffect(() => {
    if (!isTauriApp()) return;
    let active = true;
    let inFlight = false;
    let queuedAfterFlight = false;
    let timer: number | null = null;
    let latestStatus: AutomaticBackupStatus | null = null;
    let lastScheduledSave = getPersistenceSnapshot().lastSavedAt;

    const fail = (error: unknown, phase: "status" | "candidate" | "write") => {
      if (!active) return;
      const code = automaticBackupErrorCode(error, phase);
      setErrorCode(code);
      const failed = { ...(latestStatus ?? emptyStatus), created: false, errorCode: code };
      latestStatus = failed;
      publishStatus(failed);
    };

    const attempt = async () => {
      if (!active) return;
      if (inFlight) { queuedAfterFlight = true; return; }
      inFlight = true;
      let phase: "status" | "candidate" | "write" = "status";
      try {
        const status = await invoke<AutomaticBackupStatus>("get_automatic_backup_status");
        if (!active) return;
        latestStatus = { ...status, errorCode: null };
        publishStatus(latestStatus);
        for (const key of deprecatedStatusKeys) {
          try { localStorage.removeItem(key); } catch { /* Deprecated cache cleanup must not block backups. */ }
        }
        if (!status.backupNeeded) { setErrorCode(null); return; }

        phase = "candidate";
        const candidate = await createBackupCandidate();
        if (!active) return;
        phase = "write";
        const next = await invoke<AutomaticBackupStatus>("ensure_automatic_backup", {
          content: JSON.stringify(candidate.backup, null, 2),
          sourceCounts: candidate.sourceCounts,
        });
        if (!active) return;
        latestStatus = { ...next, errorCode: null };
        setErrorCode(null);
        publishStatus(latestStatus);
      } catch (error) {
        fail(error, phase);
      } finally {
        inFlight = false;
        if (active && queuedAfterFlight) {
          queuedAfterFlight = false;
          void attempt();
        }
      }
    };

    const unsubscribe = subscribePersistence(() => {
      const snapshot = getPersistenceSnapshot();
      if (snapshot.pendingWrites !== 0 || !snapshot.lastSavedAt || snapshot.lastSavedAt === lastScheduledSave) return;
      lastScheduledSave = snapshot.lastSavedAt;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void attempt();
      }, automaticBackupDebounceMs);
    });

    void attempt();
    return () => {
      active = false;
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  if (!errorCode) return null;
  return <aside className="fixed bottom-4 right-4 z-[85] max-w-md rounded-xl border border-amber-300 bg-[var(--surface)] p-4 shadow-2xl" role="alert">
    <div className="flex items-start gap-3">
      <AlertCircle size={19} className="mt-0.5 shrink-0 text-amber-600" />
      <div className="min-w-0 flex-1"><p className="font-semibold text-amber-700 dark:text-amber-300">{t("자동 백업 오류")}</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t(automaticBackupErrorMessage(errorCode))}</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("기존 자동 백업은 그대로 보존되었습니다.")}</p></div>
      <button type="button" aria-label={t("닫기")} onClick={() => setErrorCode(null)}><X size={16} /></button>
    </div>
  </aside>;
}

function publishStatus(status: AutomaticBackupStatus) {
  window.dispatchEvent(new CustomEvent<AutomaticBackupStatus>(automaticBackupStatusEvent, { detail: status }));
}

function automaticBackupErrorCode(error: unknown, phase: "status" | "candidate" | "write"): AutomaticBackupErrorCode {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  if (detail.includes("AUTOMATIC_BACKUP_SOURCE_CORRUPTED")) return "AUTOMATIC_BACKUP_SOURCE_CORRUPTED";
  if (detail.includes("AUTOMATIC_BACKUP_SOURCE_COUNT_MISMATCH") || detail.includes("AUTOMATIC_BACKUP_SOURCE_COUNTS_INVALID")) return "AUTOMATIC_BACKUP_SOURCE_COUNT_MISMATCH";
  if (detail.includes("AUTOMATIC_BACKUP_VALIDATION") || detail.includes("AUTOMATIC_BACKUP_INVALID_JSON") || detail.includes("AUTOMATIC_BACKUP_INVALID_STRUCTURE") || detail.includes("AUTOMATIC_BACKUP_UNSUPPORTED_VERSION")) return "AUTOMATIC_BACKUP_VALIDATION_FAILED";
  if (phase === "status") return "AUTOMATIC_BACKUP_STATUS_FAILED";
  if (phase === "candidate") return "AUTOMATIC_BACKUP_VALIDATION_FAILED";
  return "AUTOMATIC_BACKUP_WRITE_VERIFICATION_FAILED";
}

function automaticBackupErrorMessage(code: AutomaticBackupErrorCode) {
  return ({
    AUTOMATIC_BACKUP_STATUS_FAILED: "자동 백업 상태를 확인하지 못했습니다.",
    AUTOMATIC_BACKUP_SOURCE_CORRUPTED: "손상된 데이터를 먼저 복구해야 완전한 자동 백업을 만들 수 있습니다.",
    AUTOMATIC_BACKUP_SOURCE_COUNT_MISMATCH: "저장 원본과 백업 항목 수가 달라 자동 백업을 중단했습니다.",
    AUTOMATIC_BACKUP_VALIDATION_FAILED: "백업 데이터 검증에 실패하여 자동 백업을 중단했습니다.",
    AUTOMATIC_BACKUP_WRITE_VERIFICATION_FAILED: "자동 백업 파일을 안전하게 기록하고 검증하지 못했습니다.",
  } as const)[code];
}
