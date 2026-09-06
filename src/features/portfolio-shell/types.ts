import type { Currency } from "@/domain/currency";

export const defaultPortfolioId = "default" as const;

export type PortfolioIdentity = {
  id: typeof defaultPortfolioId;
  name: string;
  kind: "personal";
  baseCurrency: Currency;
};

export type PortfolioShellSnapshot =
  | { status: "loading"; portfolio: null; asOf: null; isEmpty: false; error: null }
  | { status: "error"; portfolio: null; asOf: null; isEmpty: false; error: string }
  | { status: "noSelection"; portfolio: null; asOf: null; isEmpty: false; error: null }
  | { status: "ready"; portfolio: PortfolioIdentity; asOf: string | null; isEmpty: boolean; error: null };

export type PortfolioShellFormatters = {
  formatMoney: (value: number, currency?: Currency, options?: Intl.NumberFormatOptions) => string;
  /** Formats a ratio, so 0.125 is displayed as 12.5%. */
  formatPercentage: (ratio: number, options?: Intl.NumberFormatOptions) => string;
  formatAsOf: (value: Date | string | number, options?: Intl.DateTimeFormatOptions) => string;
};

export type PortfolioShellContextValue = PortfolioShellFormatters & {
  snapshot: PortfolioShellSnapshot;
};
