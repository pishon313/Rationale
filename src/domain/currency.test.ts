import { describe, expect, it, vi } from "vitest";
import { convertCurrency, fallbackRatesToKrw, fetchHistoricalRateToKrw, fetchLatestRates, fromKrw, toKrw } from "./currency";

describe("currency", () => {
  it("4개 통화를 원화 기준으로 환산한다", () => {
    expect(toKrw(100, "JPY", fallbackRatesToKrw)).toBeCloseTo(920);
    expect(fromKrw(1380, "USD", fallbackRatesToKrw)).toBe(1);
    expect(convertCurrency(1, "EUR", "USD", fallbackRatesToKrw)).toBeCloseTo(1600 / 1380);
  });

  it("Frankfurter 최신 환율을 KRW 단가로 변환한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [{ date: "2026-08-01", base: "KRW", quote: "USD", rate: 0.00072 }, { date: "2026-08-01", base: "KRW", quote: "JPY", rate: 0.108 }, { date: "2026-08-01", base: "KRW", quote: "EUR", rate: 0.00062 }] }));
    const result = await fetchLatestRates();
    expect(result.ratesToKrw.USD).toBeCloseTo(1388.89, 1);
    expect(result.ratesToKrw.JPY).toBeCloseTo(9.26, 1);
    vi.unstubAllGlobals();
  });

  it("거래일 환율을 불러온다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ date: "2026-07-31", rate: 1392.5 }) }));
    await expect(fetchHistoricalRateToKrw("USD", "2026-08-01")).resolves.toEqual({ date: "2026-07-31", rate: 1392.5 });
    vi.unstubAllGlobals();
  });
});
