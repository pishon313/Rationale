import { describe, expect, it } from "vitest";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { buildTabularColumns, detectImportMapping, exactProfileToAutoApply, headerSignature, profileMatch, validateImportMapping } from "./column-mapping";
import { adaptTabularRow, buildImportPreview, parseExecutionDateTime, parseOptionalNumber, preflightImport } from "./import-pipeline";
import type { ImportContext, ImportMappingProfile, ParsedTabularFile } from "./import-types";
import { parseDelimitedImport } from "./tabular-parser";

const now = "2026-08-12T00:00:00.000Z";
const accounts: InvestmentAccount[] = [{ id: "a1", name: "기본 계좌", institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: true, archivedAt: null, memo: "", createdAt: now, updatedAt: now }];
const stocks = [{ id: "s1", ticker: "005930", name: "삼성전자", currency: "KRW", deletedAt: null }] as Stock[];

function table(rows: string[]) {
  return parseDelimitedImport(["거래일시,종목코드,구분,수량,가격,수수료,세금,체결 ID,주문 ID", ...rows].join("\n"));
}

async function preview(rows: string[], existingTrades: Trade[] = []) {
  const parsed = table(rows);
  return buildImportPreview(parsed, detectImportMapping(parsed.columns).mapping, { stocks, accounts, existingTrades, targetAccountId: "a1", provider: "broker", importedAt: now });
}

async function previewCsv(source: string, overrides: Partial<ImportContext> = {}) {
  const parsed = parseDelimitedImport(source);
  return buildImportPreview(parsed, detectImportMapping(parsed.columns).mapping, {
    stocks, accounts, existingTrades: [], targetAccountId: "a1", provider: "broker", importedAt: now, ...overrides,
  });
}

