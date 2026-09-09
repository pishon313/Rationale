"use client";

import { buildLongTermPerformance } from "@/domain/account-performance";
import { fromKrw } from "@/domain/currency";
import { formatCurrency } from "@/domain/money";
import type { TradingLedger } from "@/domain/trading-ledger";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { displayTradeSystemText } from "@/features/trades/trade-i18n";
import { useI18n } from "@/i18n/i18n-provider";
import { useCurrencyPreference, useExchangeRates } from "@/lib/use-exchange-rates";
import type { InvestmentAccount } from "@/features/accounts/types";

export function AccountPerformanceSection({ trades, stocks, accounts, ledger }: { trades: Trade[]; stocks: Stock[]; accounts: InvestmentAccount[]; ledger: TradingLedger }) {
  const { t, formatNumber, localeTag } = useI18n();
  const rates = useExchangeRates();
  const { displayCurrency } = useCurrencyPreference();
  const data = buildLongTermPerformance(trades, stocks, ledger, rates.snapshot.ratesToKrw, new Date(), accounts);
  const money = (valueKrw: number | null) => valueKrw === null ? "—" : formatCurrency(fromKrw(valueKrw, displayCurrency, rates.snapshot.ratesToKrw), displayCurrency, localeTag);
  const cards = [
    [t("평가금액"), money(data.marketValueKrw), t("현재가 기준 보유 포지션")],
    [t("보유 투자원금"), money(data.investedCostKrw), t("열린 포지션의 원가")],
    [t("순투입액"), money(data.netTradeCapitalKrw), t("매수 투입액에서 매도 회수액을 뺀 금액")],
    [t("실현손익"), money(data.realizedProfitKrw), t("완료된 매도의 확정 손익")],
    [t("미실현손익"), money(data.unrealizedProfitKrw), t("평가금액에서 투자원금을 뺀 금액")],
  ];
  return <section className="mt-4">
    <div className="mb-3"><h2 className="font-semibold">{t("계좌 매매 성과")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("현금 추적 여부와 관계없이 매매와 현재가를 기준으로 계산합니다.")}</p></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{cards.map(([label, value, note]) => <article key={label} className="rounded-xl border bg-[var(--surface)] p-5"><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-3 text-xl font-semibold tabular-nums">{value}</p><small className="mt-2 block text-[var(--muted)]">{note}</small></article>)}</div>
    {data.unpricedPositionCount > 0 && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">{t("현재가가 없는 {count}개 포지션은 투자원금으로 임시 평가했습니다.", { count: formatNumber(data.unpricedPositionCount) })}</p>}
    <div className="mt-4 overflow-hidden rounded-xl border bg-[var(--surface)]"><div className="p-5"><h3 className="font-semibold">{t("계좌별 성과")}</h3><p className="mt-1 text-sm text-[var(--muted)]">{t("현금 스냅샷으로 총수익률이나 XIRR을 추정하지 않습니다.")}</p></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-[var(--surface-muted)] text-xs text-[var(--muted)]"><tr>{["계좌", "평가금액", "보유 투자원금", "순투입액", "실현손익", "미실현손익", "열린 포지션"].map((heading) => <th key={heading} className={`whitespace-nowrap px-4 py-3 ${heading === "계좌" ? "text-left" : "text-right"}`}>{t(heading)}</th>)}</tr></thead><tbody>{data.accounts.map((account) => <tr key={account.accountId} className="border-t"><td className="px-4 py-3 font-medium">{displayTradeSystemText(account.accountName, t)}</td><td className="px-4 text-right tabular-nums">{money(account.marketValueKrw)}</td><td className="px-4 text-right tabular-nums">{money(account.investedCostKrw)}</td><td className="px-4 text-right tabular-nums">{money(account.netTradeCapitalKrw)}</td><td className="px-4 text-right tabular-nums">{money(account.realizedProfitKrw)}</td><td className="px-4 text-right tabular-nums">{money(account.unrealizedProfitKrw)}</td><td className="px-4 text-right tabular-nums">{formatNumber(account.openPositionCount)}</td></tr>)}</tbody></table>{!data.accounts.length && <p className="p-6 text-center text-sm text-[var(--muted)]">{t("계좌 기록이 없습니다.")}</p>}</div></div>
  </section>;
}
