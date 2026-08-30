export const currencies = ["KRW", "USD", "JPY", "EUR", "CAD", "HKD"] as const;
export type Currency = (typeof currencies)[number];
export function currencyMinorUnitDigits(currency: Currency) { return currency === "KRW" || currency === "JPY" ? 0 : 2; }
export function minorUnitsToMajor(value: number, currency: Currency) { return value / 10 ** currencyMinorUnitDigits(currency); }
export type RatesToKrw = Record<Currency, number>;

export const fallbackRatesToKrw: RatesToKrw = { KRW: 1, USD: 1380, JPY: 9.2, EUR: 1600, CAD: 1000, HKD: 177 };

export type ExchangeRateSnapshot = {
  id: "latest";
  ratesToKrw: RatesToKrw;
  rateDate: string | null;
  fetchedAt: string | null;
  source: "fallback" | "frankfurter";
  updatedAt: string;
};

export type CurrencyPreference = { id: "currency"; displayCurrency: Currency; updatedAt: string };

export const fallbackExchangeRates: ExchangeRateSnapshot = { id: "latest", ratesToKrw: fallbackRatesToKrw, rateDate: null, fetchedAt: null, source: "fallback", updatedAt: new Date(0).toISOString() };
export const fallbackCurrencyPreference: CurrencyPreference = { id: "currency", displayCurrency: "KRW", updatedAt: new Date(0).toISOString() };

export function toKrw(value: number, currency: Currency, rates: RatesToKrw) { return value * rates[currency]; }
export function fromKrw(value: number, currency: Currency, rates: RatesToKrw) { return value / rates[currency]; }
export function convertCurrency(value: number, from: Currency, to: Currency, rates: RatesToKrw) { return fromKrw(toKrw(value, from, rates), to, rates); }

export async function fetchLatestRates(): Promise<ExchangeRateSnapshot> {
  const response = await fetch("https://api.frankfurter.dev/v2/rates?base=KRW&quotes=USD,JPY,EUR,CAD,HKD", { cache: "no-store" });
  if (!response.ok) throw new Error("환율 정보를 불러오지 못했습니다.");
  const rows = await response.json() as Array<{ date: string; base: string; quote: Currency; rate: number }>;
  const rates = { ...fallbackRatesToKrw };
  for (const row of rows) if (row.quote !== "KRW" && Number.isFinite(row.rate) && row.rate > 0) rates[row.quote] = 1 / row.rate;
  const now = new Date().toISOString();
  return { id: "latest", ratesToKrw: rates, rateDate: rows[0]?.date ?? now.slice(0, 10), fetchedAt: now, source: "frankfurter", updatedAt: now };
}

export async function fetchHistoricalRateToKrw(currency: Currency, date: string) {
  if (currency === "KRW") return { rate: 1, date };
  const response = await fetch(`https://api.frankfurter.dev/v2/rate/${currency}/KRW?date=${encodeURIComponent(date)}`, { cache: "no-store" });
  if (!response.ok) throw new Error("거래일 환율을 불러오지 못했습니다.");
  const value = await response.json() as { date: string; rate: number };
  if (!Number.isFinite(value.rate) || value.rate <= 0) throw new Error("거래일 환율이 올바르지 않습니다.");
  return { rate: value.rate, date: value.date };
}
