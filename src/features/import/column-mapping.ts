import type { ColumnReference, ImportField, ImportIssue, ImportMapping, ImportMappingProfile, TabularColumn } from "./import-types";

export const requiredImportFields: ImportField[] = ["tradedAt", "tradeType", "quantity", "price"];
export const optionalImportFields: ImportField[] = ["time", "ticker", "stockName", "fee", "tax", "currency", "exchangeRate", "accountName", "externalExecutionId", "orderId"];

export const importFieldLabels: Record<ImportField, string> = {
  tradedAt: "거래일", time: "시간", ticker: "종목코드", stockName: "종목명", tradeType: "매수/매도",
  quantity: "수량", price: "체결가", fee: "수수료", tax: "세금", currency: "통화", exchangeRate: "환율",
  accountName: "계좌명", externalExecutionId: "체결 ID", orderId: "주문 ID",
};

const aliases: Record<ImportField, string[]> = {
  tradedAt: ["거래일시", "체결일시", "거래일자", "체결일자", "거래일", "체결일", "取引日時", "約定日時", "取引日", "約定日", "date", "datetime", "trade date", "transaction date", "execution date", "traded at", "executed at", "date de transaction", "date d’exécution", "date d'exécution", "date d'opération", "data operazione", "data di esecuzione", "data transazione", "fecha de operación", "fecha de ejecución", "fecha de transacción"],
  time: ["거래시간", "체결시간", "시간", "取引時間", "約定時間", "時刻", "time", "execution time", "heure", "heure d’exécution", "ora", "ora di esecuzione", "hora", "hora de ejecución"],
  ticker: ["종목코드", "티커", "코드", "銘柄コード", "証券コード", "ティッカー", "コード", "symbol", "ticker", "code", "code valeur", "symbole", "codice titolo", "simbolo", "código del valor", "símbolo"],
  stockName: ["종목명", "상품명", "銘柄名", "商品名", "証券名", "name", "stock name", "security", "security name", "nom du titre", "nom de la valeur", "nome titolo", "nome del titolo", "nombre del valor", "nombre del título"],
  tradeType: ["매매구분", "거래구분", "구분", "매수매도", "売買区分", "取引区分", "売買", "区分", "type", "side", "trade type", "transaction type", "type d’opération", "type d'operation", "sens", "tipo operazione", "tipo di operazione", "tipo de operación", "lado"],
  quantity: ["체결수량", "거래수량", "수량", "約定数量", "取引数量", "数量", "株数", "quantity", "qty", "shares", "quantité", "nombre de titres", "quantità", "numero titoli", "cantidad", "número de títulos"],
  price: ["체결가", "체결가격", "거래단가", "단가", "가격", "約定価格", "約定単価", "取引価格", "単価", "価格", "price", "unit price", "execution price", "prix", "prix d’exécution", "cours", "prezzo", "prezzo di esecuzione", "prezzo unitario", "precio", "precio de ejecución", "precio unitario"],
  fee: ["수수료", "手数料", "commission", "commissions", "fee", "fees", "frais", "commissioni", "comisión", "comisiones"],
  tax: ["세금", "제세금", "税", "税金", "tax", "taxes", "impôt", "impôts", "imposta", "imposte", "impuesto", "impuestos"],
  currency: ["통화", "通貨", "currency", "ccy", "devise", "valuta", "moneda", "divisa"],
  exchangeRate: ["환율", "적용환율", "為替レート", "適用為替レート", "為替", "exchange rate", "fx rate", "taux de change", "cambio", "tasso di cambio", "tipo de cambio"],
  accountName: ["계좌", "계좌명", "口座", "口座名", "account", "account name", "compte", "nom du compte", "conto", "nome conto", "cuenta", "nombre de cuenta"],
  externalExecutionId: ["체결id", "체결번호", "거래id", "약정번호", "約定番号", "execution id", "executionid", "trade id", "transaction id", "id d’exécution", "id esecuzione", "id de ejecución"],
  orderId: ["주문id", "주문번호", "注文番号", "order id", "order number", "numéro d’ordre", "numero ordine", "número de orden"],
};

export function normalizeHeader(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").normalize("NFC").replace(/[^\p{L}\p{N}]/gu, "");
}

export function columnReferenceKey(reference: ColumnReference) {
  return `${reference.normalizedHeader}#${reference.occurrence}`;
}

export function buildTabularColumns(headers: string[]): TabularColumn[] {
  const occurrences = new Map<string, number>();
  return headers.map((label, index) => {
    const normalizedHeader = normalizeHeader(label) || `column${index + 1}`;
    const occurrence = occurrences.get(normalizedHeader) ?? 0;
    occurrences.set(normalizedHeader, occurrence + 1);
    return { label, index, reference: { normalizedHeader, occurrence } };
  });
}

