import { describe, expect, it } from "vitest";
import { assertMatchingQuote, twelveDataIdentity, type TwelveDataQuote } from "./quote-identity";
import type { Stock } from "./types";

const stock = { ticker: "SHLD", market: "기타", currency: "CAD", twelveData: { symbol: "SHLD", country: "CA", exchange: "TSX" } } as Stock;
const quote: TwelveDataQuote = { price: 12, symbol: "SHLD", country: "Canada", currency: "CAD", exchange: "TSX", quotedAt: "", isMarketOpen: null, source: "Twelve Data" };

describe("Twelve Data quote identity", () => {
  it("기타 시장은 identity 없이는 요청할 수 없다", () => expect(twelveDataIdentity({ ...stock, twelveData: null })).toBeNull());
  it("표시 시장이 미국이어도 provider identity를 추측하지 않는다", () => expect(twelveDataIdentity({ ...stock, market: "미국", currency: "USD", twelveData: null })).toBeNull());
  it("캐나다 TSX CAD quote를 정확한 identity로 승인한다", () => expect(assertMatchingQuote(stock, quote)).toBe(quote));
  it.each([
    ["country", { country: "United States" }], ["exchange", { exchange: "NYSE" }], ["symbol", { symbol: "SHLDX" }], ["currency", { currency: "USD" }],
  ])("잘못된 %s quote를 거부한다", (_field, mismatch) => expect(() => assertMatchingQuote(stock, { ...quote, ...mismatch })).toThrow(/MISMATCH/));
});
