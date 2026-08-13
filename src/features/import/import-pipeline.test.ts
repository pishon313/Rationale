import { describe, expect, it } from "vitest";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { buildTabularColumns, detectImportMapping, exactProfileToAutoApply, hasDuplicateMappingProfileName, headerSignature, profileMatch, updatedMappingProfile, validateImportMapping } from "./column-mapping";
import { adaptTabularRow, buildImportMutationPlan, buildImportPreview, parseExecutionDateTime, parseOptionalNumber, preflightImport } from "./import-pipeline";
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

  it("reconciles embedded and separate time without silently choosing a conflict", () => {
    expect(parseExecutionDateTime("2026-08-12T10:30", "10:30:00")).toMatchObject({ value: "2026-08-12T10:30:00", timePrecision: "second" });
    expect(parseExecutionDateTime("2026-08-12", "10:30")).toMatchObject({ value: "2026-08-12T10:30:00", timePrecision: "minute" });
    expect(() => parseExecutionDateTime("2026-08-12T10:30:00", "10:31:00")).toThrow("IMPORT_TIME_CONFLICT");
    expect(() => parseExecutionDateTime("2026-08-12T10:30:01", "10:30:02")).toThrow("IMPORT_TIME_CONFLICT");
    expect(() => parseExecutionDateTime("2026-08-12T10:30:00Z", "10:30:00")).toThrow("IMPORT_UNSUPPORTED_TIMEZONE");
    expect(() => parseExecutionDateTime("2026-08-12T10:30:00", "10:30:00+09:00")).toThrow("IMPORT_UNSUPPORTED_TIMEZONE");
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

  it("uses provider-independent v2 external execution identity", async () => {
    const first = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,CaseSensitive-1,"], []);
    const sourceKey = first.candidates[0].trade?.origin?.sourceKey;
    expect(sourceKey).toMatch(/^file:v2:/);
    const parsed = table(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,CaseSensitive-1,"]);
    const changedProvider = await buildImportPreview(parsed, detectImportMapping(parsed.columns).mapping, { stocks, accounts, existingTrades: [], targetAccountId: "a1", provider: "다른 표시 이름", importedAt: now });
    expect(changedProvider.candidates[0].trade?.origin?.sourceKey).toBe(sourceKey);
  });

  it("separates per-row candidate identity from trusted proposed Trade identity", async () => {
    const rows = ["2026-08-12T10:00:01,005930,매수,1,70000,0,0,same-id,", "2026-08-12T10:00:01,005930,매수,1,70000,0,0,same-id,"];
    const parsed = table(rows);
    const context = { stocks, accounts, existingTrades: [], targetAccountId: "a1", provider: "broker", importedAt: now, importBatchId: "batch-stable" };
    const first = await buildImportPreview(parsed, detectImportMapping(parsed.columns).mapping, context);
    const rebuilt = await buildImportPreview(parsed, detectImportMapping(parsed.columns).mapping, context);
    expect(new Set(first.candidates.map((candidate) => candidate.id)).size).toBe(first.candidates.length);
    expect(first.candidates[0].id).not.toBe(first.candidates[1].id);
    expect(first.candidates.map((candidate) => candidate.id)).toEqual(rebuilt.candidates.map((candidate) => candidate.id));
    expect(first.candidates[0].trade?.id).toBe(first.candidates[1].trade?.id);
    expect(first.candidates[0]).toMatchObject({ status: "ready", action: "insert", selectedByDefault: true });
    expect(first.candidates[1]).toMatchObject({ status: "exact_duplicate", action: "none", selectedByDefault: false });
    expect(first.candidates[1].issues).toContainEqual(expect.objectContaining({ code: "IMPORT_BATCH_EXACT_DUPLICATE", details: { duplicateOfRow: 2 } }));
    expect(first.summary).toMatchObject({ ready: 1, exact_duplicate: 1 });
    expect(first.candidates[0].trade?.origin).not.toHaveProperty("candidateId");
    const selected = new Set(first.candidates.map((candidate) => candidate.id));
    expect(preflightImport(first, selected, { existingTrades: [], accounts })).toMatchObject({ ok: true, plan: { insertedTrades: [expect.objectContaining({ id: first.candidates[0].trade?.id })] } });
  });

  it("keeps candidate IDs unique for rejected rows as well as parsed rows", async () => {
    const result = await preview([
      "2026-08-12T10:00:01,005930,매수,invalid,70000,0,0,rejected-a,",
      "2026-08-12T10:00:01,005930,매수,invalid,70000,0,0,rejected-b,",
      "2026-08-12T10:00:01,005930,매수,1,70000,0,0,valid-c,",
    ]);
    expect(new Set(result.candidates.map((candidate) => candidate.id)).size).toBe(result.candidates.length);
    expect(result.candidates.every((candidate) => !candidate.trade?.origin || !candidate.trade.origin.sourceKey?.includes(candidate.id))).toBe(true);
  });

  it.each([
    ["quantity", "2026-08-12T10:00:01,005930,매수,2,70000,0,0,conflict-id,"],
    ["price", "2026-08-12T10:00:01,005930,매수,1,71000,0,0,conflict-id,"],
    ["fee", "2026-08-12T10:00:01,005930,매수,1,70000,1,0,conflict-id,"],
    ["tax", "2026-08-12T10:00:01,005930,매수,1,70000,0,1,conflict-id,"],
    ["timestamp", "2026-08-12T10:00:02,005930,매수,1,70000,0,0,conflict-id,"],
    ["side", "2026-08-12T10:00:01,005930,매도,1,70000,0,0,conflict-id,"],
  ])("blocks every trusted group member when %s differs", async (_field, changed) => {
    const result = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,conflict-id,", changed]);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((candidate) => candidate.status === "source_conflict" && candidate.action === "none" && !candidate.selectedByDefault)).toBe(true);
    expect(result.summary).toMatchObject({ ready: 0, source_conflict: 2 });
    expect(result.candidates.every((candidate) => candidate.issues.some((issue) => issue.code === "IMPORT_BATCH_SOURCE_IDENTITY_CONFLICT"))).toBe(true);
    expect(preflightImport(result, new Set(result.candidates.map((candidate) => candidate.id)), { existingTrades: [], accounts }).ok).toBe(false);
  });

  it("blocks every trusted group member when the resolved Stock differs", async () => {
    const other = { ...stocks[0], id: "s2", ticker: "000660", name: "SK하이닉스" };
    const parsed = table(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,stock-conflict,", "2026-08-12T10:00:01,000660,매수,1,70000,0,0,stock-conflict,"]);
    const result = await buildImportPreview(parsed, detectImportMapping(parsed.columns).mapping, { stocks: [...stocks, other], accounts, existingTrades: [], targetAccountId: "a1", importedAt: now });
    expect(result.candidates.every((candidate) => candidate.status === "source_conflict" && candidate.action === "none")).toBe(true);
  });

  it("blocks all rows when a later third row conflicts, independent of first-row order", async () => {
    const same = "2026-08-12T10:00:01,005930,매수,1,70000,0,0,three-id,";
    const changed = "2026-08-12T10:00:01,005930,매수,2,70000,0,0,three-id,";
    for (const rows of [[same, same, changed], [changed, same, same]]) {
      const result = await preview(rows);
      expect(result.candidates.every((candidate) => candidate.status === "source_conflict" && candidate.action === "none")).toBe(true);
      expect(result.summary.source_conflict).toBe(3);
    }
  });

  it("blocks a valid trusted row when another identity-probed row is invalid", async () => {
    const result = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,invalid-peer,", "2026-08-12T10:00:01,005930,매수,invalid,70000,0,0,invalid-peer,"]);
    expect(result.candidates[0]).toMatchObject({ status: "source_conflict", action: "none" });
    expect(result.candidates[1]).toMatchObject({ status: "rejected", action: "none" });
    expect(result.candidates.every((candidate) => candidate.issues.some((issue) => issue.code === "IMPORT_BATCH_SOURCE_IDENTITY_CONFLICT"))).toBe(true);
  });

  it("rejects manually selected actionable candidates with duplicate proposed Trade IDs", async () => {
    const result = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,guard-id,"]);
    const first = result.candidates[0];
    const duplicate = { ...first, id: "candidate:manual-duplicate" };
    expect(buildImportMutationPlan([first, duplicate], [])).toMatchObject({ ok: false, issue: { code: "IMPORT_PREVIEW_STALE", row: duplicate.row } });
  });

  it("keeps one representative action for identical trusted rows against active, deleted, and manual records", async () => {
    const row = "2026-08-12T10:00:01,005930,매수,1,70000,0,0,existing-group,";
    const initial = await preview([row]);
    const imported = initial.candidates[0].trade as Trade;
    const active = await preview([row, row], [imported]);
    expect(active.candidates.map((candidate) => [candidate.status, candidate.action])).toEqual([["exact_duplicate", "none"], ["exact_duplicate", "none"]]);

    const deleted = { ...imported, deletedAt: "2026-08-13T00:00:00Z" };
    const restore = await preview([row, row], [deleted]);
    expect(restore.candidates.map((candidate) => [candidate.status, candidate.action])).toEqual([["previously_deleted", "restore"], ["exact_duplicate", "none"]]);
    const restored = preflightImport(restore, new Set(restore.candidates.map((candidate) => candidate.id)), { existingTrades: [deleted], accounts });
    expect(restored).toMatchObject({ ok: true, plan: { restoredTradeIds: [deleted.id] } });

    const manual = { ...imported, id: "manual-group", origin: { kind: "manual" as const }, journalStatus: "recorded" as const };
    const possible = await preview([row, row], [manual]);
    expect(possible.candidates.map((candidate) => [candidate.status, candidate.action, candidate.selectedByDefault])).toEqual([["possible_duplicate", "insert", false], ["exact_duplicate", "none", false]]);
  });

  it("keeps trusted groups account-scoped and never falls back after mapped account failure", async () => {
    const secondAccount = { ...accounts[0], id: "a2", name: "두 번째 계좌", isDefault: false };
    const result = await previewCsv("거래일시,종목코드,구분,수량,가격,계좌,체결 ID\n2026-08-12T10:00:01,005930,매수,1,70000,기본 계좌,account-id\n2026-08-12T10:00:01,005930,매수,2,70000,두 번째 계좌,account-id", { accounts: [...accounts, secondAccount] });
    expect(result.candidates.every((candidate) => candidate.status === "ready")).toBe(true);
    const unresolved = await previewCsv("거래일시,종목코드,구분,수량,가격,계좌,체결 ID\n2026-08-12T10:00:01,005930,매수,1,70000,없는 계좌,account-id\n2026-08-12T10:00:01,005930,매수,1,70000,기본 계좌,account-id");
    expect(unresolved.candidates.map((candidate) => candidate.status)).toEqual(["rejected", "ready"]);
    expect(unresolved.candidates[0].issues).toContainEqual(expect.objectContaining({ code: "IMPORT_ACCOUNT_NOT_FOUND" }));
  });

  it("detects one legacy v1 execution across provider label changes", async () => {
    const first = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,exec-v1,"]);
    const legacy = { ...(first.candidates[0].trade as Trade), origin: { ...(first.candidates[0].trade as Trade).origin!, sourceKey: "file:v1:legacy-provider-dependent" } };
    const parsed = table(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,exec-v1,"]);
    const result = await buildImportPreview(parsed, detectImportMapping(parsed.columns).mapping, { stocks, accounts, existingTrades: [legacy], targetAccountId: "a1", provider: "renamed", importedAt: now });
    expect(result.candidates[0]).toMatchObject({ status: "exact_duplicate", matchedTradeIds: [legacy.id] });
  });

  it("keeps the same external execution ID distinct across accounts", async () => {
    const secondAccount = { ...accounts[0], id: "a2", name: "두 번째 계좌", isDefault: false };
    const first = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,same-exec,"]);
    const parsed = table(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,same-exec,"]);
    const result = await buildImportPreview(parsed, detectImportMapping(parsed.columns).mapping, { stocks, accounts: [...accounts, secondAccount], existingTrades: [first.candidates[0].trade as Trade], targetAccountId: "a2", provider: "broker", importedAt: now });
    expect(result.candidates[0].status).toBe("ready");
  });

  it("blocks ambiguous trusted external identities instead of choosing the first", async () => {
    const first = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,ambiguous-exec,"]);
    const trade = first.candidates[0].trade as Trade;
    const result = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,ambiguous-exec,"], [trade, { ...trade, id: "another-id" }]);
    expect(result.candidates[0]).toMatchObject({ status: "source_conflict", action: "none" });
    expect(result.candidates[0].issues).toContainEqual(expect.objectContaining({ code: "IMPORT_SOURCE_IDENTITY_AMBIGUOUS" }));
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

  it("classifies a deleted exact import as an explicit restore and preserves its journal data", async () => {
    const first = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,restore-exec,"]);
    const original = { ...(first.candidates[0].trade as Trade), planId: "plan-1", memo: "사용자 메모", emotion: "확신", emotionIntensity: 4, confidenceScore: 5, ruleComplianceScore: 4, ruleViolations: [{ ruleId: "r", title: "규칙", severity: "주의" as const, message: "메모" }], journalStatus: "recorded" as const, deletedAt: "2026-08-13T00:00:00Z" };
    const result = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,restore-exec,"], [original]);
    const candidate = result.candidates[0];
    expect(candidate).toMatchObject({ status: "previously_deleted", action: "restore", selectedByDefault: false, matchedTradeIds: [original.id] });
    const selected = new Set([candidate.id]);
    const preflight = preflightImport(result, selected, { existingTrades: [original], accounts });
    expect(preflight.ok).toBe(true);
    if (!preflight.ok) throw new Error("expected restore plan");
    expect(preflight.plan.insertedTrades).toHaveLength(0);
    expect(preflight.plan.restoredTradeIds).toEqual([original.id]);
    expect(preflight.plan.nextTrades).toHaveLength(1);
    expect(preflight.plan.nextTrades[0]).toMatchObject({ id: original.id, createdAt: original.createdAt, origin: original.origin, journalStatus: "recorded", planId: "plan-1", memo: "사용자 메모", emotion: "확신", deletedAt: null });
  });

  it("blocks a deleted source conflict and stale preview changes", async () => {
    const first = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,stale-exec,"]);
    const deleted = { ...(first.candidates[0].trade as Trade), deletedAt: "2026-08-13T00:00:00Z" };
    const conflict = await preview(["2026-08-12T10:00:01,005930,매수,2,70000,0,0,stale-exec,"], [deleted]);
    expect(conflict.candidates[0].status).toBe("source_conflict");

    const fresh = await preview(["2026-08-12T10:00:01,005930,매수,1,70000,0,0,new-after-preview,"]);
    const selected = new Set([fresh.candidates[0].id]);
    const addedElsewhere = fresh.candidates[0].trade as Trade;
    const stale = preflightImport(fresh, selected, { existingTrades: [addedElsewhere], accounts });
    expect(stale.ok).toBe(false);
    expect(stale.issues).toContainEqual(expect.objectContaining({ code: "IMPORT_PREVIEW_STALE" }));
  });

  it("blocks atomic commit when selected candidates violate the ledger", async () => {
    const result = await preview(["2026-08-12T10:00:01,005930,매도,1,70000,0,0,,"]);
    const selected = new Set(result.candidates.map((candidate) => candidate.id));
    expect(result.candidates[0].id).not.toBe(result.candidates[0].trade?.id);
    expect(preflightImport(result, selected, { existingTrades: [], accounts })).toMatchObject({ ok: false, issues: [{ code: "IMPORT_LEDGER_CONFLICT", row: 2, candidateId: result.candidates[0].id }] });
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
    expect(profileMatch(profile, buildTabularColumns(["가격", "가격", "수량", "구분", "종목코드", "거래일"]))).toBe("incompatible");
  });

  it("rejects changed duplicate-header cardinality and malformed signatures", () => {
    const duplicated = buildTabularColumns(["거래일", "종목코드", "구분", "수량", "가격", "가격"]);
    const profile: ImportMappingProfile = { id: "p", name: "Duplicate prices", version: 1, bindings: { ...detectImportMapping(duplicated).mapping, price: duplicated[5].reference }, headerSignature: headerSignature(duplicated), createdAt: now, updatedAt: now };
    expect(profileMatch(profile, buildTabularColumns(["가격", "거래일", "종목코드", "구분", "수량", "가격"]))).toBe("exact");
    expect(profileMatch(profile, buildTabularColumns(["거래일", "종목코드", "구분", "수량", "가격"]))).toBe("incompatible");
    expect(profileMatch({ ...profile, headerSignature: "malformed" }, buildTabularColumns(["거래일", "종목코드", "구분", "수량", "가격", "세금"]))).toBe("incompatible");
  });

  it("does not silently auto-apply when multiple profiles match equally", () => {
    const columns = buildTabularColumns(["거래일", "종목코드", "구분", "수량", "가격"]);
    const base: ImportMappingProfile = { id: "p1", name: "One", version: 1, bindings: detectImportMapping(columns).mapping, headerSignature: headerSignature(columns), createdAt: now, updatedAt: now };
    expect(exactProfileToAutoApply([base, { ...base, id: "p2", name: "Two" }], columns)).toBeUndefined();
    expect(Object.keys(base)).not.toContain("rows");
  });

  it("updates a selected profile in place and detects normalized duplicate names", () => {
    const columns = buildTabularColumns(["거래일", "종목코드", "구분", "수량", "가격"]);
    const original: ImportMappingProfile = { id: "p1", name: "Broker", version: 1, bindings: detectImportMapping(columns).mapping, headerSignature: headerSignature(columns), createdAt: now, updatedAt: now };
    const updatedAt = "2026-08-13T00:00:00Z";
    const updated = updatedMappingProfile(original, "Broker Updated", original.bindings, columns, updatedAt);
    expect(updated).toMatchObject({ id: original.id, createdAt: original.createdAt, name: "Broker Updated", updatedAt });
    expect(hasDuplicateMappingProfileName([original], "  BROKER  ")).toBe(true);
    expect(hasDuplicateMappingProfileName([original], "broker", original.id)).toBe(false);
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
    expect(mixed.candidates[0]).toMatchObject({ status: "rejected", action: "none", issues: expect.arrayContaining([expect.objectContaining({ code: "IMPORT_AMBIGUOUS_INTRADAY_ORDER" })]) });
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
