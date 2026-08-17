import { describe, expect, it } from "vitest";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import { buildPreparedImportPreview, preflightImport } from "../import-pipeline";
import { parseDelimitedImport } from "../tabular-parser";
import { detectSuggestedFileAdapter } from "./adapter-registry";
import { miraeAccountLedgerAdapter } from "./mirae-account-ledger-v1";

const header = "거래일자,거래종류,종목명,거래수량,거래금액,외화거래금액,수수료,예수금잔고";
const now = "2026-08-16T00:00:00.000Z";
const account: InvestmentAccount = { id: "account", name: "합성 계좌", institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: true, archivedAt: null, memo: "", createdAt: now, updatedAt: now };
const stocks = [
  { id: "alpha", ticker: "ALPHA", name: "합성 알파", currency: "KRW", deletedAt: null },
  { id: "beta", ticker: "BETA", name: "합성 베타", currency: "KRW", deletedAt: null },
  { id: "gamma", ticker: "GAMMA", name: "합성 감마", currency: "KRW", deletedAt: null },
] as Stock[];
const context = { importBatchId: "synthetic-batch", provider: "합성 증권사", targetAccountId: "account" };

function file(rows: string[]) { return parseDelimitedImport([header, ...rows].join("\n")); }

describe("Mirae account-ledger adapter v1", () => {
  it("suggests conservatively from stable headers and never from sheet name alone", () => {
    const exact = file(["2026-08-16,이체송금,,,,,,0"]);
    expect(detectSuggestedFileAdapter(exact)).toMatchObject({ match: "suggested", adapterId: "mirae-account-ledger-v1", confidence: "exact" });
    const reordered = parseDelimitedImport("수수료,거래금액,거래일자,종목명,거래종류,예수금잔고,거래수량,외화거래금액\n0,,2026-08-16,,이체송금,0,,");
    expect(miraeAccountLedgerAdapter.detect(reordered)).toMatchObject({ match: "suggested", confidence: "exact" });
    const missing = parseDelimitedImport("거래일자,거래종류,종목명,거래수량,거래금액,수수료,예수금잔고\n2026-08-16,이체송금,,,,,0");
    expect(miraeAccountLedgerAdapter.detect(missing)).toEqual({ match: "none" });
    const duplicate = parseDelimitedImport(`${header},거래금액\n2026-08-16,이체송금,,,,,,0,`);
    expect(miraeAccountLedgerAdapter.detect(duplicate)).toEqual({ match: "none" });
    const unrelated = parseDelimitedImport("거래일자,종목코드,체결가\n2026-08-16,SYNTH,100");
    unrelated.sheetName = "거래내역";
    expect(miraeAccountLedgerAdapter.detect(unrelated)).toEqual({ match: "none" });
  });

  it.each([
    ["주식매수입고", "execution", "buy"], ["주식매도출고", "execution", "sell"],
    ["주식매수출금", "settlement_mirror", undefined], ["주식매도입금", "settlement_mirror", undefined],
    ["이체송금", "non_trade_activity", undefined], ["배당세출금", "non_trade_activity", undefined],
    ["계좌대체입금", "non_trade_activity", undefined], ["CMS자동이체입금", "non_trade_activity", undefined],
    ["예탁금이용료입금", "non_trade_activity", undefined], ["펀드정기자동매수", "unsupported_activity", undefined],
  ] as const)("classifies exact activity %s before generic parsing", (activity, disposition, side) => {
    const parsed = file([`2026-08-16,${activity},합성 알파,2,100000,0,10,0`]);
    const prepared = miraeAccountLedgerAdapter.prepare(parsed, context)[0];
    expect(prepared.disposition).toBe(disposition);
    if (side) expect(prepared.execution).toMatchObject({ adapter: "mirae-account-ledger-v1", side, price: 50000, fee: 10, feeProvided: true });
    if (disposition !== "execution") expect(prepared.execution).toBeUndefined();
  });

  it("keeps substring lookalikes and unknown activity out of buy/sell", () => {
    const parsed = file(["2026-08-16,주식매수입고취소,합성 알파,2,100000,0,10,0"]);
    expect(miraeAccountLedgerAdapter.prepare(parsed, context)[0]).toMatchObject({ disposition: "review_required", issues: [expect.objectContaining({ code: "IMPORT_BROKER_LEDGER_UNKNOWN_ACTIVITY", severity: "error" })] });
  });

  it("blocks foreign-amount executions without guessing currency", () => {
    const parsed = file(["2026-08-16,주식매수입고,합성 알파,2,100000,1,10,0"]);
    expect(miraeAccountLedgerAdapter.prepare(parsed, context)[0]).toMatchObject({ disposition: "unsupported_activity", issues: [expect.objectContaining({ code: "IMPORT_MIRAE_FOREIGN_ACTIVITY_UNSUPPORTED" })] });
  });

  it("reconciles execution and mirror totals separately with Decimal", () => {
    const parsed = file([
      "2026-08-16,주식매수입고,합성 알파,0.1,0.1,0,0.01,0",
      "2026-08-16,주식매수입고,합성 베타,0.2,0.2,0,0.02,0",
      "2026-08-16,주식매수출금,,0,0.3,0,0.03,0",
    ]);
    const prepared = miraeAccountLedgerAdapter.prepare(parsed, context);
    expect(prepared.every((row) => row.issues.some((issue) => issue.code === "IMPORT_SETTLEMENT_RECONCILED"))).toBe(true);
    expect(prepared[2].disposition).toBe("settlement_mirror");
  });

  it("treats a fee-only mismatch as a settlement mismatch", () => {
    const parsed = file([
      "2026-08-16,주식매수입고,합성 알파,2,100000,0,10,0",
      "2026-08-16,주식매수출금,,0,100000,0,11,0",
    ]);
    const prepared = miraeAccountLedgerAdapter.prepare(parsed, context);
    expect(prepared[0].issues).toContainEqual(expect.objectContaining({ code: "IMPORT_SETTLEMENT_MISMATCH", severity: "error" }));
  });

  it("blocks every execution in a mismatched group while keeping mirrors excluded", async () => {
    const parsed = file([
      "2026-08-16,주식매수입고,합성 알파,2,100000,0,10,0",
      "2026-08-16,주식매수입고,합성 베타,1,50000,0,20,0",
      "2026-08-16,주식매수출금,,0,149999,0,30,0",
    ]);
    const prepared = miraeAccountLedgerAdapter.prepare(parsed, context);
    const preview = await buildPreparedImportPreview(prepared, { stocks, accounts: [account], existingTrades: [], targetAccountId: "account", importBatchId: context.importBatchId, importedAt: now });
    expect(preview.candidates.slice(0, 2).every((candidate) => candidate.status === "rejected" && candidate.action === "none")).toBe(true);
    expect(preview.candidates[2].status).toBe("excluded_settlement");
    expect(preflightImport(preview, new Set(preview.candidates.map((candidate) => candidate.id)), { existingTrades: [], accounts: [account] }).ok).toBe(false);
  });

  it("warns for missing mirrors and mirror-only groups without crossing date or side", () => {
    const parsed = file([
      "2026-08-16,주식매수입고,합성 알파,2,100000,0,10,0",
      "2026-08-16,주식매도입금,,0,100000,0,10,0",
      "2026-08-17,주식매수출금,,0,100000,0,10,0",
    ]);
    const prepared = miraeAccountLedgerAdapter.prepare(parsed, context);
    expect(prepared[0].issues).toContainEqual(expect.objectContaining({ code: "IMPORT_SETTLEMENT_MIRROR_MISSING" }));
    expect(prepared[1].issues).toContainEqual(expect.objectContaining({ code: "IMPORT_SETTLEMENT_EXECUTION_MISSING" }));
    expect(prepared[2].issues).toContainEqual(expect.objectContaining({ code: "IMPORT_SETTLEMENT_EXECUTION_MISSING" }));
  });

  it("creates only execution candidates and reports aggregate row dispositions", async () => {
    const parsed = file([
      "2026-08-16,주식매수입고,합성 알파,2,100000,0,10,0",
      "2026-08-16,주식매수출금,,0,100000,0,10,0",
      "2026-08-16,주식매도출고,합성 베타,1,50000,0,5,0",
      "2026-08-16,주식매도입금,,0,50000,0,5,0",
      "2026-08-16,이체송금,,,,,,0",
      "2026-08-16,배당세출금,,,,,,0",
      "2026-08-16,펀드정기자동매수,합성 감마,1,1000,0,0,0",
    ]);
    const preview = await buildPreparedImportPreview(miraeAccountLedgerAdapter.prepare(parsed, context), { stocks, accounts: [account], existingTrades: [], targetAccountId: "account", importBatchId: context.importBatchId, importedAt: now });
    expect(preview.summary).toMatchObject({ ready: 2, excluded_settlement: 2, excluded_non_trade: 2, unsupported_activity: 1 });
    expect(preview.candidates.filter((candidate) => candidate.trade)).toHaveLength(2);
    expect(preview.candidates.filter((candidate) => candidate.trade).every((candidate) => candidate.trade?.feeMode === "sourceProvided" && candidate.trade.feeCalculation === null)).toBe(true);
    expect(preview.candidates.filter((candidate) => candidate.status.startsWith("excluded_")).every((candidate) => candidate.action === "none" && !candidate.selectedByDefault)).toBe(true);
    expect(preview.candidates.filter((candidate) => candidate.trade).every((candidate) => candidate.trade?.price === 50000)).toBe(true);
    const selected = new Set([preview.candidates[0].id, ...preview.candidates.filter((candidate) => candidate.action === "none").map((candidate) => candidate.id)]);
    expect(preflightImport(preview, selected, { existingTrades: [], accounts: [account] })).toMatchObject({ ok: true, plan: { insertedTrades: [expect.objectContaining({ stockName: "합성 알파" })] } });
  });

  it("represents the known 20-row aggregate shape without hardcoded source data", () => {
    const rows = [
      "2026-01-01,주식매수입고,합성 알파,1,100,0,1,0", "2026-01-01,주식매수입고,합성 베타,1,200,0,2,0", "2026-01-01,주식매수출금,,0,300,0,3,0",
      "2026-01-02,주식매수입고,합성 감마,1,300,0,3,0", "2026-01-02,주식매수입고,합성 델타,1,400,0,4,0", "2026-01-02,주식매수출금,,0,700,0,7,0",
      "2026-01-03,주식매도출고,합성 엡실론,1,500,0,5,0", "2026-01-03,주식매도출고,합성 제타,1,600,0,6,0", "2026-01-03,주식매도입금,,0,1100,0,11,0",
      ...Array.from({ length: 10 }, (_, index) => `2026-02-${String(index + 1).padStart(2, "0")},이체송금,,,,,,0`),
      "2026-03-01,펀드정기자동매수,합성 펀드,1,1000,0,0,0",
    ];
    const prepared = miraeAccountLedgerAdapter.prepare(file(rows), context);
    expect(prepared).toHaveLength(20);
    expect(prepared.reduce<Record<string, number>>((counts, row) => ({ ...counts, [row.disposition]: (counts[row.disposition] ?? 0) + 1 }), {})).toEqual({ execution: 6, settlement_mirror: 3, non_trade_activity: 10, unsupported_activity: 1 });
  });
});
