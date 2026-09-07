"use client";

import { AlertTriangle, WalletCards } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { Currency } from "@/domain/currency";
import type { TradingLedger } from "@/domain/trading-ledger";
import type { Trade } from "@/features/trades/types";
import { useI18n } from "@/i18n/i18n-provider";
import {
  candidateAccountCashCurrencies,
  cashBaselineFor,
  removeAccountCashBaseline,
  upsertAccountCashBaseline,
  type AccountCashBaselineInput,
  type AccountCashCandidate,
} from "./account-cash-actions";
import { AccountCashBaselineDialog } from "./account-cash-baseline-dialog";
import type { InvestmentAccount } from "./types";

type Props = {
  accounts: readonly InvestmentAccount[];
  trades: readonly Trade[];
  ledger: TradingLedger;
  accountId?: string;
  onReplaceAccounts: (accounts: InvestmentAccount[]) => Promise<void>;
};

export function AccountCashSummary({ accounts, trades, ledger, accountId, onReplaceAccounts }: Props) {
  const { t, formatDate, formatNumber } = useI18n();
  const [editing, setEditing] = useState<AccountCashCandidate | null>(null);
  const [stopping, setStopping] = useState<AccountCashCandidate | null>(null);
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  const [stopSaving, setStopSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const primaryActionButtons = useRef(new Map<string, HTMLButtonElement>());
  const candidates = useMemo(
    () => candidateAccountCashCurrencies(accounts, trades).filter((candidate) => !accountId || candidate.accountId === accountId),
    [accountId, accounts, trades],
  );
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  function open(candidate: AccountCashCandidate, trigger: HTMLElement) {
    setReturnFocus(trigger);
    setEditing(candidate);
    setError("");
  }

  async function save(input: AccountCashBaselineInput) {
    await onReplaceAccounts(upsertAccountCashBaseline(accounts, input));
  }

  async function stop() {
    if (!stopping || stopSaving) return;
    const stoppedKey = `${stopping.accountId}:${stopping.currency}`;
    setStopSaving(true);
    try {
      await onReplaceAccounts(removeAccountCashBaseline(accounts, stopping.accountId, stopping.currency));
      setStopping(null);
      setError("");
      setMessage(t("현금 추적을 중단했습니다."));
      window.setTimeout(() => primaryActionButtons.current.get(stoppedKey)?.focus(), 0);
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("현금 추적을 중단하지 못했습니다. 다시 시도해 주세요."));
    } finally {
      setStopSaving(false);
    }
  }

  return <section className="mt-4 rounded-xl border bg-[var(--surface)] p-5" aria-labelledby={`cash-summary-${accountId ?? "all"}`}>
    <div className="flex items-start gap-3">
      <WalletCards size={19} className="mt-0.5 shrink-0 text-[var(--accent)]" />
      <div>
        <h2 id={`cash-summary-${accountId ?? "all"}`} className="font-semibold">{t("현재 현금")}</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("현금을 입력하지 않아도 매매와 손익은 정상적으로 계산됩니다.")}</p>
      </div>
    </div>
    {message && <p role="status" aria-live="polite" className="mt-4 rounded-lg bg-[var(--accent-soft)] p-3 text-sm text-[var(--accent)]">{message}</p>}
    {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">{error}</p>}
    {!accounts.some((account) => !account.archivedAt) ? <p className="mt-4 text-sm text-[var(--muted)]">{t("현금을 관리하려면 먼저 계좌를 추가해 주세요.")} <Link href="/accounts" className="font-medium text-[var(--accent)] underline">{t("계좌 관리로 이동")}</Link></p> : <div className="mt-4 grid gap-3 lg:grid-cols-2">
      {candidates.map((candidate) => {
        const account = accountById.get(candidate.accountId)!;
        const baseline = cashBaselineFor(account, candidate.currency);
        const balance = ledger.cashBalances.find((item) => item.accountId === candidate.accountId && item.currency === candidate.currency);
        return <article key={`${candidate.accountId}:${candidate.currency}`} className="rounded-lg bg-[var(--surface-muted)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{account.name} · {candidate.currency}</p>
              {baseline && balance ? <>
                <p className={`mt-2 text-lg font-semibold tabular-nums ${balance.isNegative ? "text-red-600 dark:text-red-300" : ""}`}>{formatCash(balance.balance, candidate.currency, formatNumber)}</p>
                {balance.balance === 0 && <p className="mt-1 text-xs font-medium text-[var(--accent)]">{t("실제 0")}</p>}
                <p className="mt-1 text-xs text-[var(--muted)]">{t("{date}부터 추적", { date: formatDate(baseline.asOf, { dateStyle: "medium", timeStyle: "short" }) })}</p>
                {balance.isNegative && <p className="mt-2 flex gap-2 text-xs text-red-700 dark:text-red-300"><AlertTriangle size={15} className="shrink-0" />{t("추적 중인 현금이 음수입니다. 누락된 입출금이 있거나 현재 현금을 다시 맞춰야 할 수 있습니다.")}</p>}
              </> : <>
                <p className="mt-2 text-sm font-semibold">{t("현금 미추적")}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{t("매매 기록과 손익 계산에는 영향이 없습니다.")}</p>
              </>}
            </div>
            <div className="flex flex-wrap gap-2">
              <button ref={(node) => { const key = `${candidate.accountId}:${candidate.currency}`; if (node) primaryActionButtons.current.set(key, node); else primaryActionButtons.current.delete(key); }} onClick={(event) => open(candidate, event.currentTarget)} className="rounded-md border bg-[var(--surface)] px-3 py-1.5 text-xs">{t(baseline ? "현재 현금 수정" : "현재 현금 입력")}</button>
              {baseline && <button onClick={(event) => { setReturnFocus(event.currentTarget); setStopping(candidate); setError(""); }} className="rounded-md border border-red-300 bg-[var(--surface)] px-3 py-1.5 text-xs text-red-700 dark:border-red-900 dark:text-red-300">{t("현금 추적 중단")}</button>}
            </div>
          </div>
        </article>;
      })}
    </div>}
    {editing && <AccountCashBaselineDialog
      accounts={accounts}
      initialAccountId={editing.accountId}
      initialCurrency={editing.currency}
      returnFocus={returnFocus}
      onClose={() => setEditing(null)}
      onSave={save}
      onSaved={() => { setError(""); setMessage(t("현재 현금을 저장했습니다.")); }}
    />}
    {stopping && <StopCashTrackingDialog
      account={accountById.get(stopping.accountId)!}
      currency={stopping.currency}
      saving={stopSaving}
      error={error}
      onCancel={() => { setStopping(null); setError(""); window.setTimeout(() => returnFocus?.focus(), 0); }}
      onConfirm={() => void stop()}
    />}
  </section>;
}

