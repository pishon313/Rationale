import { describe, expect, it } from "vitest";
import type { Stock } from "@/features/stocks/types";
import * as XLSX from "@e965/xlsx";
import { convertCsvRows, detectCsvMapping, parseCsv, parseExcelWorkbook } from "./csv-import";

const stocks = [{ id: "s1", ticker: "005930", name: "삼성전자", currency: "KRW", deletedAt: null }] as Stock[];

describe("CSV import", () => {
  it("쉼표와 따옴표를 포함한 CSV를 읽고 열을 자동 인식한다", () => {
    const parsed = parseCsv('체결일자,종목코드,종목명,매매구분,체결수량,체결가,수수료\n2026-08-01,005930,"삼성전자, 보통주",매수,10,"70,000",100');
    const mapping = detectCsvMapping(parsed.headers);
    expect(mapping).toMatchObject({ tradedAt: 0, ticker: 1, tradeType: 3, quantity: 4, price: 5 });
    const result = convertCsvRows(parsed, mapping, stocks, []);
    expect(result.trades[0]).toMatchObject({ stockId: "s1", tradeType: "매수", quantity: 10, price: 70000, fee: 100 });
  });

  it("중복 거래와 종목을 찾지 못한 행을 구분한다", () => {
    const parsed = parseCsv("거래일,종목코드,구분,수량,가격\n20260801,005930,매수,1,70000\n20260801,UNKNOWN,매수,1,10");
    const mapping = detectCsvMapping(parsed.headers);
    const first = convertCsvRows({ ...parsed, rows: parsed.rows.slice(0, 1) }, mapping, stocks, []).trades[0];
    const result = convertCsvRows(parsed, mapping, stocks, [first]);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.errors[0].row).toBe(3);
  });

  it.each(["xlsx", "xls"] as const)(".%s 첫 시트를 읽어 기존 변환 흐름에 연결한다", async (bookType) => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["체결일자", "종목코드", "매매구분", "체결수량", "체결가"],
      ["2026-08-01", "005930", "매수", 3, 71000],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "거래내역");
    const bytes = XLSX.write(workbook, { type: "array", bookType });
    const parsed = await parseExcelWorkbook(bytes);
    const result = convertCsvRows(parsed, detectCsvMapping(parsed.headers), stocks, []);
    expect(result.errors).toHaveLength(0);
    expect(result.trades[0]).toMatchObject({ stockId: "s1", quantity: 3, price: 71000 });
  });
});
