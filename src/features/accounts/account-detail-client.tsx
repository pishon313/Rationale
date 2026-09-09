"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { buildLongTermPerformance } from "@/domain/account-performance";
import { fromKrw } from "@/domain/currency";
import { formatCurrency } from "@/domain/money";
import { buildTradingLedger } from "@/domain/trading-ledger";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { useI18n } from "@/i18n/i18n-provider";
import { useLocalCollection } from "@/lib/use-local-collection";
import { useCurrencyPreference, useExchangeRates } from "@/lib/use-exchange-rates";
import type { InvestmentAccount } from "./types";
import { accountFeePolicyStatus } from "./account-fee-policy";
import { AccountCashSummary } from "./account-cash-summary";

export function AccountDetailClient() {
  const id = useSyncExternalStore(subscribeLocation, () => new URLSearchParams(window.location.search).get("id") ?? "", () => "");
  const { t, formatNumber, formatDate, localeTag } = useI18n();
  const accountStore = useLocalCollection<InvestmentAccount>("accounts", []);
  const { allItems: trades } = useLocalCollection<Trade>("trades", []);
  const { allItems: stocks } = useLocalCollection<Stock>("stocks", []);
  const rates = useExchangeRates();
  const { displayCurrency } = useCurrencyPreference();
  const accounts = accountStore.allItems;
  const account = accounts.find((item) => item.id === id);
  const ledger = useMemo(() => buildTradingLedger(trades, accounts), [accounts, trades]);
  const performance = useMemo(() => buildLongTermPerformance(trades, stocks, ledger, rates.snapshot.ratesToKrw, new Date(), accounts).accounts.find((item) => item.accountId === id), [accounts, id, ledger, rates.snapshot.ratesToKrw, stocks, trades]);
  const money = (value: number | null | undefined) => value == null ? "—" : formatCurrency(fromKrw(value, displayCurrency, rates.snapshot.ratesToKrw), displayCurrency, localeTag);
  if (!id) return null;
  if (!account) return <p className="p-6 text-sm text-[var(--muted)]">{t("계좌를 찾을 수 없습니다.")}</p>;
  const positions = ledger.positions.filter((position) => position.accountId === id && position.quantity > 0);
  const recent = trades.filter((trade) => trade.accountId === id && !trade.deletedAt).sort((left, right) => right.tradedAt.localeCompare(left.tradedAt)).slice(0, 10);
  const metrics = [
    ["평가금액", performance?.marketValueKrw],
    ["보유 투자원금", performance?.investedCostKrw],
    ["순투입액", performance?.netTradeCapitalKrw],
    ["실현손익", performance?.realizedProfitKrw],
    ["미실현손익", performance?.unrealizedProfitKrw],
    ["열린 포지션", performance?.openPositionCount],
  ] as const;
  return <>
    <Link href="/accounts" className="text-sm text-[var(--accent)]">← {t("계좌")}</Link><h1 className="mt-3 text-2xl font-semibold">{account.name}</h1><p className="mt-1 text-sm text-[var(--muted)]">{account.institution} · {t(account.kind)} {account.subtype}</p><p className="mt-2 text-sm font-medium text-[var(--accent)]">{accountFeePolicyStatus(account.feePolicy,t)}</p>
    <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{metrics.map(([label,value])=><article key={label} className="rounded-xl border bg-[var(--surface)] p-4"><p className="text-xs text-[var(--muted)]">{t(label)}</p><p className="mt-2 font-semibold tabular-nums">{label === "열린 포지션" ? t("{count}개", { count: formatNumber(Number(value ?? 0)) }) : money(value)}</p></article>)}</div>
    {performance?.holdingsPlusTrackedCashKrw != null && <p className="mt-3 rounded-lg bg-[var(--surface-muted)] p-3 text-sm"><span className="text-[var(--muted)]">{t("보유자산 + 추적 현금")}</span> <b className="ml-2 tabular-nums">{money(performance.holdingsPlusTrackedCashKrw)}</b>{performance.cashTrackingStatus === "partial" && <span className="ml-2 text-xs text-[var(--muted)]">{t("일부 통화 현금 미추적")}</span>}</p>}
    {!account.archivedAt && <AccountCashSummary accounts={accounts} trades={trades} ledger={ledger} accountId={id} onReplaceAccounts={accountStore.replaceAsync}/>}
    <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><h2 className="font-semibold">{t("보유 position")}</h2>{positions.map(position=><p key={`${position.stockId}-${position.currency}`} className="mt-2 text-sm">{position.stockName} · {formatNumber(position.quantity)} · {position.currency}</p>)}{!positions.length&&<p className="mt-2 text-sm text-[var(--muted)]">—</p>}</section>
    <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><h2 className="font-semibold">{t("최근 매매")}</h2>{recent.map(trade=><p key={trade.id} className="mt-2 text-sm">{formatDate(trade.tradedAt,{dateStyle:"medium"})} · {t(trade.tradeType)} · {trade.stockName||formatNumber(trade.amount??0)}</p>)}</section>
  </>;
}

function subscribeLocation(listener:()=>void){window.addEventListener("popstate",listener);return()=>window.removeEventListener("popstate",listener);}
