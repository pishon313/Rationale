import type { ImportMapping, ParsedTabularFile, PreparedBrokerLedgerRow } from "../import-types";

export type FileImportAdapterId = "generic-tabular-v1" | "mirae-account-ledger-v1";
export type FileAdapterDetection = { match: "none" } | {
  match: "suggested";
  adapterId: FileImportAdapterId;
  confidence: "exact" | "compatible";
  reasonCode: string;
};

export type FileAdapterPreparationContext = {
  importBatchId: string;
  provider: string | null;
  targetAccountId: string;
};

export type FileImportAdapter = {
  id: Exclude<FileImportAdapterId, "generic-tabular-v1">;
  label: string;
  suggestionTitle: string;
  suggestionDescription: string;
  activeDescription: string;
  applyLabel: string;
  detect: (parsed: ParsedTabularFile) => FileAdapterDetection;
  defaultMapping: (parsed: ParsedTabularFile) => ImportMapping;
  prepare: (parsed: ParsedTabularFile, context: FileAdapterPreparationContext) => PreparedBrokerLedgerRow[];
};
