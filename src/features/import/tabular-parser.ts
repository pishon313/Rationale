import { buildTabularColumns, detectImportMapping } from "./column-mapping";
import type { ParsedTabularFile } from "./import-types";

const maximumFileSize = 10 * 1024 * 1024;

export async function parseImportFile(file: File): Promise<ParsedTabularFile> {
  if (file.size > maximumFileSize) throw new Error("10MB 이하 파일을 선택해 주세요.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "xls" || extension === "xlsx") return ensureUsable(await parseExcelImport(await file.arrayBuffer()));
  if (extension === "csv" || extension === "tsv") return ensureUsable(parseDelimitedImport(decodeDelimitedText(await file.arrayBuffer())));
  throw new Error("CSV, TSV, XLS 또는 XLSX 파일을 선택해 주세요.");
}

export function parseDelimitedImport(text: string): ParsedTabularFile {
  const source = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(source);
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell.trim()); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) records.push(row);
      row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("따옴표가 닫히지 않은 행이 있어 파일을 안전하게 읽을 수 없습니다.");
  row.push(cell.trim());
  if (row.some(Boolean)) records.push(row);
  const headers = records[0] ?? [];
  return { columns: buildTabularColumns(headers), rows: records.slice(1) };
}

export async function parseExcelImport(buffer: ArrayBuffer): Promise<ParsedTabularFile> {
  const XLSX = await import("@e965/xlsx");
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("엑셀 파일에서 시트를 찾지 못했습니다.");
  const sheet = workbook.Sheets[firstSheetName];
  const records = XLSX.utils.sheet_to_json<Array<string | number | boolean | Date>>(sheet, {
    header: 1, defval: "", raw: false, dateNF: "yyyy-mm-dd hh:mm:ss",
  });
  const rows = records.map((row) => row.map((cell) => String(cell ?? "").trim())).filter((row) => row.some(Boolean));
  return ensureUsable({ columns: buildTabularColumns(rows[0] ?? []), rows: rows.slice(1), sheetName: firstSheetName });
}

type DecodedCandidate = { text: string; score: number };

export function decodeDelimitedText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const bomEncoding = detectBomEncoding(bytes);
  const encodings = ["utf-8", "utf-16le", "utf-16be", "euc-kr", "windows-949", "cp949", "shift_jis", "windows-1252"];
  const candidates: DecodedCandidate[] = [];
  encodings.forEach((encoding, priority) => {
    try {
      const text = new TextDecoder(encoding).decode(bytes);
      const parsed = parseDelimitedImport(text);
      const mappedFields = Object.keys(detectImportMapping(parsed.columns).mapping).length;
      const damage = count(text, /\uFFFD/g) * 2_000 + count(text, /\0/g) * 1_000 + count(text, /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g) * 500;
      candidates.push({ text, score: (encoding === bomEncoding ? 1_000_000 : 0) + mappedFields * 10_000 - damage - priority });
    } catch {
      // Unsupported decoders and malformed candidate decodings are ignored.
    }
  });
  const best = candidates.sort((left, right) => right.score - left.score)[0];
  if (!best) throw new Error("파일 문자 인코딩을 읽을 수 없습니다.");
  return best.text.replace(/^\uFEFF/, "");
}

function detectDelimiter(text: string) {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const scores = [["\t", count(first, /\t/g)], [",", count(first, /,/g)], [";", count(first, /;/g)]] as const;
  return [...scores].sort((left, right) => right[1] - left[1])[0][0];
}

function detectBomEncoding(bytes: Uint8Array) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  return null;
}

function ensureUsable(parsed: ParsedTabularFile) {
  if (!parsed.columns.length || !parsed.rows.length) throw new Error("첫 번째 시트에서 헤더와 거래 행을 찾지 못했습니다.");
  return parsed;
}

function count(value: string, pattern: RegExp) { return value.match(pattern)?.length ?? 0; }
