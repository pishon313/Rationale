import { describe, expect, it } from "vitest";
import { buildTabularColumns, detectImportMapping, headerSignature, profileMatch, validateImportMapping } from "./column-mapping";
import { applySourceColumnAssignment, ignoredImportantField, mappingAdvisories, mappingReady, requiredMappingCoverage, sampleValuesForColumn, sourceColumnAssignments } from "./source-column-mapping";
import type { ImportMappingProfile, ParsedTabularFile } from "./import-types";

function parsed(headers: string[], rows: string[][]): ParsedTabularFile { return { columns: buildTabularColumns(headers), rows }; }

describe("source-first column mapping", () => {
  it("preserves source order, inverts mappings, and keeps unknown columns ignored", () => {
    const file = parsed(["종목코드", "알 수 없는 열", "거래일"], [["005930", "x", "2026-08-12"]]);
    const detected = detectImportMapping(file.columns).mapping;
    const assignments = sourceColumnAssignments(file, detected);
    expect(assignments.map((item) => [item.column.label, item.target, item.origin])).toEqual([
      ["종목코드", "ticker", "automatic"], ["알 수 없는 열", "ignore", "ignored"], ["거래일", "tradedAt", "automatic"],
    ]);
  });

  it("marks ambiguous duplicate aliases for review and keeps occurrences independent", () => {
    const file = parsed(["가격", "가격"], [["100", "101"]]);
    const detected = detectImportMapping(file.columns);
    expect(detected.mapping.price).toBeUndefined();
    expect(sourceColumnAssignments(file, detected.mapping).map((item) => [item.origin, item.column.reference.occurrence])).toEqual([["needs_review", 0], ["needs_review", 1]]);
  });

  it("preserves raw leading zeros and bounds, deduplicates, and skips empty samples", () => {
    const file = parsed(["code"], [[""], ["005930"], ["005930"], ["000660"], ["035420"], ["999999"]]);
    expect(sampleValuesForColumn(file, file.columns[0])).toEqual(["005930", "000660", "035420"]);
    expect(sampleValuesForColumn(file, file.columns[0], { maxSamples: 2, scanLimit: 3 })).toEqual(["005930"]);
  });

  it("applies, ignores, and rejects destination collisions without changing mappings", () => {
    const file = parsed(["a", "b"], [["1", "2"]]);
    const first = applySourceColumnAssignment({}, file.columns[0], "quantity");
    expect(first).toMatchObject({ ok: true, mapping: { quantity: file.columns[0].reference } });
    if (!first.ok) throw new Error("expected assignment");
    const collision = applySourceColumnAssignment(first.mapping, file.columns[1], "quantity");
    expect(collision).toMatchObject({ ok: false, mapping: first.mapping, owner: "quantity" });
    expect(applySourceColumnAssignment(first.mapping, file.columns[0], "price")).toMatchObject({ ok: true, mapping: { price: file.columns[0].reference } });
    const ignored = applySourceColumnAssignment(first.mapping, file.columns[0], "ignore");
    expect(ignored).toEqual({ ok: true, mapping: {} });
    if (!ignored.ok) throw new Error("expected ignore");
    expect(applySourceColumnAssignment(ignored.mapping, file.columns[1], "quantity")).toMatchObject({ ok: true, mapping: { quantity: file.columns[1].reference } });
  });

  it("reports required coverage with ticker-or-name semantics", () => {
    const base = { tradedAt: { normalizedHeader: "date", occurrence: 0 }, tradeType: { normalizedHeader: "side", occurrence: 0 }, quantity: { normalizedHeader: "qty", occurrence: 0 }, price: { normalizedHeader: "price", occurrence: 0 } };
    expect(requiredMappingCoverage(base).map((item) => item.complete)).toEqual([true, true, true, true, false]);
    expect(requiredMappingCoverage({ ...base, ticker: { normalizedHeader: "ticker", occurrence: 0 } }).every((item) => item.complete)).toBe(true);
    expect(requiredMappingCoverage({ ...base, stockName: { normalizedHeader: "name", occurrence: 0 } }).every((item) => item.complete)).toBe(true);
    expect(requiredMappingCoverage({ ...base, ticker: { normalizedHeader: "ticker", occurrence: 0 }, stockName: { normalizedHeader: "name", occurrence: 0 } }).every((item) => item.complete)).toBe(true);
  });

  it("creates non-blocking advisories and clears each mapped advisory", () => {
    const empty = mappingAdvisories({});
    expect(empty).toContain("MAPPING_FEE_UNMAPPED"); expect(empty).toContain("MAPPING_TAX_UNMAPPED"); expect(empty).toContain("MAPPING_EXCHANGE_RATE_UNMAPPED"); expect(empty).toContain("MAPPING_ACCOUNT_TARGET_APPLIED"); expect(empty).toContain("MAPPING_EXECUTION_ID_UNMAPPED");
    const cases = [["time", "MAPPING_TIME_UNMAPPED"], ["fee", "MAPPING_FEE_UNMAPPED"], ["tax", "MAPPING_TAX_UNMAPPED"], ["currency", "MAPPING_CURRENCY_UNMAPPED"], ["exchangeRate", "MAPPING_EXCHANGE_RATE_UNMAPPED"], ["accountName", "MAPPING_ACCOUNT_TARGET_APPLIED"], ["externalExecutionId", "MAPPING_EXECUTION_ID_UNMAPPED"]] as const;
    for (const [field, advisory] of cases) expect(mappingAdvisories({ [field]: { normalizedHeader: field.toLowerCase(), occurrence: 0 } })).not.toContain(advisory);
  });

  it("highlights only uniquely recognized important ignored columns", () => {
    const file = parsed(["수수료", "관련 없음"], [["10", "x"]]);
    const assignments = sourceColumnAssignments(file, {}, { explicitlyIgnored: new Set(file.columns.map((column) => `${column.reference.normalizedHeader}#${column.reference.occurrence}`)) });
    expect(ignoredImportantField(assignments[0])).toBe("fee");
    expect(ignoredImportantField(assignments[1])).toBeNull();
  });

  it("projects profile and manual origins without persisting samples or UI metadata", () => {
    const file = parsed(["거래일", "구분", "수량", "가격", "종목코드", "extra"], [["2026-08-12", "매수", "2", "100", "005930", "sample"]]);
    const bindings = { tradedAt: file.columns[0].reference, tradeType: file.columns[1].reference, quantity: file.columns[2].reference, price: file.columns[3].reference, ticker: file.columns[4].reference };
    const profile: ImportMappingProfile = { id: "p", name: "Broker", version: 1, bindings, headerSignature: headerSignature(file.columns), createdAt: "now", updatedAt: "now" };
    const assignments = sourceColumnAssignments(file, bindings, { profileBindings: profile.bindings, manuallyChanged: new Set(["수량#0"]) });
    expect(assignments.map((item) => item.origin)).toEqual(["profile", "profile", "manual", "profile", "profile", "ignored"]);
    expect(profile).not.toHaveProperty("sampleValues"); expect(profile).not.toHaveProperty("origin");
    const reordered = parsed(["extra", "종목코드", "가격", "수량", "구분", "거래일"], [["sample", "005930", "100", "2", "매수", "2026-08-12"]]);
    expect(profileMatch(profile, reordered.columns)).toBe("exact");
    expect(sourceColumnAssignments(reordered, profile.bindings, { profileBindings: profile.bindings }).map((item) => item.target)).toEqual(["ignore", "ticker", "price", "quantity", "tradeType", "tradedAt"]);
  });

  it("keeps compatible profile bindings while exposing an additional ignored column", () => {
    const original = parsed(["거래일", "구분", "수량", "가격", "종목코드"], [["2026-08-12", "매수", "1", "100", "005930"]]);
    const bindings = detectImportMapping(original.columns).mapping;
    const profile: ImportMappingProfile = { id: "compatible", name: "Compatible", version: 1, bindings, headerSignature: headerSignature(original.columns), createdAt: "now", updatedAt: "now" };
    const extra = parsed(["추가 열", "가격", "종목코드", "수량", "구분", "거래일"], [["ignored", "100", "005930", "1", "매수", "2026-08-12"]]);
    expect(profileMatch(profile, extra.columns)).toBe("compatible");
    expect(sourceColumnAssignments(extra, profile.bindings, { profileBindings: profile.bindings })[0]).toMatchObject({ target: "ignore", origin: "ignored", sampleValues: ["ignored"] });
  });

  it("keeps validateImportMapping as final defense and requires a target account when unmapped", () => {
    const file = parsed(["거래일", "구분", "수량", "가격", "종목코드"], [["2026-08-12", "매수", "1", "100", "005930"]]);
    const mapping = detectImportMapping(file.columns).mapping;
    expect(validateImportMapping(mapping, file.columns)).toEqual([]);
    expect(mappingReady(mapping, file.columns, "")).toBe(false);
    expect(mappingReady(mapping, file.columns, "account")).toBe(true);
  });
});
