import { columnReferenceKey, importFieldLabels, suggestedImportFieldsForColumn, validateImportMapping } from "./column-mapping";
import type { ImportField, ImportMapping, ParsedTabularFile, TabularColumn } from "./import-types";

export type ImportFieldGroup = "required" | "instrument" | "financial_accuracy" | "ledger_safety" | "optional";
export type SourceColumnAssignmentTarget = ImportField | "ignore";
export type SourceColumnAssignmentOrigin = "profile" | "automatic" | "manual" | "needs_review" | "ignored";
export type SourceColumnAssignment = { column: TabularColumn; target: SourceColumnAssignmentTarget; suggestedTargets: ImportField[]; origin: SourceColumnAssignmentOrigin; sampleValues: string[] };
export type MappingAdvisoryCode = "MAPPING_TIME_UNMAPPED" | "MAPPING_FEE_UNMAPPED" | "MAPPING_TAX_UNMAPPED" | "MAPPING_CURRENCY_UNMAPPED" | "MAPPING_EXCHANGE_RATE_UNMAPPED" | "MAPPING_ACCOUNT_TARGET_APPLIED" | "MAPPING_EXECUTION_ID_UNMAPPED";

export type ImportFieldDefinition = { field: ImportField; label: string; group: ImportFieldGroup; helpText: string };

export const importFieldDefinitions: ImportFieldDefinition[] = [
  { field: "tradedAt", label: importFieldLabels.tradedAt, group: "required", helpText: "거래 날짜 또는 거래 일시" },
  { field: "tradeType", label: importFieldLabels.tradeType, group: "required", helpText: "매수와 매도를 구분" },
  { field: "quantity", label: importFieldLabels.quantity, group: "required", helpText: "체결 수량" },
  { field: "price", label: importFieldLabels.price, group: "required", helpText: "체결 단가" },
  { field: "ticker", label: importFieldLabels.ticker, group: "instrument", helpText: "종목 식별에 사용" },
  { field: "stockName", label: importFieldLabels.stockName, group: "instrument", helpText: "종목 식별 및 충돌 확인" },
  { field: "fee", label: importFieldLabels.fee, group: "financial_accuracy", helpText: "없으면 0으로 계산" },
  { field: "tax", label: importFieldLabels.tax, group: "financial_accuracy", helpText: "없으면 0으로 계산" },
  { field: "currency", label: importFieldLabels.currency, group: "financial_accuracy", helpText: "없으면 등록된 종목 통화 사용" },
  { field: "exchangeRate", label: importFieldLabels.exchangeRate, group: "financial_accuracy", helpText: "없으면 기존 환율 fallback 사용" },
  { field: "time", label: importFieldLabels.time, group: "ledger_safety", helpText: "일중 거래 순서 확인" },
  { field: "accountName", label: importFieldLabels.accountName, group: "ledger_safety", helpText: "행별 계좌 구분" },
  { field: "externalExecutionId", label: importFieldLabels.externalExecutionId, group: "ledger_safety", helpText: "안전한 재가져오기 식별" },
  { field: "orderId", label: importFieldLabels.orderId, group: "optional", helpText: "정보용 주문 식별자" },
];

export const importFieldGroupLabels: Record<ImportFieldGroup, string> = { required: "필수", instrument: "종목 식별", financial_accuracy: "손익 정확도 권장", ledger_safety: "원장·중복 안전 권장", optional: "선택" };

export function sampleValuesForColumn(parsed: ParsedTabularFile, column: TabularColumn, options: { maxSamples?: number; scanLimit?: number } = {}) {
  const maxSamples = options.maxSamples ?? 3;
  const scanLimit = options.scanLimit ?? 50;
  const values: string[] = [];
  for (const row of parsed.rows.slice(0, scanLimit)) {
    const value = row[column.index] ?? "";
    if (value !== "" && !values.includes(value)) values.push(value);
    if (values.length >= maxSamples) break;
  }
  return values;
}