describe("Import Pipeline v1", () => {
  it("preserves seconds and records minute/date precision", () => {
    expect(parseExecutionDateTime("2026-08-12T10:11:12").value).toBe("2026-08-12T10:11:12");
    expect(parseExecutionDateTime("2026-08-12T10:11")).toMatchObject({ value: "2026-08-12T10:11:00", timePrecision: "minute" });
    expect(parseExecutionDateTime("2026-08-12")).toMatchObject({ value: "2026-08-12T09:00:00", timePrecision: "date" });
    expect(parseExecutionDateTime("20260812", "101113").value).toBe("2026-08-12T10:11:13");
    expect(parseExecutionDateTime("20260812", "1011")).toMatchObject({ value: "2026-08-12T10:11:00", timePrecision: "minute" });
  });

  it("rejects ambiguous dates instead of guessing", () => {
    expect(() => parseExecutionDateTime("08/09/2026", "10:00:00")).toThrow("IMPORT_AMBIGUOUS_DATE");
    expect(parseExecutionDateTime("31/08/2026", "10:00:00").value).toBe("2026-08-31T10:00:00");
    expect(parseExecutionDateTime("08/31/2026", "10:00:00").value).toBe("2026-08-31T10:00:00");
    expect(() => parseExecutionDateTime("2026-08-12", "25:00")).toThrow("IMPORT_INVALID_TIME");
  });

  it("preserves locale-aware numeric parsing", () => {
    expect(parseOptionalNumber("12,34")).toBe(12.34);
    expect(parseOptionalNumber("1.234,56")).toBe(1234.56);
    expect(parseOptionalNumber("1,234.56")).toBe(1234.56);
    expect(parseOptionalNumber("(€ 1,25)")).toBe(-1.25);
  });

  it.each([
    ["일본어", "約定日,銘柄コード,売買区分,約定数量,約定価格,通貨\n2026-08-01,005930,買付,2,70000,日本円", "buy", "JPY"],
    ["영어", "Execution Date,Ticker,Side,Quantity,Execution Price,Currency\n2026-08-01,005930,Sell,2,70000,US Dollar", "sell", "USD"],
    ["프랑스어", "Date d’exécution,Code valeur,Sens,Quantité,Prix d’exécution,Devise\n2026-08-01,005930,Achat,2,70000,Euro", "buy", "EUR"],
    ["이탈리아어", "Data di esecuzione,Codice titolo,Tipo operazione,Quantità,Prezzo di esecuzione,Valuta\n2026-08-01,005930,Vendita,2,70000,Dollaro statunitense", "sell", "USD"],
    ["스페인어", "Fecha de ejecución,Código del valor,Tipo de operación,Cantidad,Precio de ejecución,Moneda\n2026-08-01,005930,Compra,2,70000,Dólar estadounidense", "buy", "USD"],
  ] as const)("adapts %s aliases and canonical values", (_language, source, side, currency) => {
    const parsed = parseDelimitedImport(source);
    const mapping = detectImportMapping(parsed.columns).mapping;
    const rowBefore = [...parsed.rows[0]];
    const canonical = adaptTabularRow(parsed, parsed.rows[0], 2, 0, mapping, "batch", "broker");
    expect(canonical).toMatchObject({ side, currency, ticker: "005930", quantity: 2, price: 70000 });
    expect(parsed.rows[0]).toEqual(rowBefore);
  });

  it("keeps executions in the same minute distinct", async () => {
    const result = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,,", "2026-08-12T10:00:02,005930,매수,1,70000,0,0,,"]);
    expect(result.summary.ready).toBe(2);
    expect(result.candidates.map((candidate) => candidate.trade?.tradedAt)).toEqual(["2026-08-12T10:00:01", "2026-08-12T10:00:02"]);
  });

  it("assigns deterministic occurrence source keys and flags later identical rows for review", async () => {
    const result = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,,", "2026-08-12T10:00:01,005930,매수,1,70000,0,0,,"]);
    expect(result.summary.ready).toBe(1);
    expect(result.candidates[1]).toMatchObject({ status: "possible_duplicate", selectedByDefault: false });
    expect(result.candidates[0].trade?.origin?.sourceKey).not.toBe(result.candidates[1].trade?.origin?.sourceKey);
  });

  it("separates exact duplicates and conflicting reuse of an external execution ID", async () => {
    const first = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,exec-1,"]);
    const imported = first.candidates[0].trade as Trade;
    const exact = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,exec-1,"], [imported]);
    const conflict = await preview(["2026-08-12T10:00:01,005930,매수,2,70000,0,0,exec-1,"], [imported]);
    expect(exact.candidates[0]).toMatchObject({ status: "exact_duplicate", selectedByDefault: false });
    expect(conflict.candidates[0]).toMatchObject({ status: "source_conflict", selectedByDefault: false });
  });

  it("does not treat an order ID alone as execution identity", async () => {
    const result = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,,order-1", "2026-08-12T10:00:02,005930,매수,1,70000,0,0,,order-1"]);
    expect(result.summary.ready).toBe(2);
  });

  it("marks an economic match with a manual record as a possible duplicate", async () => {
    const imported = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,,"]);
    const manual = { ...(imported.candidates[0].trade as Trade), id: "manual", origin: { kind: "manual" as const }, journalStatus: "recorded" as const };
    const result = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,,"], [manual]);
    expect(result.candidates[0]).toMatchObject({ status: "possible_duplicate", selectedByDefault: false });
  });

  it("stores imported executions as unreviewed file imports", async () => {
    const result = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,exec-1,"]);
    expect(result.candidates[0].trade).toMatchObject({ journalStatus: "unreviewed", memo: "", origin: { kind: "fileImport", provider: "broker", externalExecutionId: "exec-1", importedAt: now } });
  });

  it("blocks atomic commit when selected candidates violate the ledger", async () => {
    const result = await preview(["2026-08-12T10:00:01,005930,매도,1,70000,0,0,,"]);
    const selected = new Set(result.candidates.map((candidate) => candidate.id));
    expect(preflightImport(result, selected, { existingTrades: [], accounts })).toMatchObject({ ok: false, issues: [{ code: "IMPORT_LEDGER_CONFLICT" }] });
  });

  it("rejects timezone-bearing generic file values instead of stripping the suffix", async () => {
    const result = await preview(["2026-08-12T10:00:01+09:00,005930,매수,1,70000,0,0,,"]);
    expect(result.candidates[0]).toMatchObject({ status: "rejected", issues: [{ code: "IMPORT_UNSUPPORTED_TIMEZONE" }] });
  });

  it("does not auto-map duplicate matching headers and blocks column collisions", () => {
    const columns = buildTabularColumns(["거래일", "거래일", "종목코드", "구분", "수량", "가격"]);
    const detected = detectImportMapping(columns);
    expect(detected.mapping.tradedAt).toBeUndefined();
    expect(detected.issues.some((issue) => issue.code === "IMPORT_AMBIGUOUS_COLUMN")).toBe(true);
    const collision = { ...detected.mapping, tradedAt: columns[0].reference, time: columns[0].reference };
    expect(validateImportMapping(collision, columns).some((issue) => issue.code === "IMPORT_COLUMN_COLLISION")).toBe(true);
  });

  it("reapplies mapping profiles after column reordering and detects compatible supersets", () => {
    const first = buildTabularColumns(["거래일", "종목코드", "구분", "수량", "가격"]);
    const profile: ImportMappingProfile = { id: "p", name: "Broker", version: 1, bindings: detectImportMapping(first).mapping, headerSignature: headerSignature(first), createdAt: now, updatedAt: now };
    expect(profileMatch(profile, buildTabularColumns(["가격", "수량", "구분", "종목코드", "거래일"]))).toBe("exact");
    expect(profileMatch(profile, buildTabularColumns(["가격", "수량", "구분", "종목코드", "거래일", "세금"]))).toBe("compatible");
  });

  it("does not silently auto-apply when multiple profiles match equally", () => {
    const columns = buildTabularColumns(["거래일", "종목코드", "구분", "수량", "가격"]);
    const base: ImportMappingProfile = { id: "p1", name: "One", version: 1, bindings: detectImportMapping(columns).mapping, headerSignature: headerSignature(columns), createdAt: now, updatedAt: now };
    expect(exactProfileToAutoApply([base, { ...base, id: "p2", name: "Two" }], columns)).toBeUndefined();
    expect(Object.keys(base)).not.toContain("rows");
  });

  it("fails a saved profile safely when a required header disappears", () => {
    const columns = buildTabularColumns(["거래일", "종목코드", "구분", "수량", "가격"]);
    const profile: ImportMappingProfile = { id: "p", name: "Broker", version: 1, bindings: detectImportMapping(columns).mapping, headerSignature: headerSignature(columns), createdAt: now, updatedAt: now };
    expect(profileMatch(profile, buildTabularColumns(["거래일", "종목코드", "구분", "수량"]))).toBe("incompatible");
  });

  it("rejects ambiguous account and instrument resolution", async () => {
    const parsed = table(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,,"]);
    const context = { stocks: [...stocks, { ...stocks[0], id: "s2" }], accounts: [...accounts, { ...accounts[0], id: "a2", isDefault: false }], existingTrades: [], targetAccountId: "a1", importedAt: now };
    const result = await buildImportPreview(parsed, detectImportMapping(parsed.columns).mapping, context);
    expect(result.candidates[0]).toMatchObject({ status: "rejected", issues: [{ code: "IMPORT_AMBIGUOUS_INSTRUMENT" }] });
  });

  it("resolves ticker-only, name-only, and matching ticker/name instruments", async () => {
    const tickerOnly = await previewCsv("거래일시,종목코드,구분,수량,가격\n2026-08-12T10:00:01,005930,매수,1,70000");
    const nameOnly = await previewCsv("거래일시,종목명,구분,수량,가격\n2026-08-12T10:00:01,삼성전자,매수,1,70000");
    const both = await previewCsv("거래일시,종목코드,종목명,구분,수량,가격\n2026-08-12T10:00:01,005930,삼성전자,매수,1,70000");
    for (const result of [tickerOnly, nameOnly, both]) expect(result.candidates[0]).toMatchObject({ status: "ready", trade: { stockId: "s1", accountId: "a1" } });
  });

  it("blocks conflicting, ambiguous, and unknown instruments without creating one", async () => {
    const other = { ...stocks[0], id: "s2", ticker: "000660", name: "SK하이닉스" } as Stock;
    const conflict = await previewCsv("거래일시,종목코드,종목명,구분,수량,가격\n2026-08-12T10:00:01,005930,SK하이닉스,매수,1,70000", { stocks: [...stocks, other] });
    const ambiguous = await previewCsv("거래일시,종목코드,구분,수량,가격\n2026-08-12T10:00:01,005930,매수,1,70000", { stocks: [...stocks, { ...stocks[0], id: "s3" } as Stock] });
    const unknown = await previewCsv("거래일시,종목코드,구분,수량,가격\n2026-08-12T10:00:01,UNKNOWN,매수,1,70000");
    expect(conflict.candidates[0].issues[0].code).toBe("IMPORT_INSTRUMENT_CONFLICT");
    expect(ambiguous.candidates[0].issues[0].code).toBe("IMPORT_AMBIGUOUS_INSTRUMENT");
    expect(unknown.candidates[0].issues[0].code).toBe("IMPORT_INSTRUMENT_NOT_FOUND");
    expect(unknown.candidates[0].trade).toBeUndefined();
  });

  it("resolves a unique account column and never falls back after a failed match", async () => {
    const source = (name: string) => `거래일시,종목코드,구분,수량,가격,계좌명\n2026-08-12T10:00:01,005930,매수,1,70000,${name}`;
    const unique = await previewCsv(source("기본 계좌"));
    const duplicate = await previewCsv(source("기본 계좌"), { accounts: [...accounts, { ...accounts[0], id: "a2", isDefault: false }] });
    const archivedAccount = { ...accounts[0], archivedAt: now };
    const archived = await previewCsv(source("기본 계좌"), { accounts: [archivedAccount] });
    const unknown = await previewCsv(source("없는 계좌"), { targetAccountId: "a1" });
    expect(unique.candidates[0]).toMatchObject({ status: "ready", trade: { accountId: "a1" } });
    expect(duplicate.candidates[0].issues[0].code).toBe("IMPORT_AMBIGUOUS_ACCOUNT");
    expect(archived.candidates[0].issues[0].code).toBe("IMPORT_ARCHIVED_ACCOUNT");
    expect(unknown.candidates[0].issues[0].code).toBe("IMPORT_ACCOUNT_NOT_FOUND");
  });

  it("requires an active selected target when no account column is mapped", async () => {
    const missing = await previewCsv("거래일시,종목코드,구분,수량,가격\n2026-08-12T10:00:01,005930,매수,1,70000", { targetAccountId: "" });
    const archived = await previewCsv("거래일시,종목코드,구분,수량,가격\n2026-08-12T10:00:01,005930,매수,1,70000", { accounts: [{ ...accounts[0], archivedAt: now }] });
    expect(missing.candidates[0].issues[0].code).toBe("IMPORT_ACCOUNT_REQUIRED");
    expect(archived.candidates[0].issues[0].code).toBe("IMPORT_ACCOUNT_REQUIRED");
  });

  it("classifies fallback source-key reimports and fee changes conservatively", async () => {
    const first = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,,"]);
    const imported = first.candidates[0].trade as Trade;
    const exact = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,,"], [imported]);
    const changedFee = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,100,0,,"], [imported]);
    expect(exact.candidates[0].status).toBe("exact_duplicate");
    expect(changedFee.candidates[0].status).toBe("source_conflict");
  });

  it("reuses deterministic occurrence identities when identical rows are reimported", async () => {
    const rows = ["2026-08-12T10:00:01,005930,매수,1,70000,0,0,,", "2026-08-12T10:00:01,005930,매수,1,70000,0,0,,"];
    const first = await preview(rows);
    const imported = first.candidates.map((candidate) => candidate.trade as Trade);
    const second = await preview(rows, imported);
    expect(second.candidates.map((candidate) => candidate.status)).toEqual(["exact_duplicate", "exact_duplicate"]);
  });

  it("reports malformed quoted files instead of accepting partial data", () => {
    expect(() => parseDelimitedImport('거래일,종목명\n2026-08-12,"삼성전자')).toThrow("따옴표");
  });

  it("keeps duplicate header references stable", () => {
    const parsed: ParsedTabularFile = { columns: buildTabularColumns(["가격", "가격"]), rows: [] };
    expect(parsed.columns.map((column) => column.reference)).toEqual([{ normalizedHeader: "가격", occurrence: 0 }, { normalizedHeader: "가격", occurrence: 1 }]);
  });

  it("produces a provider-neutral CanonicalExecution without Rationale IDs or journal fields", () => {
    const parsed = table(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,exec-1,order-1"]);
    const canonical = adaptTabularRow(parsed, parsed.rows[0], 2, 0, detectImportMapping(parsed.columns).mapping, "batch", "broker");
    expect(canonical).toMatchObject({ importBatchId: "batch", sourceRow: 2, sourceSequence: 0, externalExecutionId: "exec-1", externalOrderId: "order-1", ticker: "005930", side: "buy", timePrecision: "second" });
    expect(canonical).not.toHaveProperty("stockId"); expect(canonical).not.toHaveProperty("accountId"); expect(canonical).not.toHaveProperty("journalStatus");
  });

  it("blocks ambiguous ordering for multiple date-only executions", async () => {
    const result = await preview(["2026-08-12,005930,매수,1,70000,0,0,,", "2026-08-12,005930,매수,1,70000,0,0,,"]);
    expect(result.candidates.every((candidate) => candidate.status === "rejected" && candidate.issues.some((issue) => issue.code === "IMPORT_AMBIGUOUS_INTRADAY_ORDER"))).toBe(true);
  });

  it("blocks a date-only execution when a timed candidate or existing event shares its day", async () => {
    const mixed = await preview(["2026-08-12,005930,매수,1,70000,0,0,,", "2026-08-12T10:00:01,005930,매수,1,70000,0,0,,"]);
    expect(mixed.candidates[0]).toMatchObject({ status: "rejected", issues: expect.arrayContaining([expect.objectContaining({ code: "IMPORT_AMBIGUOUS_INTRADAY_ORDER" })]) });
    const existingPreview = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,,"]);
    const withExisting = await preview(["2026-08-12,005930,매수,1,70000,0,0,,"], [existingPreview.candidates[0].trade as Trade]);
    expect(withExisting.candidates[0]).toMatchObject({ status: "rejected", issues: expect.arrayContaining([expect.objectContaining({ code: "IMPORT_AMBIGUOUS_INTRADAY_ORDER" })]) });
  });

  it("allows one date-only execution with a visible warning", async () => {
    const result = await preview(["2026-08-12,005930,매수,1,70000,0,0,,"]);
    expect(result.candidates[0].status).toBe("ready");
    expect(result.candidates[0].issues.some((issue) => issue.code === "IMPORT_TIME_MISSING")).toBe(true);
  });
});
