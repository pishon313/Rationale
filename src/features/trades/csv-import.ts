import type { Stock } from "@/features/stocks/types";
import { fallbackRatesToKrw } from "@/domain/currency";
import type { Trade } from "./types";

export const csvFields = ["tradedAt", "time", "ticker", "stockName", "tradeType", "quantity", "price", "fee", "tax", "currency", "exchangeRate", "accountName"] as const;
export type CsvField = (typeof csvFields)[number];
export type CsvMapping = Partial<Record<CsvField, number>>;
export type ParsedCsv = { headers: string[]; rows: string[][] };
export type CsvImportResult = { trades: Trade[]; errors: Array<{ row: number; message: string }>; skippedDuplicates: number };

const aliases: Record<CsvField, string[]> = {
  tradedAt: ["거래일시", "체결일시", "거래일자", "체결일자", "거래일", "체결일", "date", "datetime", "tradedat", "executedat"],
  time: ["거래시간", "체결시간", "시간", "time"],
  ticker: ["종목코드", "티커", "코드", "symbol", "ticker", "code"],
  stockName: ["종목명", "상품명", "name", "stockname", "security"],
  tradeType: ["매매구분", "거래구분", "구분", "매수매도", "type", "side", "tradetype"],
  quantity: ["체결수량", "거래수량", "수량", "quantity", "qty", "shares"],
  price: ["체결가", "체결가격", "거래단가", "단가", "가격", "price", "unitprice"],
  fee: ["수수료", "commission", "fee"], tax: ["세금", "제세금", "tax"], currency: ["통화", "currency", "ccy"],
  exchangeRate: ["환율", "적용환율", "exchangerate", "fxrate"], accountName: ["계좌", "계좌명", "account", "accountname"],
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
    const index = headers.findIndex((header) => aliases[field].includes(normalizeHeader(header)));
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}

export function convertCsvRows(parsed: ParsedCsv, mapping: CsvMapping, stocks: Stock[], existing: Trade[]): CsvImportResult {
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
      const trade: Trade = { id: csvId(row, index), stockId: stock.id, stockName: stock.name, planId: null, tradeType, tradedAt, quantity, price, currency, exchangeRate, fee: optionalNumber(value(row, mapping.fee)), tax: optionalNumber(value(row, mapping.tax)), accountName: value(row, mapping.accountName) || "CSV 가져오기", memo: "증권사 CSV 가져오기", emotion: "평온", emotionIntensity: 1, confidenceScore: 3, ruleComplianceScore: 3, ruleViolations: [], createdAt: now, updatedAt: now, deletedAt: null };
      const key = fingerprint(trade);
      if (fingerprints.has(key)) { skippedDuplicates += 1; return; }
      fingerprints.add(key); trades.push(trade);
    } catch (error) { errors.push({ row: index + 2, message: error instanceof Error ? error.message : "행을 변환하지 못했습니다." }); }
  });
  return { trades, errors, skippedDuplicates };
}

function detectDelimiter(text: string) { const first = text.split(/\r?\n/, 1)[0] ?? ""; const tabs = (first.match(/\t/g) ?? []).length; const commas = (first.match(/,/g) ?? []).length; const semicolons = (first.match(/;/g) ?? []).length; return tabs > commas && tabs > semicolons ? "\t" : semicolons > commas ? ";" : ","; }
function normalizeHeader(value: string) { return value.toLowerCase().replace(/[\s_()\-/]/g, ""); }
function normalizeTicker(value: string) { return value.trim().replace(/^'/, "").toUpperCase().replace(/\s/g, ""); }
function normalizeName(value: string) { return value.trim().toLowerCase().replace(/\s/g, ""); }
function value(row: string[], index?: number) { return index === undefined ? "" : row[index]?.trim() ?? ""; }
function optionalNumber(value: string) { if (!value) return 0; const negative = /^\(.*\)$/.test(value); const parsed = Number(value.replace(/[,$₩원\s()]/g, "")); if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`숫자 형식이 올바르지 않습니다: ${value}`); return negative ? -parsed : parsed; }
function parsePositive(value: string, label: string) { const parsed = optionalNumber(value); if (parsed <= 0) throw new Error(`${label}은 0보다 커야 합니다.`); return parsed; }
function parseTradeType(value: string): "매수" | "매도" { const normalized = value.trim().toLowerCase(); if (["매수", "buy", "b"].includes(normalized) || normalized.includes("매수")) return "매수"; if (["매도", "sell", "s"].includes(normalized) || normalized.includes("매도")) return "매도"; throw new Error(`매수/매도 구분을 확인해 주세요: ${value || "미입력"}`); }
function parseCurrency(value: string, fallback: Stock["currency"]): Trade["currency"] { const normalized = value.trim().toUpperCase(); if (!normalized) return fallback; if (normalized === "KRW" || normalized === "원" || normalized === "원화") return "KRW"; if (normalized === "USD" || normalized === "달러") return "USD"; if (normalized === "JPY" || normalized === "엔" || normalized === "엔화") return "JPY"; if (normalized === "EUR" || normalized === "유로") return "EUR"; throw new Error(`지원하지 않는 통화입니다: ${value}`); }
function parseDateTime(dateValue: string, timeValue: string) {
  if (!dateValue) throw new Error("거래일이 없습니다.");
  let date = dateValue.trim().replace(/[./]/g, "-");
  if (/^\d{8}$/.test(date)) date = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(date)) { const [year, month, day] = date.split("-"); date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`; }
  const time = timeValue ? normalizeTime(timeValue) : date.includes("T") || /\d \d/.test(date) ? "" : "09:00";
  const combined = time ? `${date}T${time}` : date.replace(" ", "T");
  if (!Number.isFinite(Date.parse(combined))) throw new Error(`거래일 형식을 확인해 주세요: ${dateValue}`);
  return combined.slice(0, 16);
}
function normalizeTime(value: string) { const digits = value.trim(); if (/^\d{6}$/.test(digits)) return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`; if (/^\d{4}$/.test(digits)) return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`; return digits; }
function fingerprint(trade: Trade) { return [trade.tradedAt.slice(0, 16), trade.stockId, trade.tradeType, trade.quantity, trade.price, trade.accountName].join("|"); }
function csvId(row: string[], index: number) { let hash = 2166136261; for (const char of `${row.join("|")}|${index}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return `csv-${(hash >>> 0).toString(36)}-${index + 2}`; }
