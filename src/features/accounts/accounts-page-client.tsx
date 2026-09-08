"use client";

import Link from "next/link";
import { Archive, Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { buildLongTermPerformance, type AccountPerformance } from "@/domain/account-performance";
import { currencies, fromKrw } from "@/domain/currency";
import { formatCurrency } from "@/domain/money";
import { buildTradingLedger } from "@/domain/trading-ledger";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { useI18n } from "@/i18n/i18n-provider";
import { useLocalCollection } from "@/lib/use-local-collection";
import { useCurrencyPreference, useExchangeRates } from "@/lib/use-exchange-rates";
import { accountKinds, cashTrackingOf, type InvestmentAccount } from "./types";
import { archiveAccount, mergeAccounts, withSingleDefault } from "./account-operations";
import { accountFeePolicyStatus, validateAccountFeePolicy, type AccountFeePolicyV1 } from "./account-fee-policy";
import { AccountFeePolicyEditor } from "./account-fee-policy-editor";
import { validateAccountCashTracking } from "./account-cash-tracking";
import type { PortfolioAllocationTarget, PortfolioPlanState } from "@/features/portfolio-plan/types";

export function AccountsPageClient() {
  const { t, localeTag, formatNumber } = useI18n();
  const accountStore = useLocalCollection<InvestmentAccount>("accounts", []);
  const tradeStore = useLocalCollection<Trade>("trades", []);
  const portfolioTargetStore = useLocalCollection<PortfolioAllocationTarget>("portfolio-allocation-targets", []);
  const portfolioStateStore = useLocalCollection<PortfolioPlanState>("portfolio-plan-state", []);
  const { allItems: stocks } = useLocalCollection<Stock>("stocks", []);
  const accounts = accountStore.allItems;
  const trades = tradeStore.allItems;
  const rates = useExchangeRates();
  const { displayCurrency } = useCurrencyPreference();
  const [editing, setEditing] = useState<InvestmentAccount | "new" | null>(null);
  const [mergeSource, setMergeSource] = useState("");
  const [message, setMessage] = useState("");
  const ledger = useMemo(() => buildTradingLedger(trades, accounts), [accounts, trades]);
  const performance = useMemo(() => buildLongTermPerformance(trades, stocks, ledger, rates.snapshot.ratesToKrw, new Date(), accounts), [accounts, ledger, rates.snapshot.ratesToKrw, stocks, trades]);
  const money = (value: number | null) => value === null ? "—" : formatCurrency(fromKrw(value, displayCurrency, rates.snapshot.ratesToKrw), displayCurrency, localeTag);

  async function save(account: InvestmentAccount) {
    await accountStore.replaceAsync(withSingleDefault(accounts, account));
    setEditing(null);
  }

  async function archive(id: string) {
    if (!window.confirm(t("이 계좌를 보관할까요? 과거 기록과 분석은 유지됩니다."))) return;
    try {
      await accountStore.replaceAsync(archiveAccount(accounts, id, ledger));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "계좌를 보관할 수 없습니다.");
    }
  }

  async function merge(target: string) {
    if (portfolioStateStore.ready === false || portfolioTargetStore.ready === false || portfolioStateStore.loadError || portfolioTargetStore.loadError) {
      setMessage(t("Portfolio 연결 정보를 불러온 뒤 다시 시도해 주세요."));
      return;
    }
    if (!window.confirm(t("알려진 추적 현금은 병합 시점 기준으로 다시 설정됩니다. 미추적 현금은 임의로 계산하지 않습니다. 기존 매매 기록과 손익은 유지됩니다. 계속할까요?"))) return;
    try {
      const activeRevisionId = portfolioStateStore.allItems.find((item) => item.id === "default")?.activeRevisionId ?? null;
      const merged = await mergeAccounts(accounts, trades, mergeSource, target, { activeRevisionId, targets: portfolioTargetStore.allItems });
      accountStore.applyCommitted(merged.accounts);
      tradeStore.applyCommitted(merged.trades);
      setMergeSource("");
      setMessage(t("계좌를 병합하고 전체 원장을 다시 계산했습니다."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("계좌를 병합할 수 없습니다."));
    }
  }

  return <>
    <div className="flex items-end justify-between gap-3"><div><p className="text-sm text-[var(--muted)]">{t("매매와 손익을 기준으로 계좌를 관리합니다.")}</p><h1 className="mt-1 text-2xl font-semibold">{t("계좌")}</h1></div><button onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white"><Plus size={17}/>{t("계좌 추가")}</button></div>
    {message && <div role="alert" className="mt-4 rounded-lg bg-[var(--surface-muted)] p-3 text-sm">{t(message)}</div>}
    <div className="mt-6 grid gap-4 lg:grid-cols-2">{accounts.map((account) => {
      const item = performance.accounts.find((value) => value.accountId === account.id);
      return <article key={account.id} className="rounded-xl border bg-[var(--surface)] p-5">
        <div className="flex justify-between gap-3"><div><Link className="text-lg font-semibold hover:text-[var(--accent)]" href={`/accounts/detail?id=${encodeURIComponent(account.id)}`}>{account.name}</Link><p className="mt-1 text-xs text-[var(--muted)]">{account.institution || t("기관 미입력")} · {t(account.kind)}{account.subtype ? ` · ${account.subtype}` : ""}{account.isDefault ? ` · ${t("기본 계좌")}` : ""}{account.archivedAt ? ` · ${t("보관됨")}` : ""}</p><p className="mt-2 text-xs font-medium text-[var(--accent)]">{accountFeePolicyStatus(account.feePolicy, t)}</p></div><div className="flex gap-2"><button aria-label={t("수정")} onClick={() => setEditing(account)}><Pencil size={16}/></button>{!account.archivedAt && <button aria-label={t("보관")} onClick={() => void archive(account.id)}><Archive size={16}/></button>}</div></div>
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm"><Metric label={t("평가금액")} value={money(item?.marketValueKrw ?? null)}/><Metric label={t("보유 투자원금")} value={money(item?.investedCostKrw ?? null)}/><Metric label={t("미실현손익")} value={money(item?.unrealizedProfitKrw ?? null)}/><Metric label={t("실현손익")} value={money(item?.realizedProfitKrw ?? null)}/></dl>
        {item && <div className="mt-4 border-t pt-3 text-xs"><p><span className="text-[var(--muted)]">{t("순투입액")}</span> <span className="ml-2 font-medium tabular-nums">{money(item.netTradeCapitalKrw)}</span></p><p className="mt-2 text-[var(--muted)]">{cashStatus(item, ledger, formatNumber, t)}</p></div>}
        {!account.archivedAt && accounts.filter((candidate) => !candidate.archivedAt && candidate.id !== account.id).length > 0 && <div className="mt-4"><div className="flex gap-2"><button className="text-xs text-[var(--muted)] underline" onClick={() => setMergeSource(account.id)}>{t("다른 계좌로 병합")}</button>{mergeSource === account.id && <select aria-label={t("병합 대상 계좌")} defaultValue="" onChange={(event) => event.target.value && void merge(event.target.value)} className="h-8 rounded border bg-[var(--surface)] px-2 text-xs"><option value="">{t("대상 선택")}</option>{accounts.filter((candidate) => !candidate.archivedAt && candidate.id !== account.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select>}</div>{mergeSource === account.id && <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("병합하면 대상 계좌의 수수료 정책을 앞으로 사용합니다. 원본 계좌의 정책은 보관되며 기존 거래 수수료는 바뀌지 않습니다.")}</p>}</div>}
      </article>;
    })}{accountStore.ready && !accounts.length && <p className="rounded-xl border p-8 text-center text-sm text-[var(--muted)]">{t("계좌를 추가해 주세요.")}</p>}</div>
    {editing && <AccountForm account={editing === "new" ? undefined : editing} hasDefault={accounts.some((account) => !account.archivedAt && account.isDefault)} onCancel={() => setEditing(null)} onSave={save}/>}
  </>;
}

function cashStatus(item: AccountPerformance, ledger: ReturnType<typeof buildTradingLedger>, formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string, t: (key: string, params?: Record<string, string | number>) => string) {
  if (item.cashTrackingStatus === "untracked") return t("현금 미추적");
  const amounts = ledger.cashBalances.filter((balance) => balance.accountId === item.accountId).map((balance) => `${balance.currency} ${formatNumber(balance.balance, { style: "currency", currency: balance.currency })}`).join(", ");
  return item.cashTrackingStatus === "partial" ? `${t("일부 통화 현금 미추적")} · ${amounts}` : t("추적 현금: {amounts}", { amounts });
}

function Metric({label,value}:{label:string;value:string}) { return <div><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="mt-1 font-medium tabular-nums">{value}</dd></div>; }

export function AccountForm({ account, hasDefault, onCancel, onSave }: { account?: InvestmentAccount; hasDefault: boolean; onCancel:()=>void; onSave:(account:InvestmentAccount)=>Promise<void> }) {
  const {t}=useI18n(); const now=new Date().toISOString();
  const [name,setName]=useState(account?.name??""); const [institution,setInstitution]=useState(account?.institution??""); const [kind,setKind]=useState<InvestmentAccount["kind"]>(account?.kind??"brokerage"); const [subtype,setSubtype]=useState(account?.subtype??""); const [baseCurrency,setCurrency]=useState<InvestmentAccount["baseCurrency"]>(account?.baseCurrency??"KRW"); const [isDefault,setDefault]=useState(account?.isDefault??!hasDefault); const [memo,setMemo]=useState(account?.memo??"");
  const [feePolicy,setFeePolicy]=useState<AccountFeePolicyV1|null>(account?.feePolicy??null); const [error,setError]=useState("");
  const retainedOtherCurrencies = account && baseCurrency !== account.baseCurrency && cashTrackingOf(account).baselines.some((baseline) => baseline.currency !== baseCurrency);
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="account-form-title"><form className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-[var(--surface)] p-5" onSubmit={(event)=>{event.preventDefault(); let normalized=feePolicy; if(feePolicy){const result=validateAccountFeePolicy(feePolicy); if(!result.valid){setError(result.issues[0]?.message??t("수수료 정책을 저장할 수 없습니다.")); return;} normalized=result.policy;} const cashResult=validateAccountCashTracking(cashTrackingOf(account??{cashTracking:null})); if(!cashResult.valid){setError(cashResult.issues[0]?.message??t("현재 현금 정보를 저장할 수 없습니다.")); return;} setError(""); void onSave({id:account?.id??crypto.randomUUID(),name:name.trim(),institution,kind,subtype,baseCurrency,isDefault,archivedAt:account?.archivedAt??null,memo,...(normalized===null&&account?.feePolicy===undefined?{}:{feePolicy:normalized}),cashTracking:cashResult.tracking,createdAt:account?.createdAt??now,updatedAt:now});}}><h2 id="account-form-title" className="text-lg font-semibold">{t(account?"계좌 수정":"계좌 추가")}</h2>{error&&<p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">{t(error)}</p>}<div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label={t("계좌명")}><input required value={name} onChange={event=>setName(event.target.value)}/></Field><Field label={t("금융기관")}><input value={institution} onChange={event=>setInstitution(event.target.value)}/></Field><Field label={t("계좌 유형")}><select value={kind} onChange={event=>setKind(event.target.value as InvestmentAccount["kind"])}>{accountKinds.map(value=><option key={value} value={value}>{t(value)}</option>)}</select></Field><Field label={t("세부 유형")}><input value={subtype} onChange={event=>setSubtype(event.target.value)}/></Field><Field label={t("기준 통화")}><select value={baseCurrency} onChange={event=>setCurrency(event.target.value as InvestmentAccount["baseCurrency"])}>{currencies.map(value=><option key={value}>{value}</option>)}</select></Field><label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={isDefault} onChange={event=>setDefault(event.target.checked)}/>{t("기본 계좌")}</label>{retainedOtherCurrencies && <p className="sm:col-span-2 text-xs text-[var(--muted)]">{t("기준 통화를 바꿔도 다른 통화의 현재 현금 정보는 유지됩니다.")}</p>}<div className="sm:col-span-2"><Field label={t("메모")}><textarea value={memo} onChange={event=>setMemo(event.target.value)}/></Field></div><div className="sm:col-span-2"><AccountFeePolicyEditor value={feePolicy} baseCurrency={baseCurrency} onChange={setFeePolicy}/></div></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white">{t("저장")}</button></div></form></div>;
}

function Field({label,children}:{label:string;children:React.ReactNode}) { return <label className="text-sm">{label}<span className="mt-1 block [&>*]:h-10 [&>*]:w-full [&>*]:rounded-lg [&>*]:border [&>*]:bg-[var(--surface)] [&>*]:px-3">{children}</span></label>; }
