import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauriApp } from "./local-repository";

export async function openExternalUrl(url: string) {
  if (isTauriApp()) {
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
