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
  const money = (valueKrw: number) => formatCurrency(fromKrw(valueKrw, displayCurrency, rates.snapshot.ratesToKrw), displayCurrency, localeTag);
  const percent = (value: number | null) => value === null ? "—" : formatNumber(value / 100, { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
  const cards = [
    [t("총자산"), money(data.totalAssetsKrw), t("현금 + 보유 자산")],
    [t("순입금액"), money(data.netContributionsKrw), t("입금 − 출금 + 기초 포지션")],
    [t("총손익"), money(data.totalProfitKrw), t("총자산 − 순입금액")],
    [t("총수익률"), percent(data.totalReturnPercent), t("총손익 ÷ 순입금액")],
    ["XIRR", percent(data.xirrPercent), t("입출금 시점을 반영한 연환산 수익률")],
  ];
  return <section className="mt-4">
    <div className="mb-3"><h2 className="font-semibold">{t("장기 계좌 성과")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("현재가와 기록된 입출금을 기준으로 계산합니다.")}</p></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{cards.map(([label, value, note]) => <article key={label} className="rounded-xl border bg-[var(--surface)] p-5"><p className="text-sm text-[var(--muted)]">{label}</p><p className="mt-3 text-xl font-semibold tabular-nums">{value}</p><small className="mt-2 block text-[var(--muted)]">{note}</small></article>)}</div>
    {data.unpricedPositionCount > 0 && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-100">{t("현재가가 없는 {count}개 포지션은 투자원금으로 임시 평가했습니다.", { count: formatNumber(data.unpricedPositionCount) })}</p>}
    <div className="mt-4 overflow-hidden rounded-xl border bg-[var(--surface)]"><div className="p-5"><h3 className="font-semibold">{t("계좌별 성과")}</h3><p className="mt-1 text-sm text-[var(--muted)]">{t("계좌별 현금, 평가금액과 입출금 기준 성과입니다.")}</p></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-[var(--surface-muted)] text-xs text-[var(--muted)]"><tr>{["계좌", "현금", "보유 자산", "총자산", "순입금액", "총손익", "총수익률", "XIRR"].map((heading) => <th key={heading} className={`whitespace-nowrap px-4 py-3 ${heading === "계좌" ? "text-left" : "text-right"}`}>{t(heading)}</th>)}</tr></thead><tbody>{data.accounts.map((account) => <tr key={account.accountName} className="border-t"><td className="px-4 py-3 font-medium">{displayTradeSystemText(account.accountName, t)}</td><td className="px-4 text-right tabular-nums">{money(account.cashKrw)}</td><td className="px-4 text-right tabular-nums">{money(account.marketValueKrw)}</td><td className="px-4 text-right font-medium tabular-nums">{money(account.totalAssetsKrw)}</td><td className="px-4 text-right tabular-nums">{money(account.netContributionsKrw)}</td><td className={`px-4 text-right tabular-nums ${account.totalProfitKrw > 0 ? "text-emerald-600" : account.totalProfitKrw < 0 ? "text-red-600" : ""}`}>{money(account.totalProfitKrw)}</td><td className="px-4 text-right tabular-nums">{percent(account.totalReturnPercent)}</td><td className="px-4 text-right tabular-nums">{percent(account.xirrPercent)}</td></tr>)}</tbody></table>{!data.accounts.length && <p className="p-6 text-center text-sm text-[var(--muted)]">{t("계좌 기록이 없습니다.")}</p>}</div></div>
    <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{t("TWR과 평가액 기준 Drawdown은 과거 일자별 평가 기록이 쌓인 뒤 제공할 수 있습니다. 현재 Drawdown은 매도 시점의 누적 실현손익 기준입니다.")}</p>
  </section>;
}
