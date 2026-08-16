import type { Currency } from "@/domain/currency";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";

export const importFields = [
  "tradedAt", "time", "ticker", "stockName", "tradeType", "quantity", "price", "grossAmount", "fee", "tax",
  "currency", "exchangeRate", "accountName", "externalExecutionId", "orderId",
] as const;
export type ImportField = (typeof importFields)[number];

export type ColumnReference = { normalizedHeader: string; occurrence: number };
export type TabularColumn = { label: string; reference: ColumnReference; index: number };
export type ParsedTabularFile = { columns: TabularColumn[]; rows: string[][]; sheetName?: string };
export type ImportMapping = Partial<Record<ImportField, ColumnReference>>;

export type ImportIssueSeverity = "info" | "warning" | "error";
export const importIssueCodes = [
  "IMPORT_AMBIGUOUS_COLUMN", "IMPORT_COLUMN_MISSING", "IMPORT_COLUMN_COLLISION", "IMPORT_REQUIRED_COLUMN", "IMPORT_INSTRUMENT_COLUMN",
  "IMPORT_GROSS_AMOUNT_MAPPED_AS_UNIT_PRICE",
  "IMPORT_DATE_MISSING", "IMPORT_AMBIGUOUS_DATE", "IMPORT_INVALID_DATE", "IMPORT_INVALID_TIME", "IMPORT_UNSUPPORTED_TIMEZONE", "IMPORT_TIME_MISSING", "IMPORT_AMBIGUOUS_INTRADAY_ORDER",
  "IMPORT_TIME_CONFLICT",
  "IMPORT_INVALID_NUMBER", "IMPORT_NON_POSITIVE_NUMBER", "IMPORT_NEGATIVE_NUMBER", "IMPORT_INVALID_SIDE", "IMPORT_INVALID_CURRENCY", "IMPORT_CURRENCY_CONFLICT", "IMPORT_CURRENCY_FALLBACK", "IMPORT_EXCHANGE_RATE_FALLBACK",
  "IMPORT_AMBIGUOUS_INSTRUMENT", "IMPORT_INSTRUMENT_CONFLICT", "IMPORT_INSTRUMENT_NOT_FOUND", "IMPORT_AMBIGUOUS_ACCOUNT", "IMPORT_ACCOUNT_NOT_FOUND", "IMPORT_ARCHIVED_ACCOUNT", "IMPORT_ACCOUNT_REQUIRED",
  "IMPORT_EXACT_DUPLICATE", "IMPORT_POSSIBLE_DUPLICATE", "IMPORT_PREVIOUSLY_DELETED", "IMPORT_AMBIGUOUS_IDENTICAL_ROW", "IMPORT_SOURCE_CONFLICT", "IMPORT_SOURCE_IDENTITY_AMBIGUOUS", "IMPORT_PREVIEW_STALE", "IMPORT_ROW_REJECTED", "IMPORT_NOTHING_SELECTED", "IMPORT_LEDGER_CONFLICT",
  "IMPORT_BATCH_EXACT_DUPLICATE", "IMPORT_BATCH_SOURCE_IDENTITY_CONFLICT",
  "IMPORT_PRICE_DERIVED_FROM_GROSS_AMOUNT", "IMPORT_PRICE_AMOUNT_CONFLICT",
  "IMPORT_BROKER_LEDGER_NON_TRADE", "IMPORT_BROKER_LEDGER_SETTLEMENT_MIRROR", "IMPORT_BROKER_LEDGER_UNSUPPORTED_ACTIVITY", "IMPORT_BROKER_LEDGER_UNKNOWN_ACTIVITY",
  "IMPORT_SETTLEMENT_RECONCILED", "IMPORT_SETTLEMENT_MISMATCH", "IMPORT_SETTLEMENT_MIRROR_MISSING", "IMPORT_SETTLEMENT_EXECUTION_MISSING",
  "IMPORT_MIRAE_FOREIGN_ACTIVITY_UNSUPPORTED",
] as const;
export type ImportIssueCode = (typeof importIssueCodes)[number];
export type ImportIssue = {
  code: ImportIssueCode;
  severity: ImportIssueSeverity;
  row?: number;
  field?: ImportField;
  candidateId?: string;
  details?: Record<string, string | number>;
};
export type DuplicateClassification = "new" | "exactDuplicate" | "possibleDuplicate" | "sourceConflict";

export type CanonicalExecution = {
  importBatchId: string;
  adapter: "generic-tabular-v1" | "mirae-account-ledger-v1";
  sourceSequence: number;
  provider: string | null;
  sourceRow: number;
  externalAccountReference: string | null;
  ticker: string | null;
  stockName: string | null;
  market: string | null;
  side: "buy" | "sell";
  executedAt: string;
  timePrecision: "date" | "minute" | "second";
  quantity: number;
  price: number;
  priceEvidence?: {
    kind: "direct" | "gross_amount_divided_by_quantity";
    grossAmount?: number;
  };
  fee: number;
  tax: number;
  currency: Currency | null;
  exchangeRate: number | null;
  externalExecutionId: string | null;
  externalOrderId: string | null;
};

export type ImportCandidateStatus = "ready" | "exact_duplicate" | "possible_duplicate" | "previously_deleted" | "source_conflict" | "rejected" | "excluded_settlement" | "excluded_non_trade" | "unsupported_activity";
export type ImportCandidateAction = "insert" | "restore" | "none";
export type ImportCandidate = {
  id: string;
  row: number;
  status: ImportCandidateStatus;
  action: ImportCandidateAction;
  selectedByDefault: boolean;
  execution?: CanonicalExecution;
  trade?: Trade;
  matchedTradeIds: string[];
  issues: ImportIssue[];
  sourceActivity?: string;
};

export type BrokerLedgerRowDisposition = "execution" | "settlement_mirror" | "non_trade_activity" | "unsupported_activity" | "review_required";
export type PreparedBrokerLedgerRow = {
  sourceRow: number;
  sourceSequence: number;
  disposition: BrokerLedgerRowDisposition;
  activityLabel: string;
  issues: ImportIssue[];
  execution?: CanonicalExecution;
  settlementEvidence?: { side: "buy" | "sell"; date: string; grossAmount: number; fee: number };
};

export type ImportMutationPlan = {
  insertedTrades: Trade[];
  restoredTradeIds: string[];
  nextTrades: Trade[];
};

export type ImportPreview = {
  candidates: ImportCandidate[];
  issues: ImportIssue[];
  requiresTimezoneConfirmation: boolean;
  summary: Record<ImportCandidateStatus, number>;
};

export type ImportContext = {
  stocks: Stock[];
  accounts: InvestmentAccount[];
  existingTrades: Trade[];
  targetAccountId?: string;
  provider?: string;
  importBatchId?: string;
  importedAt?: string;
};

export type ImportMappingProfile = {
  id: string;
  name: string;
  version: 1;
  bindings: ImportMapping;
  headerSignature: string;
  createdAt: string;
  updatedAt: string;
};
