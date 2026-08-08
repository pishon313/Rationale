import { describe, expect, it } from "vitest";
import type { Stock } from "@/features/stocks/types";
import * as XLSX from "@e965/xlsx";
import { convertCsvRows, detectCsvMapping, parseCsv, parseExcelWorkbook, parseTradeFile } from "./csv-import";

const stocks = [{ id: "s1", ticker: "005930", name: "삼성전자", currency: "KRW", deletedAt: null }] as Stock[];
const accounts = [{ id: "account-1", name: "기본 계좌", institution: "", kind: "brokerage" as const, subtype: "", baseCurrency: "KRW" as const, isDefault: true, archivedAt: null, memo: "", createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z" }];

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

  it("계좌 열이 없으면 선택한 target account를 적용한다", () => {
    const parsed = parseCsv("거래일,종목코드,구분,수량,가격\n2026-08-01,005930,매수,1,70000");
    const result = convertCsvRows(parsed, detectCsvMapping(parsed.headers), stocks, [], { accounts, targetAccountId: "account-1" });
    expect(result.trades[0]).toMatchObject({ accountId: "account-1", accountName: "기본 계좌" });
  });

  it("등록되지 않은 CSV 계좌명을 자동 생성하지 않고 오류로 표시한다", () => {
    const parsed = parseCsv("거래일,종목코드,구분,수량,가격,계좌명\n2026-08-01,005930,매수,1,70000,알 수 없는 계좌");
    const result = convertCsvRows(parsed, detectCsvMapping(parsed.headers), stocks, [], { accounts });
    expect(result.trades).toHaveLength(0); expect(result.errors[0].message).toContain("등록되지 않은 계좌");
  });

  it("소수 쉼표와 미국·유럽식 천 단위 표기를 안전하게 숫자로 바꾼다", () => {
    const parsed = parseCsv([
      "거래일;종목코드;구분;수량;가격;수수료",
      "2026-08-01;005930;매수;12,34;1.234,56;€\u00a01,25",
      "2026-08-02;005930;매수;1,234;1,234.56;￥\u202f10",
    ].join("\n"));
    const result = convertCsvRows(parsed, detectCsvMapping(parsed.headers), stocks, []);
    expect(result.errors).toHaveLength(0);
    expect(result.trades[0]).toMatchObject({ quantity: 12.34, price: 1234.56, fee: 1.25 });
    expect(result.trades[1]).toMatchObject({ quantity: 1234, price: 1234.56, fee: 10 });
  });

  it("해석이 두 가지인 날짜는 임의로 선택하지 않고 ISO 형식을 안내한다", () => {
    const parsed = parseCsv("거래일,종목코드,구분,수량,가격\n01/08/2026,005930,매수,1,70000");
    const result = convertCsvRows(parsed, detectCsvMapping(parsed.headers), stocks, []);
    expect(result.trades).toHaveLength(0);
    expect(result.errors[0]).toMatchObject({ row: 2 });
    expect(result.errors[0].message).toContain("YYYY-MM-DD");
  });

  it.each([
    ["31/08/2026", "2026-08-31T09:00"],
    ["08/31/2026", "2026-08-31T09:00"],
  ])("모호하지 않은 DMY/MDY 날짜 %s를 읽는다", (rawDate, expected) => {
    const parsed = parseCsv(`거래일,종목코드,구분,수량,가격\n${rawDate},005930,매수,1,70000`);
    const result = convertCsvRows(parsed, detectCsvMapping(parsed.headers), stocks, []);
    expect(result.errors).toHaveLength(0);
    expect(result.trades[0].tradedAt).toBe(expected);
  });

  it.each(["le", "be"] as const)("UTF-16 %s CSV를 ArrayBuffer에서 디코딩한다", async (byteOrder) => {
    const source = "체결일자,종목코드,매매구분,체결수량,체결가\n2026-08-01,005930,매수,3,71000";
    const bytes = encodeUtf16(source, byteOrder);
    const parsed = await parseTradeFile(new File([bytes], "broker.csv", { type: "text/csv" }));
    const result = convertCsvRows(parsed, detectCsvMapping(parsed.headers), stocks, []);
    expect(result.errors).toHaveLength(0);
    expect(result.trades[0]).toMatchObject({ stockId: "s1", quantity: 3, price: 71000 });
  });

  it.each([
    {
      language: "일본어",
      csv: "約定日,銘柄コード,売買区分,約定数量,約定価格,通貨\n2026-08-01,005930,買付,2,70000,日本円",
      tradeType: "매수",
      currency: "JPY",
    },
    {
      language: "영어",
      csv: "Execution Date,Ticker,Side,Quantity,Execution Price,Currency\n2026-08-01,005930,Sell,2,70000,US Dollar",
      tradeType: "매도",
      currency: "USD",
    },
    {
      language: "프랑스어",
      csv: "Date d’exécution,Code valeur,Sens,Quantité,Prix d’exécution,Devise\n2026-08-01,005930,Achat,2,70000,Euro",
      tradeType: "매수",
      currency: "EUR",
    },
    {
      language: "이탈리아어",
      csv: "Data di esecuzione,Codice titolo,Tipo operazione,Quantità,Prezzo di esecuzione,Valuta\n2026-08-01,005930,Vendita,2,70000,Dollaro statunitense",
      tradeType: "매도",
      currency: "USD",
    },
    {
      language: "스페인어",
      csv: "Fecha de ejecución,Código del valor,Tipo de operación,Cantidad,Precio de ejecución,Moneda\n2026-08-01,005930,Compra,2,70000,Dólar estadounidense",
      tradeType: "매수",
      currency: "USD",
    },
  ] as const)("$language 헤더와 거래·통화 표현을 한국어 기준값으로 변환한다", ({ csv, tradeType, currency }) => {
    const parsed = parseCsv(csv);
    const mapping = detectCsvMapping(parsed.headers);
    expect(mapping).toMatchObject({ tradedAt: 0, ticker: 1, tradeType: 2, quantity: 3, price: 4, currency: 5 });
    const result = convertCsvRows(parsed, mapping, stocks, []);
    expect(result.errors).toHaveLength(0);
    expect(result.trades[0]).toMatchObject({ tradeType, currency });
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

function encodeUtf16(value: string, byteOrder: "le" | "be") {
  const bytes = new Uint8Array(2 + value.length * 2);
  bytes[0] = byteOrder === "le" ? 0xff : 0xfe;
  bytes[1] = byteOrder === "le" ? 0xfe : 0xff;
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < value.length; index += 1) {
    view.setUint16(2 + index * 2, value.charCodeAt(index), byteOrder === "le");
  }
  return bytes;
}
