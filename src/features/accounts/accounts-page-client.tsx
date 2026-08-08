"use client";

import Link from "next/link";
import { Archive, Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { buildLongTermPerformance } from "@/domain/account-performance";
import { currencies, fromKrw } from "@/domain/currency";
import { formatCurrency } from "@/domain/money";
import { buildTradingLedger } from "@/domain/trading-ledger";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { useI18n } from "@/i18n/i18n-provider";
import { useLocalCollection } from "@/lib/use-local-collection";
import { useCurrencyPreference, useExchangeRates } from "@/lib/use-exchange-rates";
import { accountKinds, type InvestmentAccount } from "./types";
import { archiveAccount, mergeAccounts, withSingleDefault } from "./account-operations";

export function AccountsPageClient() {
  const { t, localeTag, formatNumber } = useI18n();
  const { allItems: accounts, ready, replaceAsync } = useLocalCollection<InvestmentAccount>("accounts", []);
  const { allItems: trades } = useLocalCollection<Trade>("trades", []);
  const { allItems: stocks } = useLocalCollection<Stock>("stocks", []);
  const rates = useExchangeRates(); const { displayCurrency } = useCurrencyPreference();
  const [editing, setEditing] = useState<InvestmentAccount | "new" | null>(null);
  const [mergeSource, setMergeSource] = useState("");
  const [message, setMessage] = useState("");
  const ledger = useMemo(() => buildTradingLedger(trades, accounts), [accounts, trades]);
  const performance = useMemo(() => buildLongTermPerformance(trades, stocks, ledger, rates.snapshot.ratesToKrw, new Date(), accounts), [accounts, ledger, rates.snapshot.ratesToKrw, stocks, trades]);
  const money = (value: number) => formatCurrency(fromKrw(value, displayCurrency, rates.snapshot.ratesToKrw), displayCurrency, localeTag);

  async function save(account: InvestmentAccount) { await replaceAsync(withSingleDefault(accounts, account)); setEditing(null); }
  async function archive(id: string) {
    if (!window.confirm(t("이 계좌를 보관할까요? 과거 기록과 분석은 유지됩니다."))) return;
    try { await replaceAsync(archiveAccount(accounts, id, ledger)); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "계좌를 보관할 수 없습니다."); }
  }
  async function merge(target: string) {
    if (!window.confirm(t("선택한 계좌의 모든 거래를 대상 계좌로 이동할까요?"))) return;
    await mergeAccounts(accounts, trades, mergeSource, target); window.location.reload();
  }
  return <>
    <div className="flex items-end justify-between gap-3"><div><p className="text-sm text-[var(--muted)]">{t("계좌 identity와 metadata 관리")}</p><h1 className="mt-1 text-2xl font-semibold">{t("계좌")}</h1></div><button onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white"><Plus size={17}/>{t("계좌 추가")}</button></div>
    {message && <div role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">{t(message)}</div>}
    <div className="mt-6 grid gap-4 lg:grid-cols-2">{accounts.map((account) => { const item = performance.accounts.find((value) => value.accountId === account.id); return <article key={account.id} className="rounded-xl border bg-[var(--surface)] p-5"><div className="flex justify-between gap-3"><div><Link className="text-lg font-semibold hover:text-[var(--accent)]" href={`/accounts/detail?id=${encodeURIComponent(account.id)}`}>{account.name}</Link><p className="mt-1 text-xs text-[var(--muted)]">{account.institution || t("기관 미입력")} · {t(account.kind)}{account.subtype ? ` · ${account.subtype}` : ""}{account.isDefault ? ` · ${t("기본 계좌")}` : ""}{account.archivedAt ? ` · ${t("보관됨")}` : ""}</p></div><div className="flex gap-2"><button aria-label={t("수정")} onClick={() => setEditing(account)}><Pencil size={16}/></button>{!account.archivedAt && <button aria-label={t("보관")} onClick={() => void archive(account.id)}><Archive size={16}/></button>}</div></div><dl className="mt-5 grid grid-cols-2 gap-3 text-sm"><Metric label={t("총자산")} value={money(item?.totalAssetsKrw ?? 0)}/><Metric label={t("현금")} value={money(item?.cashKrw ?? 0)}/><Metric label={t("총손익")} value={money(item?.totalProfitKrw ?? 0)}/><Metric label={t("수익률")} value={item?.totalReturnPercent == null ? "—" : formatNumber(item.totalReturnPercent / 100, {style:"percent", maximumFractionDigits:1})}/></dl>{!account.archivedAt && accounts.filter((candidate) => !candidate.archivedAt && candidate.id !== account.id).length > 0 && <div className="mt-4 flex gap-2"><button className="text-xs text-[var(--muted)] underline" onClick={() => setMergeSource(account.id)}>{t("다른 계좌로 병합")}</button>{mergeSource === account.id && <select aria-label={t("병합 대상 계좌")} defaultValue="" onChange={(event) => event.target.value && void merge(event.target.value)} className="h-8 rounded border bg-[var(--surface)] px-2 text-xs"><option value="">{t("대상 선택")}</option>{accounts.filter((candidate) => !candidate.archivedAt && candidate.id !== account.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select>}</div>}</article>})}{ready && !accounts.length && <p className="rounded-xl border p-8 text-center text-sm text-[var(--muted)]">{t("계좌를 추가해 주세요. 0원 계좌도 만들 수 있습니다.")}</p>}</div>
    {editing && <AccountForm account={editing === "new" ? undefined : editing} hasDefault={accounts.some((a) => !a.archivedAt && a.isDefault)} onCancel={() => setEditing(null)} onSave={save}/>} </>;
}

function Metric({label,value}:{label:string;value:string}) { return <div><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="mt-1 font-medium tabular-nums">{value}</dd></div>; }

export function AccountForm({ account, hasDefault, onCancel, onSave }: { account?: InvestmentAccount; hasDefault: boolean; onCancel:()=>void; onSave:(account:InvestmentAccount)=>Promise<void> }) {
  const {t}=useI18n(); const now=new Date().toISOString();
  const [name,setName]=useState(account?.name??""); const [institution,setInstitution]=useState(account?.institution??""); const [kind,setKind]=useState<InvestmentAccount["kind"]>(account?.kind??"brokerage"); const [subtype,setSubtype]=useState(account?.subtype??""); const [baseCurrency,setCurrency]=useState<InvestmentAccount["baseCurrency"]>(account?.baseCurrency??"KRW"); const [isDefault,setDefault]=useState(account?.isDefault??!hasDefault); const [memo,setMemo]=useState(account?.memo??"");
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"><form className="w-full max-w-lg rounded-xl bg-[var(--surface)] p-5" onSubmit={(e)=>{e.preventDefault(); void onSave({id:account?.id??crypto.randomUUID(),name:name.trim(),institution,kind,subtype,baseCurrency,isDefault,archivedAt:account?.archivedAt??null,memo,createdAt:account?.createdAt??now,updatedAt:now});}}><h2 className="text-lg font-semibold">{t(account?"계좌 수정":"계좌 추가")}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label={t("계좌명")}><input required value={name} onChange={e=>setName(e.target.value)}/></Field><Field label={t("금융기관")}><input value={institution} onChange={e=>setInstitution(e.target.value)}/></Field><Field label={t("계좌 유형")}><select value={kind} onChange={e=>setKind(e.target.value as InvestmentAccount["kind"])}>{accountKinds.map(v=><option key={v} value={v}>{t(v)}</option>)}</select></Field><Field label={t("세부 유형")}><input value={subtype} onChange={e=>setSubtype(e.target.value)}/></Field><Field label={t("기준 통화")}><select value={baseCurrency} onChange={e=>setCurrency(e.target.value as InvestmentAccount["baseCurrency"])}>{currencies.map(v=><option key={v}>{v}</option>)}</select></Field><label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={isDefault} onChange={e=>setDefault(e.target.checked)}/>{t("기본 계좌")}</label><div className="sm:col-span-2"><Field label={t("메모")}><textarea value={memo} onChange={e=>setMemo(e.target.value)}/></Field></div></div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white">{t("저장")}</button></div></form></div>;
}
function Field({label,children}:{label:string;children:React.ReactNode}) { return <label className="text-sm">{label}<span className="mt-1 block [&>*]:h-10 [&>*]:w-full [&>*]:rounded-lg [&>*]:border [&>*]:bg-[var(--surface)] [&>*]:px-3">{children}</span></label>; }
