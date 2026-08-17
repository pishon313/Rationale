import type { ParsedTabularFile } from "../import-types";
import type { FileAdapterDetection, FileImportAdapter, FileImportAdapterId } from "./adapter-types";
import { miraeAccountLedgerAdapter } from "./mirae-account-ledger-v1";

export const fileImportAdapterRegistry: readonly FileImportAdapter[] = [miraeAccountLedgerAdapter];

export function detectSuggestedFileAdapter(parsed: ParsedTabularFile): FileAdapterDetection {
  for (const adapter of fileImportAdapterRegistry) {
    const detection = adapter.detect(parsed);
    if (detection.match === "suggested") return detection;
  }
  return { match: "none" };
}

export function fileImportAdapterById(id: FileImportAdapterId | "") {
  return fileImportAdapterRegistry.find((adapter) => adapter.id === id);
}
