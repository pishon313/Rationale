import Decimal from "decimal.js";
import { normalizeHeader } from "../column-mapping";
import { adaptTabularRow, parseExecutionDateTime, parseOptionalDecimal } from "../import-pipeline";
import type { ImportField, ImportIssue, ImportIssueCode, ImportMapping, ParsedTabularFile, PreparedBrokerLedgerRow } from "../import-types";
import type { FileImportAdapter } from "./adapter-types";

const headers = ["거래일자", "거래종류", "종목명", "거래수량", "거래금액", "외화거래금액", "수수료", "예수금잔고"] as const;
const normalizedHeaders = headers.map(normalizeHeader);
const headerField: Partial<Record<(typeof headers)[number], ImportField>> = {
  거래일자: "tradedAt",
  거래종류: "tradeType",
  종목명: "stockName",
  거래수량: "quantity",
  거래금액: "grossAmount",
  수수료: "fee",
};

type KnownActivity = "주식매수입고" | "주식매도출고" | "주식매수출금" | "주식매도입금" | "이체송금" | "배당세출금" | "계좌대체입금" | "CMS자동이체입금" | "예탁금이용료입금" | "펀드정기자동매수";
const activities: Record<KnownActivity, { disposition: PreparedBrokerLedgerRow["disposition"]; side?: "buy" | "sell" }> = {
  주식매수입고: { disposition: "execution", side: "buy" },
  주식매도출고: { disposition: "execution", side: "sell" },
  주식매수출금: { disposition: "settlement_mirror", side: "buy" },
  주식매도입금: { disposition: "settlement_mirror", side: "sell" },
  이체송금: { disposition: "non_trade_activity" },
  배당세출금: { disposition: "non_trade_activity" },
  계좌대체입금: { disposition: "non_trade_activity" },
  CMS자동이체입금: { disposition: "non_trade_activity" },
  예탁금이용료입금: { disposition: "non_trade_activity" },
  펀드정기자동매수: { disposition: "unsupported_activity" },
};

type PreparedWithTotals = PreparedBrokerLedgerRow & { gross?: Decimal; fee?: Decimal; groupKey?: string };

export const miraeAccountLedgerAdapter: FileImportAdapter = {
  id: "mirae-account-ledger-v1",
  label: "미래에셋 계좌 활동 원장",
  suggestionTitle: "미래에셋 계좌 활동 원장 형식으로 보입니다.",
  suggestionDescription: "이 파일은 체결 전용 내역이 아니라 주식 이동, 현금 정산, 이체와 기타 계좌 활동이 함께 들어 있는 형식입니다. 미래에셋 규칙을 적용하면 주식 입고·출고 행만 매매 후보로 사용하고 대응 현금 행과 비매매 활동은 별도 거래로 저장하지 않습니다.",
  activeDescription: "미래에셋 규칙이 적용되었습니다. 어댑터가 소유한 열 연결은 읽기 전용이며, 정산·비매매 행은 원장에 저장되지 않습니다.",
  applyLabel: "미래에셋 규칙 적용",
  detect(parsed) {
    const counts = new Map<string, number>();
    for (const column of parsed.columns) counts.set(column.reference.normalizedHeader, (counts.get(column.reference.normalizedHeader) ?? 0) + 1);
    if (!normalizedHeaders.every((header) => counts.get(header) === 1)) return { match: "none" };
    const exact = parsed.columns.length === normalizedHeaders.length && parsed.columns.every((column) => normalizedHeaders.includes(column.reference.normalizedHeader));
    return { match: "suggested", adapterId: "mirae-account-ledger-v1", confidence: exact ? "exact" : "compatible", reasonCode: exact ? "MIRAE_ACCOUNT_LEDGER_EXACT_HEADERS" : "MIRAE_ACCOUNT_LEDGER_COMPATIBLE_HEADERS" };
  },
  defaultMapping(parsed) {
    const mapping: ImportMapping = {};
    for (const [label, field] of Object.entries(headerField) as Array<[(typeof headers)[number], ImportField]>) {
      const column = parsed.columns.find((item) => item.reference.normalizedHeader === normalizeHeader(label));
      if (column) mapping[field] = column.reference;
    }
    return mapping;
  },
  prepare(parsed, context) {
    const mapping = this.defaultMapping(parsed);
    const prepared = parsed.rows.map((row, sourceSequence): PreparedWithTotals => prepareRow(parsed, row, sourceSequence, mapping, context));
    reconcileSettlementGroups(prepared);
    return prepared;
  },
};

