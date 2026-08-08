import type { Stock } from "@/features/stocks/types";
import { fallbackRatesToKrw } from "@/domain/currency";
import type { Trade } from "./types";
import type { InvestmentAccount } from "@/features/accounts/types";

export const csvFields = ["tradedAt", "time", "ticker", "stockName", "tradeType", "quantity", "price", "fee", "tax", "currency", "exchangeRate", "accountName"] as const;
export type CsvField = (typeof csvFields)[number];
export type CsvMapping = Partial<Record<CsvField, number>>;
export type ParsedCsv = { headers: string[]; rows: string[][] };
export type CsvImportResult = { trades: Trade[]; errors: Array<{ row: number; message: string }>; skippedDuplicates: number };

export async function parseTradeFile(file: File): Promise<ParsedCsv> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "xls" || extension === "xlsx") return parseExcelWorkbook(await file.arrayBuffer());
  if (extension === "csv" || extension === "tsv") return parseCsv(decodeDelimitedText(await file.arrayBuffer()));
  throw new Error("CSV, TSV, XLS 또는 XLSX 파일을 선택해 주세요.");
}

type DecodedCandidate = { encoding: string; text: string; score: number };

/**
 * Broker exports are frequently saved in a platform-specific legacy encoding.
 * Prefer a BOM when present, then select the decoding whose header maps to the
 * most journal fields and whose text contains the fewest damaged characters.
 */
export function decodeDelimitedText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const bomEncoding = detectBomEncoding(bytes);
  const encodings = ["utf-8", "utf-16le", "utf-16be", "euc-kr", "windows-949", "cp949", "shift_jis", "windows-1252"];
  const candidates: DecodedCandidate[] = [];

  encodings.forEach((encoding, priority) => {
    try {
      const text = new TextDecoder(encoding).decode(bytes);
      const parsed = parseCsv(text);
      const mapping = detectCsvMapping(parsed.headers);
      const mappedFields = Object.keys(mapping).length;
      const criticalFields = ["tradedAt", "tradeType", "quantity", "price"] satisfies CsvField[];
      const mappedCriticalFields = criticalFields.filter((field) => mapping[field] !== undefined).length;
      const replacementCharacters = countMatches(text, /\uFFFD/g);
      const nullCharacters = countMatches(text, /\0/g);
      const unwantedControls = countMatches(text, /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g);
      const bomBonus = encoding === bomEncoding ? 1_000_000 : 0;
      const score = bomBonus
        + mappedFields * 10_000
        + mappedCriticalFields * 2_000
        - replacementCharacters * 2_000
        - nullCharacters * 1_000
        - unwantedControls * 500
        - priority;
      candidates.push({ encoding, text, score });
    } catch {
      // TextDecoder availability differs by browser. Unsupported or invalid
      // candidates are simply excluded from selection.
    }
  });

  const best = candidates.sort((left, right) => right.score - left.score)[0];
  if (!best) throw new Error("파일 문자 인코딩을 읽을 수 없습니다.");
  return best.text.replace(/^\uFEFF/, "");
}

export async function parseExcelWorkbook(buffer: ArrayBuffer): Promise<ParsedCsv> {
  const XLSX = await import("@e965/xlsx");
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("엑셀 파일에서 시트를 찾지 못했습니다.");
  const sheet = workbook.Sheets[firstSheetName];
  const records = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date>>(sheet, { header: 1, defval: "", raw: false, dateNF: "yyyy-mm-dd" });
  const rows = records.map((row) => row.map((cell) => String(cell ?? "").trim())).filter((row) => row.some(Boolean));
  return { headers: rows[0] ?? [], rows: rows.slice(1) };
}

const aliases: Record<CsvField, string[]> = {
  tradedAt: [
    "거래일시", "체결일시", "거래일자", "체결일자", "거래일", "체결일",
    "取引日時", "約定日時", "取引日", "約定日",
    "date", "datetime", "trade date", "transaction date", "execution date", "traded at", "executed at",
    "date de transaction", "date d’exécution", "date d'exécution", "date d'opération",
    "data operazione", "data di esecuzione", "data transazione",
    "fecha de operación", "fecha de ejecución", "fecha de transacción",
  ],
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
};

export const csvFieldLabels: Record<CsvField, string> = { tradedAt: "거래일", time: "시간", ticker: "종목코드", stockName: "종목명", tradeType: "매수/매도", quantity: "수량", price: "체결가", fee: "수수료", tax: "세금", currency: "통화", exchangeRate: "환율", accountName: "계좌명" };

