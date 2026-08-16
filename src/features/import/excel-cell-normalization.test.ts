import { describe, expect, it } from "vitest";
import * as XLSX from "@e965/xlsx";
import { parseExecutionDateTime } from "./import-pipeline";
import { excelCellToImportText, workbookDateSystem, worksheetToImportRows } from "./excel-cell-normalization";

const dateSerial = 46232;
const seconds = (hours: number, minutes: number, value = 0) => (hours * 3600 + minutes * 60 + value) / 86400;

describe("typed Excel cell normalization", () => {
  it.each(["m/d/yy", "mm-dd-yy", "yyyy-mm-dd", "dd/mm/yyyy", 'yyyy"년" m"월" d"일"'])
    ("normalizes %s from the underlying serial instead of display text", (numberFormat) => {
      expect(excelCellToImportText(XLSX, { t: "n", v: dateSerial, z: numberFormat }, "1900")).toBe("2026-07-29");
    });

  it("normalizes date-time values without losing seconds to floating-point noise", () => {
    const value = dateSerial + seconds(10, 31, 2);
    const normalized = excelCellToImportText(XLSX, { t: "n", v: value, z: "yyyy-mm-dd hh:mm:ss" }, "1900");
    expect(normalized).toBe("2026-07-29 10:31:02");
    expect(parseExecutionDateTime(normalized)).toEqual({ value: "2026-07-29T10:31:02", timePrecision: "second" });
  });

  it("normalizes meaningful fractional seconds deterministically to whole seconds", () => {
    const value = dateSerial + seconds(10, 31, 2.75);
    expect(excelCellToImportText(XLSX, { t: "n", v: value, z: "yyyy-mm-dd hh:mm:ss.000" }, "1900")).toBe("2026-07-29 10:31:02");
  });

  it("keeps exact-minute date-times at minute precision when the format has no seconds", () => {
    const value = dateSerial + seconds(10, 31);
    const normalized = excelCellToImportText(XLSX, { t: "n", v: value, z: "yyyy-mm-dd hh:mm" }, "1900");
    expect(normalized).toBe("2026-07-29 10:31");
    expect(parseExecutionDateTime(normalized)).toEqual({ value: "2026-07-29T10:31:00", timePrecision: "minute" });
  });

  it("normalizes time-only cells without emitting a fake 1900 date", () => {
    const minute = excelCellToImportText(XLSX, { t: "n", v: seconds(10, 31), z: "hh:mm" }, "1900");
    expect(minute).toBe("10:31");
    expect(parseExecutionDateTime("2026-07-29", minute)).toEqual({ value: "2026-07-29T10:31:00", timePrecision: "minute" });
    expect(excelCellToImportText(XLSX, { t: "n", v: seconds(10, 31, 2), z: "hh:mm:ss" }, "1900")).toBe("10:31:02");
    expect(excelCellToImportText(XLSX, { t: "n", v: seconds(10, 31), z: "[$-en-US]h:mm AM/PM" }, "1900")).toBe("10:31");
  });

  it("supports 1904 workbooks and normalizes the flag representations seen in parsed files", () => {
    expect(excelCellToImportText(XLSX, { t: "n", v: 44770, z: "m/d/yy" }, "1904")).toBe("2026-07-29");
    for (const raw of [true, 1, "1", "true"]) {
      const workbook = { Workbook: { WBProps: { date1904: raw } } } as unknown as Pick<XLSX.WorkBook, "Workbook">;
      expect(workbookDateSystem(workbook)).toBe("1904");
    }
    expect(workbookDateSystem({ Workbook: { WBProps: { date1904: false } } })).toBe("1900");
  });

  it("preserves leading zeros and formatted non-date numbers", () => {
    expect(excelCellToImportText(XLSX, { t: "n", v: 5930, z: "000000" }, "1900")).toBe("005930");
    expect(excelCellToImportText(XLSX, { t: "n", v: 46232, z: "General" }, "1900")).toBe("46232");
    expect(excelCellToImportText(XLSX, { t: "n", v: 1234.5, z: "#,##0.00" }, "1900")).toBe("1,234.50");
    expect(excelCellToImportText(XLSX, { t: "n", v: 0.25, z: "0%" }, "1900")).toBe("25%");
  });

  it("uses a cached formula result without evaluating the formula", () => {
    expect(excelCellToImportText(XLSX, { t: "n", v: dateSerial, z: "m/d/yy", f: "DATE(2026,7,29)" }, "1900")).toBe("2026-07-29");
    expect(excelCellToImportText(XLSX, { t: "b", v: true }, "1900")).toBe("TRUE");
  });

  it.each(["7/29/26", "07/29/26", "29/07/26", "7/8/26"])("leaves text %s untrusted and rejected", (value) => {
    expect(excelCellToImportText(XLSX, { t: "s", v: value }, "1900")).toBe(value);
    expect(() => parseExecutionDateTime(value)).toThrow("IMPORT_INVALID_DATE");
  });

  it("leaves invalid serials on the existing row-level rejection path", () => {
    const serial60 = excelCellToImportText(XLSX, { t: "n", v: 60, z: "yyyy-mm-dd" }, "1900");
    expect(serial60).toBe("1900-02-29");
    expect(() => parseExecutionDateTime(serial60)).toThrow("IMPORT_INVALID_DATE");
    for (const value of [-1, 2958466, Number.NaN, Number.POSITIVE_INFINITY]) {
      const normalized = excelCellToImportText(XLSX, { t: "n", v: value, z: "yyyy-mm-dd" }, "1900");
      expect(() => parseExecutionDateTime(normalized)).toThrow();
    }
  });

  it("filters fully blank rows while retaining blank cells inside the used range", () => {
    const sheet = XLSX.utils.aoa_to_sheet([["첫째", "둘째", "셋째"], [], ["값", null, "끝"]]);
    expect(worksheetToImportRows(XLSX, sheet, "1900")).toEqual([["첫째", "둘째", "셋째"], ["값", "", "끝"]]);
  });
});