function prepareRow(parsed: ParsedTabularFile, row: string[], sourceSequence: number, mapping: ImportMapping, context: { importBatchId: string; provider: string | null; targetAccountId: string }): PreparedWithTotals {
  const sourceRow = sourceSequence + 2;
  const activityLabel = sourceValue(parsed, row, "거래종류").normalize("NFKC").trim();
  const classification = activities[activityLabel as KnownActivity];
  if (!classification) return { sourceRow, sourceSequence, disposition: "review_required", activityLabel, issues: [issue("IMPORT_BROKER_LEDGER_UNKNOWN_ACTIVITY", "error", sourceRow)] };
  if (classification.disposition === "non_trade_activity") return { sourceRow, sourceSequence, disposition: classification.disposition, activityLabel, issues: [issue("IMPORT_BROKER_LEDGER_NON_TRADE", "info", sourceRow)] };
  if (classification.disposition === "unsupported_activity") return { sourceRow, sourceSequence, disposition: classification.disposition, activityLabel, issues: [issue("IMPORT_BROKER_LEDGER_UNSUPPORTED_ACTIVITY", "warning", sourceRow)] };

  try {
    const foreignAmount = parseOptionalDecimal(sourceValue(parsed, row, "외화거래금액"));
    if (classification.disposition === "execution" && !foreignAmount.isZero()) return { sourceRow, sourceSequence, disposition: "unsupported_activity", activityLabel, issues: [issue("IMPORT_MIRAE_FOREIGN_ACTIVITY_UNSUPPORTED", "warning", sourceRow)] };
    const gross = parseOptionalDecimal(sourceValue(parsed, row, "거래금액"));
    const fee = parseOptionalDecimal(sourceValue(parsed, row, "수수료"));
    if (!gross.greaterThan(0)) throw failure("IMPORT_NON_POSITIVE_NUMBER", "grossAmount");
    if (fee.isNegative()) throw failure("IMPORT_NEGATIVE_NUMBER", "fee");
    const date = parseExecutionDateTime(sourceValue(parsed, row, "거래일자")).value.slice(0, 10);
    const groupKey = JSON.stringify([context.targetAccountId, date, classification.side]);
    if (classification.disposition === "settlement_mirror") {
      return {
        sourceRow, sourceSequence, disposition: "settlement_mirror", activityLabel,
        issues: [issue("IMPORT_BROKER_LEDGER_SETTLEMENT_MIRROR", "info", sourceRow)], gross, fee, groupKey,
        settlementEvidence: { side: classification.side!, date, grossAmount: gross.toNumber(), fee: fee.toNumber() },
      };
    }
    const execution = adaptTabularRow(parsed, row, sourceRow, sourceSequence, mapping, context.importBatchId, context.provider ?? "미래에셋");
    execution.adapter = "mirae-account-ledger-v1";
    execution.side = classification.side!;
    return { sourceRow, sourceSequence, disposition: "execution", activityLabel, issues: [], execution, gross, fee, groupKey };
  } catch (error) {
    return { sourceRow, sourceSequence, disposition: "review_required", activityLabel, issues: [issueFromError(error, sourceRow)] };
  }
}

function reconcileSettlementGroups(rows: PreparedWithTotals[]) {
  const grouped = new Map<string, { executions: PreparedWithTotals[]; mirrors: PreparedWithTotals[] }>();
  for (const row of rows) {
    if (!row.groupKey) continue;
    const group = grouped.get(row.groupKey) ?? { executions: [], mirrors: [] };
    if (row.disposition === "execution") group.executions.push(row);
    else if (row.disposition === "settlement_mirror") group.mirrors.push(row);
    grouped.set(row.groupKey, group);
  }
  for (const group of grouped.values()) {
    if (group.executions.length && !group.mirrors.length) {
      for (const row of group.executions) row.issues.push(issue("IMPORT_SETTLEMENT_MIRROR_MISSING", "warning", row.sourceRow));
      continue;
    }
    if (!group.executions.length && group.mirrors.length) {
      for (const row of group.mirrors) row.issues.push(issue("IMPORT_SETTLEMENT_EXECUTION_MISSING", "warning", row.sourceRow));
      continue;
    }
    const executionGross = sum(group.executions, "gross");
    const executionFee = sum(group.executions, "fee");
    const mirrorGross = sum(group.mirrors, "gross");
    const mirrorFee = sum(group.mirrors, "fee");
    const reconciled = executionGross.equals(mirrorGross) && executionFee.equals(mirrorFee);
    for (const row of [...group.executions, ...group.mirrors]) row.issues.push(issue(reconciled ? "IMPORT_SETTLEMENT_RECONCILED" : "IMPORT_SETTLEMENT_MISMATCH", reconciled ? "info" : row.disposition === "execution" ? "error" : "warning", row.sourceRow));
  }
}

function sum(rows: PreparedWithTotals[], field: "gross" | "fee") { return rows.reduce((total, row) => total.plus(row[field] ?? 0), new Decimal(0)); }
function sourceValue(parsed: ParsedTabularFile, row: string[], header: (typeof headers)[number]) { const column = parsed.columns.find((item) => item.reference.normalizedHeader === normalizeHeader(header)); return column ? row[column.index]?.trim() ?? "" : ""; }
function issue(code: ImportIssueCode, severity: ImportIssue["severity"], row: number, field?: ImportField): ImportIssue { return { code, severity, row, ...(field ? { field } : {}) }; }
function failure(code: ImportIssueCode, field?: ImportField) { return Object.assign(new Error(code), { code, field }); }
function issueFromError(error: unknown, row: number): ImportIssue {
  const value = error as { code?: ImportIssueCode; field?: ImportField };
  return issue(value.code ?? "IMPORT_ROW_REJECTED", "error", row, value.field);
}
