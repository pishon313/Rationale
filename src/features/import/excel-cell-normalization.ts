import type { CellObject, WorkBook, WorkSheet } from "@e965/xlsx";

type XlsxModule = typeof import("@e965/xlsx");

export type ExcelDateSystem = "1900" | "1904";

type ParsedExcelDateCode = {
  D: number;
  T: number;
  u: number;
  y: number;
  m: number;
  d: number;
  H: number;
  M: number;
  S: number;
};

export function workbookDateSystem(workbook: Pick<WorkBook, "Workbook">): ExcelDateSystem {
  const raw = (workbook.Workbook?.WBProps as { date1904?: unknown } | undefined)?.date1904;
  return raw === true || raw === 1 || raw === "1" || raw === "true" ? "1904" : "1900";
}

export function excelCellToImportText(
  XLSX: XlsxModule,
  cell: CellObject | undefined,
  dateSystem: ExcelDateSystem,
): string {
  if (!cell || cell.t === "z" || cell.v === undefined || cell.v === null) return "";
  const numberFormat = typeof cell.z === "string" ? cell.z : "";
  if (cell.t === "n" && typeof cell.v === "number" && numberFormat && XLSX.SSF.is_date(numberFormat)) {
    const normalized = normalizeTypedExcelDate(XLSX, cell.v, numberFormat, dateSystem);
    if (normalized !== null) return normalized;
  }
  return formattedCellText(XLSX, cell);
}

export function worksheetToImportRows(
  XLSX: XlsxModule,
  sheet: WorkSheet,
  dateSystem: ExcelDateSystem,
): string[][] {
  if (!sheet["!ref"]) return [];
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const rows: string[][] = [];
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row: string[] = [];
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      row.push(excelCellToImportText(XLSX, sheet[address] as CellObject | undefined, dateSystem).trim());
    }
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

function normalizeTypedExcelDate(
  XLSX: XlsxModule,
  serial: number,
  numberFormat: string,
  dateSystem: ExcelDateSystem,
): string | null {
  if (!Number.isFinite(serial)) return null;
  const parsed = XLSX.SSF.parse_date_code(serial, { date1904: dateSystem === "1904" }) as ParsedExcelDateCode | null;
  if (!validDateCode(parsed)) return null;
  const format = analyzeDateFormat(numberFormat);
  const timeOnly = serial >= 0 && serial < 1 && format.hasTime && !format.hasDate;
  const hasSubsecond = parsed.u !== 0;
  const hasTimeValue = parsed.H !== 0 || parsed.M !== 0 || parsed.S !== 0 || hasSubsecond;
  const includeSeconds = parsed.S !== 0 || hasSubsecond || format.hasSeconds;
  const time = formatClock(parsed, includeSeconds);
  if (timeOnly) return time;

  const date = `${pad(parsed.y, 4)}-${pad(parsed.m)}-${pad(parsed.d)}`;
  return hasTimeValue || format.hasTime ? `${date} ${time}` : date;
}

function formattedCellText(XLSX: XlsxModule, cell: CellObject) {
  if (typeof cell.w === "string") return cell.w;
  try {
    const formatted = XLSX.utils.format_cell(cell);
    if (typeof formatted === "string") return formatted;
  } catch {
    // Preserve a deterministic raw fallback when the workbook format is invalid.
  }
  return String(cell.v ?? "");
}

function validDateCode(value: ParsedExcelDateCode | null): value is ParsedExcelDateCode {
  if (!value) return false;
  return [value.D, value.T, value.u, value.y, value.m, value.d, value.H, value.M, value.S].every(Number.isFinite);
}

function formatClock(value: ParsedExcelDateCode, includeSeconds: boolean) {
  const base = `${pad(value.H)}:${pad(value.M)}`;
  return includeSeconds ? `${base}:${pad(value.S)}` : base;
}

function pad(value: number, length = 2) {
  return String(Math.trunc(value)).padStart(length, "0");
}

function analyzeDateFormat(format: string) {
  const tokens = format
    .replace(/"(?:[^"]|"")*"/g, "")
    .replace(/\\.|_.|\*./g, "")
    .replace(/\[([^\]]*)\]/g, (_match, content: string) => /^[hms]+$/i.test(content.trim()) ? content : "")
    .toLowerCase();
  const hasSeconds = tokens.includes("s");
  const hasTime = tokens.includes("h") || hasSeconds || tokens.includes("am/pm") || tokens.includes("a/p");
  const hasYearDayOrEra = /[ydeg]/.test(tokens);
  const hasMonth = tokens.includes("m");
  return { hasDate: hasYearDayOrEra || (hasMonth && !hasTime), hasTime, hasSeconds };
}
