"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { isTauriApp, reportPersistenceError } from "@/lib/local-repository";
import { createBackupPayload } from "./backup-service";

export const automaticBackupStatusEvent = "tradejournal:automatic-backup";
export type AutomaticBackupStatus = { path: string | null; createdAtMs: number | null; backupNeeded: boolean; created: boolean };
const deprecatedStatusKeys = ["tradejournal.last-automatic-backup-at", "tradejournal.last-automatic-backup-path"];

export function AutomaticBackup() {
  useEffect(() => {
    if (!isTauriApp()) return;
    let active = true;
    void (async () => {
      let status: AutomaticBackupStatus;
      try {
        status = await invoke<AutomaticBackupStatus>("get_automatic_backup_status");
        if (!active) return;
        publishStatus(status);
        for (const key of deprecatedStatusKeys) {
          try { localStorage.removeItem(key); } catch { /* Deprecated cache cleanup must not block backups. */ }
        }
      } catch (error) {
        reportPersistenceError(error, "자동 백업 상태를 확인하지 못했습니다.");
        return;
      }
      if (!status.backupNeeded) return;
      try {
        const backup = await createBackupPayload();
        const next = await invoke<AutomaticBackupStatus>("ensure_automatic_backup", { content: JSON.stringify(backup, null, 2) });
        if (active) publishStatus(next);
      } catch (error) {
        reportPersistenceError(error, "자동 백업을 저장하지 못했습니다.");
      }
    })();
    return () => { active = false; };
  }, []);
  return null;
}

function publishStatus(status: AutomaticBackupStatus) {
  window.dispatchEvent(new CustomEvent<AutomaticBackupStatus>(automaticBackupStatusEvent, { detail: status }));
}
