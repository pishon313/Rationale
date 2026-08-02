"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { isTauriApp, reportPersistenceError } from "@/lib/local-repository";
import { createBackupPayload } from "./backup-service";

export const lastAutomaticBackupKey = "tradejournal.last-automatic-backup-at";
export const lastAutomaticBackupPathKey = "tradejournal.last-automatic-backup-path";
const oneDay = 24 * 60 * 60 * 1000;

export function AutomaticBackup() {
  useEffect(() => {
    if (!isTauriApp()) return;
    const last = Date.parse(localStorage.getItem(lastAutomaticBackupKey) ?? "");
    if (Number.isFinite(last) && Date.now() - last < oneDay) return;
    let active = true;
    void (async () => {
      try {
        const backup = await createBackupPayload();
        const path = await invoke<string>("write_automatic_backup", { content: JSON.stringify(backup, null, 2) });
        if (!active) return;
        localStorage.setItem(lastAutomaticBackupKey, backup.exportedAt);
        localStorage.setItem(lastAutomaticBackupPathKey, path);
        window.dispatchEvent(new Event("tradejournal:automatic-backup"));
      } catch (error) {
        reportPersistenceError(error, "자동 백업을 저장하지 못했습니다.");
      }
    })();
    return () => { active = false; };
  }, []);
  return null;
}
