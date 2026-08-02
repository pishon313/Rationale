"use client";

import { AlertCircle, Check, LoaderCircle, RotateCcw, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import { clearPersistenceError, getPersistenceSnapshot, retryLastSave, subscribePersistence } from "@/lib/local-repository";

export function PersistenceStatus() {
  const { t } = useI18n();
  const status = useSyncExternalStore(subscribePersistence, getPersistenceSnapshot, getPersistenceSnapshot);

  if (status.error) {
    return <div className="fixed bottom-4 right-4 z-[80] max-w-md rounded-xl border border-red-300 bg-[var(--surface)] p-4 shadow-2xl" role="alert">
      <div className="flex items-start gap-3">
        <AlertCircle size={19} className="mt-0.5 shrink-0 text-red-600" />
        <div className="min-w-0 flex-1"><p className="font-semibold text-red-700 dark:text-red-300">{t("저장 오류")}</p><p className="mt-1 break-words text-xs leading-5 text-[var(--muted)]">{status.error}</p></div>
        <button type="button" aria-label={t("닫기")} onClick={clearPersistenceError}><X size={16} /></button>
      </div>
      {status.canRetry && <button type="button" onClick={() => void retryLastSave().catch(() => undefined)} className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"><RotateCcw size={14} />{t("재시도")}</button>}
    </div>;
  }

  if (status.pendingWrites > 0) return <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]"><LoaderCircle size={14} className="animate-spin" />{t("저장 중")}</span>;
  if (status.lastSavedAt) return <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]"><Check size={14} className="text-emerald-600" />{t("저장됨")}</span>;
  return null;
}