function StopCashTrackingDialog({ account, currency, saving, error, onCancel, onConfirm }: { account: InvestmentAccount; currency: Currency; saving: boolean; error: string; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useI18n();
  return <div className="fixed inset-0 z-[400] grid place-items-center bg-black/40 p-4" role="alertdialog" aria-modal="true" aria-labelledby="stop-cash-title" aria-describedby="stop-cash-description">
    <div className="w-full max-w-md rounded-xl bg-[var(--surface)] p-5 shadow-2xl">
      <h2 id="stop-cash-title" className="text-lg font-semibold">{t("현금 추적 중단")}</h2>
      <p className="mt-2 font-medium">{account.name} · {currency}</p>
      <p id="stop-cash-description" className="mt-3 text-sm leading-6 text-[var(--muted)]">{t("현금 추적을 중단해도 기존 매매·입출금 기록은 삭제되지 않습니다. 현재 현금을 다시 입력하기 전까지 이 계좌·통화의 현금은 표시되지 않습니다.")}</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      <div className="mt-5 flex justify-end gap-2"><button autoFocus type="button" disabled={saving} onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button type="button" disabled={saving} onClick={onConfirm} className="rounded-lg bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-50">{t("추적 중단")}</button></div>
    </div>
  </div>;
}

function formatCash(value: number, currency: Currency, formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string) {
  return formatNumber(value, {
    style: "currency",
    currency,
    minimumFractionDigits: currency === "KRW" || currency === "JPY" ? 0 : 2,
    maximumFractionDigits: currency === "KRW" || currency === "JPY" ? 0 : 2,
  });
}
