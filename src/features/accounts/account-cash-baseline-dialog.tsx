"use client";

import { useEffect, useId, useRef, useState } from "react";
import { currencies, type Currency } from "@/domain/currency";
import { useI18n } from "@/i18n/i18n-provider";
import { localDateTimeValue } from "@/lib/local-date";
import { cashBaselineFor, type AccountCashBaselineInput } from "./account-cash-actions";
import type { InvestmentAccount } from "./types";

type Props = {
  accounts: readonly InvestmentAccount[];
  initialAccountId?: string;
  initialCurrency?: Currency;
  returnFocus?: HTMLElement | null;
  onClose: () => void;
  onSave: (input: AccountCashBaselineInput) => Promise<void>;
  onSaved?: () => void;
};

export function AccountCashBaselineDialog({ accounts, initialAccountId, initialCurrency, returnFocus, onClose, onSave, onSaved }: Props) {
  const { t } = useI18n();
  const active = accounts.filter((account) => !account.archivedAt);
  const initialAccount = active.find((account) => account.id === initialAccountId)
    ?? active.find((account) => account.isDefault)
    ?? active[0];
  const initialBaseline = initialAccount && initialCurrency ? cashBaselineFor(initialAccount, initialCurrency) : null;
  const updateMode = Boolean(initialBaseline);
  const titleId = useId();
  const descriptionId = useId();
  const boundaryId = useId();
  const firstField = useRef<HTMLSelectElement | HTMLInputElement>(null);
  const [accountId, setAccountId] = useState(initialAccount?.id ?? "");
  const selectedAccount = active.find((account) => account.id === accountId);
  const [currency, setCurrency] = useState<Currency>(initialCurrency ?? initialAccount?.baseCurrency ?? "KRW");
  const [balance, setBalance] = useState(initialBaseline?.balance ?? "");
  const [asOf, setAsOf] = useState(() => localDateTimeValue(initialBaseline ? new Date(initialBaseline.asOf) : new Date(), true));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    firstField.current?.focus();
    return () => { window.setTimeout(() => returnFocus?.focus(), 0); };
  }, [returnFocus]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose, saving]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError("");
    if (!selectedAccount) {
      setError(t("활성 계좌를 선택해 주세요."));
      return;
    }
    const timestamp = Date.parse(asOf);
    if (!Number.isFinite(timestamp)) {
      setError(t("기준 일시를 확인해 주세요."));
      return;
    }
    if (timestamp > Date.now() + 5 * 60_000) {
      setError(t("기준 일시는 현재보다 미래일 수 없습니다."));
      return;
    }
    setSaving(true);
    try {
      await onSave({ accountId, currency, balance, asOf: new Date(timestamp).toISOString() });
      onSaved?.();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? t(cause.message) : t("현재 현금을 저장하지 못했습니다. 다시 시도해 주세요."));
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-[400] grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
    <form className="w-full max-w-lg rounded-xl bg-[var(--surface)] p-5 shadow-2xl" onSubmit={submit}>
      <h2 id={titleId} className="text-lg font-semibold">{t(updateMode ? "현재 현금 수정" : "현재 현금 입력")}</h2>
      <p id={descriptionId} className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("현금까지 보고 싶을 때만 현재 금액을 입력하세요. 매매 기록과 손익은 현금 추적 없이도 계산됩니다.")}</p>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</p>}
      <label className="mt-5 block text-sm font-medium">{t("계좌")}
        <select ref={updateMode ? undefined : firstField as React.RefObject<HTMLSelectElement>} required disabled={updateMode || saving} className="mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 disabled:opacity-70" value={accountId} onChange={(event) => { const next = event.target.value; setAccountId(next); const account = active.find((item) => item.id === next); if (account) setCurrency(account.baseCurrency); }}>
          <option value="">{t("계좌 추가 필요")}</option>
          {active.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
        </select>
      </label>
      <label className="mt-4 block text-sm font-medium">{t("통화")}
        <select required disabled={updateMode || saving} className="mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 disabled:opacity-70" value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}>{currencies.map((item) => <option key={item}>{item}</option>)}</select>
      </label>
      <label className="mt-4 block text-sm font-medium">{t("현재 현금")}
        <input ref={updateMode ? firstField as React.RefObject<HTMLInputElement> : undefined} required inputMode="decimal" autoComplete="off" className="mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3" value={balance} onChange={(event) => setBalance(event.target.value)} placeholder="0" />
      </label>
      <label className="mt-4 block text-sm font-medium">{t("기준 일시")}
        <input required type="datetime-local" step="1" aria-describedby={boundaryId} className="mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
      </label>
      <p id={boundaryId} className="mt-2 text-xs leading-5 text-[var(--muted)]">{t("이 시각까지의 과거 거래는 현재 현금에 다시 반영되지 않습니다. 이후 매매·배당·입출금만 반영됩니다.")}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" disabled={saving} onClick={onClose} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">{t("취소")}</button>
        <button disabled={saving || !active.length} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50">{t(saving ? "저장 중..." : "저장")}</button>
      </div>
    </form>
  </div>;
}