export function parseCsv(text: string): ParsedCsv {
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let row: string[] = []; let cell = ""; let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; } else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell.trim()); if (row.some(Boolean)) records.push(row); row = []; cell = "";
    } else cell += char;
  }
  row.push(cell.trim()); if (row.some(Boolean)) records.push(row);
  return { headers: records[0] ?? [], rows: records.slice(1) };
}

export function detectCsvMapping(headers: string[]): CsvMapping {
  const mapping: CsvMapping = {};
  for (const field of csvFields) {
    const normalizedAliases = new Set(aliases[field].map(normalizeHeader));
    const index = headers.findIndex((header) => normalizedAliases.has(normalizeHeader(header)));
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}

export function convertCsvRows(parsed: ParsedCsv, mapping: CsvMapping, stocks: Stock[], existing: Trade[], accountOptions?: { accounts: InvestmentAccount[]; targetAccountId?: string }): CsvImportResult {
  const trades: Trade[] = []; const errors: CsvImportResult["errors"] = []; let skippedDuplicates = 0;
  const fingerprints = new Set(existing.filter((trade) => !trade.deletedAt).map(fingerprint));
  parsed.rows.forEach((row, index) => {
    try {
      const rawTicker = value(row, mapping.ticker); const rawName = value(row, mapping.stockName);
      const stock = stocks.find((item) => !item.deletedAt && ((rawTicker && normalizeTicker(item.ticker) === normalizeTicker(rawTicker)) || (rawName && normalizeName(item.name) === normalizeName(rawName))));
      if (!stock) throw new Error(`종목을 찾을 수 없습니다: ${rawTicker || rawName || "종목 정보 없음"}`);
      const tradeType = parseTradeType(value(row, mapping.tradeType));
      const tradedAt = parseDateTime(value(row, mapping.tradedAt), value(row, mapping.time));
      const quantity = parsePositive(value(row, mapping.quantity), "수량");
      const price = parsePositive(value(row, mapping.price), "체결가");
      const currency = parseCurrency(value(row, mapping.currency), stock.currency);
      const exchangeRate = currency === "KRW" ? 1 : optionalNumber(value(row, mapping.exchangeRate)) || fallbackRatesToKrw[currency];
      const now = new Date().toISOString();
      const importedAccountName = value(row, mapping.accountName);
      let account: InvestmentAccount | undefined;
      if (accountOptions && importedAccountName) {
        const matches = accountOptions.accounts.filter((item) => item.name.trim() === importedAccountName.trim());
        if (matches.length > 1) throw new Error(`동일한 이름의 계좌가 여러 개 있습니다: ${importedAccountName}`);
        if (!matches.length) throw new Error(`등록되지 않은 계좌입니다: ${importedAccountName}`);
        if (matches[0].archivedAt) throw new Error(`보관된 계좌로는 가져올 수 없습니다: ${importedAccountName}`);
        account = matches[0];
      } else if (accountOptions) {
        account = accountOptions.accounts.find((item) => item.id === accountOptions.targetAccountId && !item.archivedAt);
        if (!account) throw new Error("가져올 대상 계좌를 선택해 주세요.");
      }
      const accountName = account?.name ?? (importedAccountName || "파일 가져오기");
      const trade: Trade = { id: csvId(row, index), stockId: stock.id, stockName: stock.name, planId: null, tradeType, tradedAt, quantity, price, currency, exchangeRate, fee: optionalNumber(value(row, mapping.fee)), tax: optionalNumber(value(row, mapping.tax)), accountId: account?.id, accountName, memo: "증권사 거래 내역 가져오기", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, ruleViolations: [], createdAt: now, updatedAt: now, deletedAt: null };
      const key = fingerprint(trade);
      if (fingerprints.has(key)) { skippedDuplicates += 1; return; }
      fingerprints.add(key); trades.push(trade);
    } catch (error) { errors.push({ row: index + 2, message: error instanceof Error ? error.message : "행을 변환하지 못했습니다." }); }
  });
  return { trades, errors, skippedDuplicates };
}

function detectDelimiter(text: string) { const first = text.split(/\r?\n/, 1)[0] ?? ""; const tabs = (first.match(/\t/g) ?? []).length; const commas = (first.match(/,/g) ?? []).length; const semicolons = (first.match(/;/g) ?? []).length; return tabs > commas && tabs > semicolons ? "\t" : semicolons > commas ? ";" : ","; }
function detectBomEncoding(bytes: Uint8Array) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return null;
}
function countMatches(value: string, pattern: RegExp) { return value.match(pattern)?.length ?? 0; }
function normalizeHeader(value: string) { return value.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").normalize("NFC").replace(/[^\p{L}\p{N}]/gu, ""); }
function normalizeTicker(value: string) { return value.trim().replace(/^'/, "").toUpperCase().replace(/\s/g, ""); }
function normalizeName(value: string) { return value.trim().toLowerCase().replace(/\s/g, ""); }
function value(row: string[], index?: number) { return index === undefined ? "" : row[index]?.trim() ?? ""; }
function optionalNumber(value: string) {
  if (!value) return 0;
  const trimmed = value.trim();
  const negative = /^\(.*\)$/.test(trimmed);
  const unsigned = trimmed
    .replace(/[()$₩€¥￥원]/g, "")
    .replace(/[\s\u00A0\u202F]/g, "");
  const normalized = normalizeLocaleNumber(unsigned);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`숫자 형식이 올바르지 않습니다: ${value}`);
  return negative ? -parsed : parsed;
}
function normalizeLocaleNumber(value: string) {
  if (!/^\d+(?:[.,]\d+)*$/.test(value)) return Number.NaN.toString();
  const commaIndex = value.lastIndexOf(",");
  const dotIndex = value.lastIndexOf(".");

  if (commaIndex >= 0 && dotIndex >= 0) {
    const decimalSeparator = commaIndex > dotIndex ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    const decimalParts = value.split(decimalSeparator);
    if (decimalParts.length !== 2 || !decimalParts[1]) return Number.NaN.toString();
    const integerGroups = decimalParts[0].split(thousandsSeparator);
    if (integerGroups.length > 1 && (integerGroups[0].length > 3 || integerGroups.slice(1).some((group) => group.length !== 3))) {
      return Number.NaN.toString();
    }
    return `${integerGroups.join("")}.${decimalParts[1]}`;
  }

  if (commaIndex >= 0) {
    const groups = value.split(",");
    if (groups.length > 2) {
      if (groups.slice(1).every((group) => group.length === 3)) return groups.join("");
      if (groups.slice(1, -1).every((group) => group.length === 3) && groups.at(-1)!.length <= 2) {
        return `${groups.slice(0, -1).join("")}.${groups.at(-1)}`;
      }
      return Number.NaN.toString();
    }
    return groups[1].length === 3 ? groups.join("") : `${groups[0]}.${groups[1]}`;
  }

  if ((value.match(/\./g) ?? []).length > 1) {
    const groups = value.split(".");
    return groups.slice(1).every((group) => group.length === 3) ? groups.join("") : Number.NaN.toString();
  }
  return value;
}
function parsePositive(value: string, label: string) { const parsed = optionalNumber(value); if (parsed <= 0) throw new Error(`${label}은 0보다 커야 합니다.`); return parsed; }
function parseTradeType(value: string): "매수" | "매도" {
  const normalized = normalizeTerm(value);
  const buyTerms = new Set(["매수", "매입", "買", "買い", "買付", "買付け", "購入", "buy", "b", "purchase", "buyorder", "achat", "acheter", "achete", "ordredachat", "acquisto", "comprare", "comprato", "ordinediacquisto", "compra", "comprar", "comprado", "ordendecompra"]);
  const sellTerms = new Set(["매도", "매각", "売", "売り", "売却", "sell", "s", "sale", "sold", "sellorder", "vente", "vendre", "vendu", "ordredevente", "vendita", "vendere", "venduto", "ordinedivendita", "venta", "vender", "vendido", "ordendeventa"]);
  const isBuy = buyTerms.has(normalized) || normalized.includes("매수") || normalized.includes("買付");
  const isSell = sellTerms.has(normalized) || normalized.includes("매도") || normalized.includes("売却");
  if (isBuy !== isSell) return isBuy ? "매수" : "매도";
  throw new Error(`매수/매도 구분을 확인해 주세요: ${value || "미입력"}`);
}
function parseCurrency(value: string, fallback: Stock["currency"]): Trade["currency"] {
  const raw = value.trim();
  if (!raw) return fallback;
  if (raw === "₩") return "KRW";
  if (raw === "$" || raw.toUpperCase() === "US$") return "USD";
  if (raw === "¥" || raw === "￥") return "JPY";
  if (raw === "€") return "EUR";
  const normalized = normalizeTerm(raw);
  const terms: Record<Trade["currency"], string[]> = {
    KRW: ["krw", "원", "원화", "ウォン", "韓国ウォン", "won", "koreanwon", "southkoreanwon", "wonsudcoreen", "woncoreen", "wonsudcoreano", "woncoreano"],
    USD: ["usd", "달러", "米ドル", "ドル", "dollar", "dollars", "usdollar", "usdollars", "dollaramericain", "dollarsamericains", "dollarostatunitense", "dollaristatunitensi", "dolarestadounidense", "dolaresestadounidenses"],
    JPY: ["jpy", "엔", "엔화", "円", "日本円", "yen", "yens", "japaneseyen", "yenjaponais", "yengiapponese", "yenjapones"],
    EUR: ["eur", "유로", "ユーロ", "euro", "euros"],
  };
  for (const currency of Object.keys(terms) as Trade["currency"][]) if (terms[currency].includes(normalized)) return currency;
  throw new Error(`지원하지 않는 통화입니다: ${value}`);
}
function normalizeTerm(value: string) { return value.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "").normalize("NFC").replace(/[^\p{L}\p{N}]/gu, ""); }
function parseDateTime(dateValue: string, timeValue: string) {
  if (!dateValue) throw new Error("거래일이 없습니다.");
  const raw = dateValue.trim();
  let year: number; let month: number; let day: number; let embeddedTime = "";
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})(?:[T\s]+(.+))?$/);
  const yearFirst = raw.match(/^(\d{4})([-/.])(\d{1,2})\2(\d{1,2})(?:[T\s]+(.+))?$/);
  const dayOrMonthFirst = raw.match(/^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})(?:[T\s]+(.+))?$/);

  if (compact) {
    year = Number(compact[1]); month = Number(compact[2]); day = Number(compact[3]); embeddedTime = compact[4] ?? "";
  } else if (yearFirst) {
    year = Number(yearFirst[1]); month = Number(yearFirst[3]); day = Number(yearFirst[4]); embeddedTime = yearFirst[5] ?? "";
  } else if (dayOrMonthFirst) {
    const first = Number(dayOrMonthFirst[1]); const second = Number(dayOrMonthFirst[3]); year = Number(dayOrMonthFirst[4]); embeddedTime = dayOrMonthFirst[5] ?? "";
    if (first <= 12 && second <= 12) throw new Error(`날짜가 모호합니다: ${dateValue}. YYYY-MM-DD 형식으로 입력해 주세요.`);
    if (first > 12 && second <= 12) { day = first; month = second; }
    else if (second > 12 && first <= 12) { month = first; day = second; }
    else throw new Error(`거래일 형식을 확인해 주세요: ${dateValue}`);
  } else {
    throw new Error(`거래일 형식을 확인해 주세요: ${dateValue}`);
  }

  if (!isValidCalendarDate(year, month, day)) throw new Error(`거래일 형식을 확인해 주세요: ${dateValue}`);
  const normalizedTime = normalizeTime(timeValue || embeddedTime || "09:00");
  if (!normalizedTime) throw new Error(`거래 시간을 확인해 주세요: ${timeValue || embeddedTime}`);
  const date = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return `${date}T${normalizedTime.slice(0, 5)}`;
}
function normalizeTime(value: string) {
  const raw = value.trim();
  let hours: number; let minutes: number; let seconds = 0;
  if (/^\d{6}$/.test(raw)) { hours = Number(raw.slice(0, 2)); minutes = Number(raw.slice(2, 4)); seconds = Number(raw.slice(4, 6)); }
  else if (/^\d{4}$/.test(raw)) { hours = Number(raw.slice(0, 2)); minutes = Number(raw.slice(2, 4)); }
  else {
    const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:\s*(?:Z|[+-]\d{2}:?\d{2}))?$/i);
    if (!match) return "";
    hours = Number(match[1]); minutes = Number(match[2]); seconds = Number(match[3] ?? 0);
  }
  if (hours > 23 || minutes > 59 || seconds > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function isValidCalendarDate(year: number, month: number, day: number) {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function fingerprint(trade: Trade) { return [trade.tradedAt.slice(0, 16), trade.stockId, trade.tradeType, trade.quantity, trade.price, trade.accountName].join("|"); }
function csvId(row: string[], index: number) { let hash = 2166136261; for (const char of `${row.join("|")}|${index}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return `csv-${(hash >>> 0).toString(36)}-${index + 2}`; }