export function sourceColumnAssignments(parsed: ParsedTabularFile, mapping: ImportMapping, options: { profileBindings?: ImportMapping; manuallyChanged?: ReadonlySet<string>; explicitlyIgnored?: ReadonlySet<string> } = {}): SourceColumnAssignment[] {
  const targetByColumn = new Map(Object.entries(mapping).map(([field, reference]) => [columnReferenceKey(reference), field as ImportField]));
  const profileByColumn = new Map(Object.entries(options.profileBindings ?? {}).map(([field, reference]) => [columnReferenceKey(reference), field as ImportField]));
  return parsed.columns.map((column) => {
    const key = columnReferenceKey(column.reference);
    const target = targetByColumn.get(key) ?? "ignore";
    const suggestions = suggestedImportFieldsForColumn(column);
    let origin: SourceColumnAssignmentOrigin;
    if (options.manuallyChanged?.has(key)) origin = "manual";
    else if (target !== "ignore" && profileByColumn.get(key) === target) origin = "profile";
    else if (target !== "ignore") origin = "automatic";
    else if (!options.explicitlyIgnored?.has(key) && suggestions.length > 0) origin = "needs_review";
    else origin = "ignored";
    return { column, target, suggestedTargets: suggestions, origin, sampleValues: sampleValuesForColumn(parsed, column) };
  });
}

export function applySourceColumnAssignment(mapping: ImportMapping, column: TabularColumn, target: SourceColumnAssignmentTarget): { ok: true; mapping: ImportMapping } | { ok: false; mapping: ImportMapping; owner: ImportField } {
  const next = { ...mapping };
  for (const [field, reference] of Object.entries(next) as Array<[ImportField, NonNullable<ImportMapping[ImportField]>]>) if (columnReferenceKey(reference) === columnReferenceKey(column.reference)) delete next[field];
  if (target === "ignore") return { ok: true, mapping: next };
  if (next[target]) return { ok: false, mapping, owner: target };
  next[target] = column.reference;
  return { ok: true, mapping: next };
}

export type RequiredMappingCoverage = { id: "tradedAt" | "tradeType" | "quantity" | "price" | "instrument"; label: string; complete: boolean };
export function requiredMappingCoverage(mapping: ImportMapping): RequiredMappingCoverage[] {
  return [
    { id: "tradedAt", label: importFieldLabels.tradedAt, complete: Boolean(mapping.tradedAt) },
    { id: "tradeType", label: importFieldLabels.tradeType, complete: Boolean(mapping.tradeType) },
    { id: "quantity", label: importFieldLabels.quantity, complete: Boolean(mapping.quantity) },
    { id: "price", label: importFieldLabels.price, complete: Boolean(mapping.price) },
    { id: "instrument", label: "종목코드 또는 종목명", complete: Boolean(mapping.ticker || mapping.stockName) },
  ];
}

export function mappingAdvisories(mapping: ImportMapping): MappingAdvisoryCode[] {
  const fields: Array<[ImportField, MappingAdvisoryCode]> = [["time", "MAPPING_TIME_UNMAPPED"], ["fee", "MAPPING_FEE_UNMAPPED"], ["tax", "MAPPING_TAX_UNMAPPED"], ["currency", "MAPPING_CURRENCY_UNMAPPED"], ["exchangeRate", "MAPPING_EXCHANGE_RATE_UNMAPPED"], ["accountName", "MAPPING_ACCOUNT_TARGET_APPLIED"], ["externalExecutionId", "MAPPING_EXECUTION_ID_UNMAPPED"]];
  return fields.filter(([field]) => !mapping[field]).map(([, code]) => code);
}

export function mappingReady(mapping: ImportMapping, columns: TabularColumn[], targetAccountId: string) {
  return validateImportMapping(mapping, columns).every((issue) => issue.severity !== "error") && Boolean(mapping.accountName || targetAccountId);
}

export function ignoredImportantField(assignment: SourceColumnAssignment): ImportField | null {
  if (assignment.target !== "ignore" || assignment.suggestedTargets.length !== 1) return null;
  const field = assignment.suggestedTargets[0];
  return ["time", "fee", "tax", "currency", "exchangeRate", "accountName", "externalExecutionId"].includes(field) ? field : null;
}