export function resolveColumnIndex(columns: TabularColumn[], reference?: ColumnReference) {
  if (!reference) return undefined;
  return columns.find((column) => column.reference.normalizedHeader === reference.normalizedHeader && column.reference.occurrence === reference.occurrence)?.index;
}

export function detectImportMapping(columns: TabularColumn[]): { mapping: ImportMapping; issues: ImportIssue[] } {
  const mapping: ImportMapping = {};
  const issues: ImportIssue[] = [];
  for (const field of [...requiredImportFields, ...optionalImportFields]) {
    const accepted = new Set(aliases[field].map(normalizeHeader));
    const matches = columns.filter((column) => accepted.has(column.reference.normalizedHeader));
    if (matches.length === 1) mapping[field] = matches[0].reference;
    if (matches.length > 1) issues.push({
      code: "IMPORT_AMBIGUOUS_COLUMN",
      severity: "warning",
      field,
    });
  }
  return { mapping, issues: [...issues, ...validateImportMapping(mapping, columns)] };
}

export function validateImportMapping(mapping: ImportMapping, columns: TabularColumn[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const used = new Map<string, ImportField>();
  for (const [field, reference] of Object.entries(mapping) as Array<[ImportField, ColumnReference]>) {
    if (resolveColumnIndex(columns, reference) === undefined) {
      issues.push({ code: "IMPORT_COLUMN_MISSING", severity: "error", field });
      continue;
    }
    const key = columnReferenceKey(reference);
    const collision = used.get(key);
    if (collision) issues.push({ code: "IMPORT_COLUMN_COLLISION", severity: "error", field, details: { otherField: collision } });
    else used.set(key, field);
  }
  for (const field of requiredImportFields) if (!mapping[field]) issues.push({ code: "IMPORT_REQUIRED_COLUMN", severity: "error", field });
  if (!mapping.ticker && !mapping.stockName) issues.push({ code: "IMPORT_INSTRUMENT_COLUMN", severity: "error" });
  return issues;
}

export function headerSignature(columns: TabularColumn[]) {
  return columns.map((column) => columnReferenceKey(column.reference)).sort().join("|");
}

export function profileMatch(profile: ImportMappingProfile, columns: TabularColumn[]): "exact" | "compatible" | "incompatible" {
  if (profile.version !== 1) return "incompatible";
  if (profile.headerSignature === headerSignature(columns)) return validateImportMapping(profile.bindings, columns).some((issue) => issue.severity === "error") ? "incompatible" : "exact";
  const savedCounts = signatureHeaderCounts(profile.headerSignature);
  if (!savedCounts) return "incompatible";
  const currentCounts = columnHeaderCounts(columns);
  const mappingErrors = validateImportMapping(profile.bindings, columns).some((issue) => issue.severity === "error");
  const boundHeadersStable = Object.values(profile.bindings).every((reference) => savedCounts.get(reference.normalizedHeader) === currentCounts.get(reference.normalizedHeader));
  return !mappingErrors && boundHeadersStable ? "compatible" : "incompatible";
}

export function exactProfileToAutoApply(profiles: ImportMappingProfile[], columns: TabularColumn[]) {
  const exact = profiles.filter((profile) => profileMatch(profile, columns) === "exact");
  return exact.length === 1 ? exact[0] : undefined;
}

export function normalizeMappingProfileName(value: string) { return value.trim().toLocaleLowerCase(); }

export function hasDuplicateMappingProfileName(profiles: ImportMappingProfile[], name: string, excludingId?: string) {
  const normalized = normalizeMappingProfileName(name);
  return profiles.some((profile) => profile.id !== excludingId && normalizeMappingProfileName(profile.name) === normalized);
}

export function updatedMappingProfile(profile: ImportMappingProfile, name: string, bindings: ImportMapping, columns: TabularColumn[], updatedAt: string): ImportMappingProfile {
  return { ...profile, name: name.trim(), bindings, headerSignature: headerSignature(columns), updatedAt };
}

function columnHeaderCounts(columns: TabularColumn[]) {
  const counts = new Map<string, number>();
  for (const column of columns) counts.set(column.reference.normalizedHeader, (counts.get(column.reference.normalizedHeader) ?? 0) + 1);
  return counts;
}

function signatureHeaderCounts(signature: string) {
  if (!signature) return null;
  const counts = new Map<string, number>();
  for (const item of signature.split("|")) {
    const match = item.match(/^(.+)#(\d+)$/);
    if (!match) return null;
    const occurrence = Number(match[2]);
    if (occurrence !== (counts.get(match[1]) ?? 0)) return null;
    counts.set(match[1], occurrence + 1);
  }
  return counts;
}
