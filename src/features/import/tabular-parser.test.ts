import { describe, expect, it } from "vitest";
import * as XLSX from "@e965/xlsx";
import { detectImportMapping, resolveColumnIndex } from "./column-mapping";
import { decodeDelimitedText, parseDelimitedImport, parseExcelImport, parseImportFile } from "./tabular-parser";

describe("tabular import parser", () => {
  it("parses quoted commas, escaped quotes, and quoted newlines", () => {
    const parsed = parseDelimitedImport('거래일,종목명,메모\n2026-08-01,"삼성전자, 보통주","첫 줄\n""둘째 줄"""');
    expect(parsed.rows).toEqual([["2026-08-01", "삼성전자, 보통주", '첫 줄\n"둘째 줄"']]);
  });

  it.each([
    [",", "거래일,종목코드\n2026-08-01,005930"],
    ["tab", "거래일\t종목코드\n2026-08-01\t005930"],
    [";", "거래일;종목코드\n2026-08-01;005930"],
  ])("detects %s-delimited text", (_label, source) => {
    expect(parseDelimitedImport(source).rows[0]).toEqual(["2026-08-01", "005930"]);
  });

  it("rejects an unclosed quoted field", () => {
    expect(() => parseDelimitedImport('거래일,종목명\n2026-08-12,"삼성전자')).toThrow("따옴표");
  });

  it.each(["le", "be"] as const)("decodes UTF-16 %s", (byteOrder) => {
    const source = "체결일자,종목코드,매매구분,체결수량,체결가\n2026-08-01,005930,매수,3,71000";
    const decoded = decodeDelimitedText(encodeUtf16(source, byteOrder).buffer);
    const parsed = parseDelimitedImport(decoded);
    expect(detectImportMapping(parsed.columns).mapping).toMatchObject({ tradedAt: parsed.columns[0].reference, ticker: parsed.columns[1].reference });
  });

  it.each([
    ["EUC-KR / CP949", [195,188,176,225,192,207,192,218,44,193,190,184,241,196,218,181,229,44,184,197,184,197,177,184,186,208,44,195,188,176,225,188,246,183,174,44,195,188,176,225,176,161,10,50,48,50,54,45,48,56,45,48,49,44,48,48,53,57,51,48,44,184,197,188,246,44,51,44,55,49,48,48,48]],
    ["Shift-JIS", [150,241,146,232,147,250,44,150,193,149,191,131,82,129,91,131,104,44,148,132,148,131,139,230,149,170,44,150,241,146,232,144,148,151,202,44,150,241,146,232,137,191,138,105,10,50,48,50,54,45,48,56,45,48,49,44,48,48,53,57,51,48,44,148,131,149,116,44,51,44,55,49,48,48,48]],
    ["Windows-1252", [68,97,116,101,32,100,39,101,120,233,99,117,116,105,111,110,44,84,105,99,107,101,114,44,83,105,100,101,44,81,117,97,110,116,105,116,121,44,80,114,105,99,101,10,50,48,50,54,45,48,56,45,48,49,44,48,48,53,57,51,48,44,66,117,121,44,51,44,55,49,48,48,48]],
  ] as const)("decodes %s legacy text without replacement characters", (_encoding, bytes) => {
    const decoded = decodeDelimitedText(new Uint8Array(bytes).buffer);
    const parsed = parseDelimitedImport(decoded);
    expect(decoded).not.toContain("�");
    expect(detectImportMapping(parsed.columns).mapping).toMatchObject({ tradedAt: parsed.columns[0].reference, ticker: parsed.columns[1].reference });
  });

  it.each(["xlsx", "xls"] as const)("reads the first .%s sheet", async (bookType) => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["체결일자", "종목코드"], ["2026-08-01 10:11:12", "005930"]]), "거래내역");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["무시"]]), "두번째");
    const parsed = await parseExcelImport(XLSX.write(workbook, { type: "array", bookType }));
    expect(parsed.sheetName).toBe("거래내역");
    expect(parsed.rows[0]).toEqual(["2026-08-01 10:11:12", "005930"]);
  });

  it("enforces file extensions and the 10 MB limit before parsing", async () => {
    await expect(parseImportFile(new File(["x"], "broker.txt"))).rejects.toThrow("CSV, TSV");
    const large = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "broker.csv");
    await expect(parseImportFile(large)).rejects.toThrow("10MB");
  });

  it("rejects files without both a usable header and data row", async () => {
    await expect(parseImportFile(new File(["거래일,종목코드"], "empty.csv"))).rejects.toThrow("헤더와 거래 행");
  });

  it("preserves duplicate headers through zero-based occurrence references", () => {
    const parsed = parseDelimitedImport("가격,가격\n10,11");
    expect(parsed.columns.map((column) => column.reference)).toEqual([{ normalizedHeader: "가격", occurrence: 0 }, { normalizedHeader: "가격", occurrence: 1 }]);
    expect(resolveColumnIndex(parsed.columns, { normalizedHeader: "가격", occurrence: 1 })).toBe(1);
  });
});

function encodeUtf16(value: string, byteOrder: "le" | "be") {
  const bytes = new Uint8Array(2 + value.length * 2);
  bytes[0] = byteOrder === "le" ? 0xff : 0xfe; bytes[1] = byteOrder === "le" ? 0xfe : 0xff;
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < value.length; index += 1) view.setUint16(2 + index * 2, value.charCodeAt(index), byteOrder === "le");
  return bytes;
}
