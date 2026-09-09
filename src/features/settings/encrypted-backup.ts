import { invoke } from "@tauri-apps/api/core";
import { validateBackupPayload, type ValidatedBackup } from "./backup";
import type { BackupV5, BackupV6, BackupV7 } from "./backup-service";

export const encryptedBackupFormat = "rationale-encrypted-backup";
export const encryptedBackupExtension = "rationale-backup";
export const minimumBackupPasswordLength = 10;

type EncryptedBackupHeader = {
  format: typeof encryptedBackupFormat;
  formatVersion: number;
};

export type SelectedBackup =
  | { kind: "plaintext"; backup: ValidatedBackup }
  | { kind: "encrypted"; content: string };

export function parseSelectedBackup(content: string, filename = ""): SelectedBackup {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error(filename.endsWith(`.${encryptedBackupExtension}`) ? "INVALID_ENCRYPTED_BACKUP" : "INVALID_BACKUP_FILE");
  }

  if (isEncryptedBackupHeader(value)) {
    if (value.formatVersion !== 1) throw new Error("UNSUPPORTED_ENCRYPTED_BACKUP_VERSION");
    return { kind: "encrypted", content };
  }
  if (filename.endsWith(`.${encryptedBackupExtension}`)) throw new Error("INVALID_ENCRYPTED_BACKUP");
  return { kind: "plaintext", backup: validateBackupPayload(value) };
}

export async function encryptBackupPayload(backup: BackupV5 | BackupV6 | BackupV7, password: string) {
  return invoke<string>("encrypt_backup", { content: JSON.stringify(backup), password });
}

export async function decryptBackupPayload(content: string, password: string) {
  const plaintext = await invoke<string>("decrypt_backup", { container: content, password });
  try {
    return validateBackupPayload(JSON.parse(plaintext));
  } catch {
    throw new Error("DECRYPTED_BACKUP_INVALID");
  }
}

export function validateNewBackupPassword(password: string, confirmation: string) {
  if (password.length < minimumBackupPasswordLength) return "PASSWORD_TOO_SHORT";
  if (password !== confirmation) return "PASSWORD_MISMATCH";
  return null;
}

export function encryptedBackupErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : String(error);
  if (code.includes("UNSUPPORTED_ENCRYPTED_BACKUP_VERSION") || code.includes("UNSUPPORTED_ENCRYPTED_BACKUP_FORMAT")) {
    return "지원하지 않는 암호화 백업 버전입니다.";
  }
  if (code.includes("DECRYPTION_FAILED")) {
    return "백업을 복호화할 수 없습니다. 비밀번호가 잘못되었거나 파일이 손상되었을 수 있습니다.";
  }
  if (code.includes("INVALID_ENCRYPTED_BACKUP")) return "올바른 Rationale 암호화 백업 파일이 아닙니다.";
  return "암호화 백업을 처리하지 못했습니다.";
}

function isEncryptedBackupHeader(value: unknown): value is EncryptedBackupHeader {
  return typeof value === "object" && value !== null
    && "format" in value && value.format === encryptedBackupFormat
    && "formatVersion" in value && typeof value.formatVersion === "number";
}
