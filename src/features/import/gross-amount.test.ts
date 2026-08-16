import { describe, expect, it } from "vitest";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import { detectImportMapping, headerSignature, profileMatch, validateImportMapping } from "./column-mapping";
import { adaptTabularRow, buildImportPreview } from "./import-pipeline";
import type { ImportMappingProfile } from "./import-types";
import { mappingReady, requiredMappingCoverage } from "./source-column-mapping";
import { parseDelimitedImport } from "./tabular-parser";

const now = "2026-08-16T00:00:00.000Z";
const accounts: InvestmentAccount[] = [{ id: "account", name: "합성 계좌", institution: "", kind: "brokerage", subtype: "", baseCurrency: "KRW", isDefault: true, archivedAt: null, memo: "", createdAt: now, updatedAt: now }];
const stock = { id: "stock", ticker: "SYNTH", name: "합성 종목", currency: "KRW", deletedAt: null } as Stock;

describe("gross transaction amount semantics", () => {
  it("suggests known gross headers as grossAmount and direct price headers as price", () => {
    const parsed = parseDelimitedImport("거래일,구분,수량,거래금액,체결가,종목코드\n2026-08-16,매수,2,100000,50000,SYNTH");
    const mapping = detectImportMapping(parsed.columns).mapping;
    expect(mapping.grossAmount).toEqual(parsed.columns[3].reference);
    expect(mapping.price).toEqual(parsed.columns[4].reference);
  });

  it("accepts either price source while still requiring one", () => {
    const direct = parseDelimitedImport("거래일,구분,수량,체결가,종목코드\n2026-08-16,매수,2,50000,SYNTH");
    const gross = parseDelimitedImport("거래일,구분,수량,거래금액,종목코드\n2026-08-16,매수,2,100000,SYNTH");
    const neither = parseDelimitedImport("거래일,구분,수량,종목코드\n2026-08-16,매수,2,SYNTH");
    expect(mappingReady(detectImportMapping(direct.columns).mapping, direct.columns, "account")).toBe(true);
    expect(mappingReady(detectImportMapping(gross.columns).mapping, gross.columns, "account")).toBe(true);
    expect(requiredMappingCoverage(detectImportMapping(gross.columns).mapping).find((item) => item.id === "price")?.complete).toBe(true);
    expect(mappingReady(detectImportMapping(neither.columns).mapping, neither.columns, "account")).toBe(false);
  });

  it("blocks a known gross header mapped directly to unit price", () => {
    const parsed = parseDelimitedImport("거래일,구분,수량,거래금액,종목코드\n2026-08-16,매수,2,100000,SYNTH");
    const mapping = detectImportMapping(parsed.columns).mapping;
    const unsafe = { ...mapping, price: mapping.grossAmount };
    delete unsafe.grossAmount;
    expect(validateImportMapping(unsafe, parsed.columns)).toContainEqual(expect.objectContaining({ code: "IMPORT_GROSS_AMOUNT_MAPPED_AS_UNIT_PRICE", severity: "error" }));
  });

  it("keeps version-1 mapping profiles compatible with grossAmount", () => {
    const parsed = parseDelimitedImport("거래일,구분,수량,거래금액,종목코드\n2026-08-16,매수,2,100000,SYNTH");
    const profile: ImportMappingProfile = { id: "gross", name: "Gross", version: 1, bindings: detectImportMapping(parsed.columns).mapping, headerSignature: headerSignature(parsed.columns), createdAt: now, updatedAt: now };
    expect(profileMatch(profile, parsed.columns)).toBe("exact");
  });

  it("derives unit price with Decimal and does not subtract fee or tax", () => {
    const parsed = parseDelimitedImport("거래일,구분,수량,거래금액,수수료,세금,종목코드\n2026-08-16,매수,2,100000,300,200,SYNTH");
    const canonical = adaptTabularRow(parsed, parsed.rows[0], 2, 0, detectImportMapping(parsed.columns).mapping, "batch", null);
    expect(canonical).toMatchObject({ quantity: 2, price: 50000, fee: 300, tax: 200, priceEvidence: { kind: "gross_amount_divided_by_quantity", grossAmount: 100000 } });
  });

  it("derives deterministic decimal quantities and rejects non-positive inputs", () => {
    const parsed = parseDelimitedImport("거래일,구분,수량,거래금액,종목코드\n2026-08-16,매수,0.3,0.1,SYNTH");
    expect(adaptTabularRow(parsed, parsed.rows[0], 2, 0, detectImportMapping(parsed.columns).mapping, "batch", null).price).toBeCloseTo(1 / 3, 15);
    for (const source of [
      "거래일,구분,수량,거래금액,종목코드\n2026-08-16,매수,0,100,SYNTH",
      "거래일,구분,수량,거래금액,종목코드\n2026-08-16,매수,1,0,SYNTH",
      "거래일,구분,수량,거래금액,종목코드\n2026-08-16,매수,-1,100,SYNTH",
      "거래일,구분,수량,거래금액,종목코드\n2026-08-16,매수,1,-100,SYNTH",
    ]) {
      const invalid = parseDelimitedImport(source);
      expect(() => adaptTabularRow(invalid, invalid.rows[0], 2, 0, detectImportMapping(invalid.columns).mapping, "batch", null), source).toThrow();
    }
  });

  it("reconciles direct price and gross amount with currency-aware tolerance", async () => {
    const build = (gross: string, stockOverride: Stock = stock) => {
      const parsed = parseDelimitedImport(`거래일시,구분,수량,체결가,거래금액,종목코드\n2026-08-16T10:00:00,매수,2,50000,${gross},SYNTH`);
      return buildImportPreview(parsed, detectImportMapping(parsed.columns).mapping, { stocks: [stockOverride], accounts, existingTrades: [], targetAccountId: "account", importedAt: now });
    };
    expect((await build("100000.5")).candidates[0].status).toBe("ready");
    expect((await build("100002")).candidates[0].issues).toContainEqual(expect.objectContaining({ code: "IMPORT_PRICE_AMOUNT_CONFLICT" }));
    const usd = { ...stock, currency: "USD" } as Stock;
    expect((await build("100000.009", usd)).candidates[0].status).toBe("ready");
    expect((await build("100000.02", usd)).candidates[0].status).toBe("rejected");
  });

  it("persists only the derived unit price and safe evidence stays canonical-only", async () => {
    const parsed = parseDelimitedImport("거래일시,구분,수량,거래금액,종목코드\n2026-08-16T10:00:00,매수,2,100000,SYNTH");
    const result = await buildImportPreview(parsed, detectImportMapping(parsed.columns).mapping, { stocks: [stock], accounts, existingTrades: [], targetAccountId: "account", importedAt: now });
    expect(result.candidates[0].issues).toContainEqual(expect.objectContaining({ code: "IMPORT_PRICE_DERIVED_FROM_GROSS_AMOUNT", details: { grossAmount: 100000, quantity: 2, derivedPrice: 50000 } }));
    expect(result.candidates[0].trade).toMatchObject({ price: 50000 });
    expect(result.candidates[0].trade).not.toHaveProperty("grossAmount");
    expect(result.candidates[0].trade).not.toHaveProperty("priceEvidence");
  });
});
