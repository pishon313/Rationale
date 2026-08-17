"use client";
import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";
import { buildLongTermPerformance } from "@/domain/account-performance";
import { buildTradingLedger } from "@/domain/trading-ledger";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { useI18n } from "@/i18n/i18n-provider";
import { useLocalCollection } from "@/lib/use-local-collection";
import { useExchangeRates } from "@/lib/use-exchange-rates";
import type { InvestmentAccount } from "./types";
import { accountFeePolicyStatus } from "./account-fee-policy";

export function AccountDetailClient() {
 const id=useSyncExternalStore(subscribeLocation,()=>new URLSearchParams(window.location.search).get("id")??"",()=>"");
 const {t,formatNumber,formatDate}=useI18n(); const {allItems:accounts}=useLocalCollection<InvestmentAccount>("accounts",[]); const {allItems:trades}=useLocalCollection<Trade>("trades",[]); const {allItems:stocks}=useLocalCollection<Stock>("stocks",[]); const rates=useExchangeRates();
 const account=accounts.find(a=>a.id===id); const ledger=useMemo(()=>buildTradingLedger(trades,accounts),[accounts,trades]); const performance=useMemo(()=>buildLongTermPerformance(trades,stocks,ledger,rates.snapshot.ratesToKrw,new Date(),accounts).accounts.find(a=>a.accountId===id),[accounts,id,ledger,rates.snapshot.ratesToKrw,stocks,trades]);
 if(!id)return null;
 if(!account)return <p className="p-6 text-sm text-[var(--muted)]">{t("계좌를 찾을 수 없습니다.")}</p>;
 const positions=ledger.positions.filter(p=>p.accountId===id&&p.quantity>0); const recent=trades.filter(x=>x.accountId===id&&!x.deletedAt).sort((a,b)=>b.tradedAt.localeCompare(a.tradedAt)).slice(0,10);
 return <><Link href="/accounts" className="text-sm text-[var(--accent)]">← {t("계좌")}</Link><h1 className="mt-3 text-2xl font-semibold">{account.name}</h1><p className="mt-1 text-sm text-[var(--muted)]">{account.institution} · {t(account.kind)} {account.subtype}</p><p className="mt-2 text-sm font-medium text-[var(--accent)]">{accountFeePolicyStatus(account.feePolicy,t)}</p><div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["총자산",performance?.totalAssetsKrw],["현금",performance?.cashKrw],["보유 자산",performance?.marketValueKrw],["순입금액",performance?.netContributionsKrw],["총손익",performance?.totalProfitKrw],["총수익률",performance?.totalReturnPercent],["XIRR",performance?.xirrPercent]].map(([label,value])=><article key={String(label)} className="rounded-xl border bg-[var(--surface)] p-4"><p className="text-xs text-[var(--muted)]">{t(String(label))}</p><p className="mt-2 font-semibold tabular-nums">{String(label).includes("수익률")||label==="XIRR"?(value==null?"—":formatNumber(Number(value)/100,{style:"percent",maximumFractionDigits:1})):formatNumber(Number(value??0),{maximumFractionDigits:0})}</p></article>)}</div><section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><h2 className="font-semibold">{t("통화별 현금")}</h2>{ledger.cashBalances.filter(b=>b.accountId===id).map(b=><p key={b.currency} className="mt-2 text-sm">{b.currency}: {formatNumber(b.balance)}</p>)}</section><section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><h2 className="font-semibold">{t("보유 position")}</h2>{positions.map(p=><p key={`${p.stockId}-${p.currency}`} className="mt-2 text-sm">{p.stockName} · {formatNumber(p.quantity)} · {p.currency}</p>)}{!positions.length&&<p className="mt-2 text-sm text-[var(--muted)]">—</p>}</section><section className="mt-4 rounded-xl border bg-[var(--surface)] p-5"><h2 className="font-semibold">{t("최근 매매")}</h2>{recent.map(x=><p key={x.id} className="mt-2 text-sm">{formatDate(x.tradedAt,{dateStyle:"medium"})} · {t(x.tradeType)} · {x.stockName||formatNumber(x.amount??0)}</p>)}</section></>;
}

function subscribeLocation(listener:()=>void){window.addEventListener("popstate",listener);return()=>window.removeEventListener("popstate",listener);}
