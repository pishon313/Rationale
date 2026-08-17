"use client";

import { Copy, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { currencies, type Currency } from "@/domain/currency";
import { markets } from "@/features/stocks/types";
import { useI18n } from "@/i18n/i18n-provider";
import {
  accountFeeRoundingModes,
  accountFeeRuleSides,
  calculateAccountFee,
  createDefaultAccountFeeRule,
  maximumAccountFeeRules,
  validateAccountFeePolicy,
  type AccountFeePolicyV1,
  type AccountFeeRuleV1,
} from "./account-fee-policy";

type EditorMode = "add" | "edit" | "duplicate";
type RuleEditor = { mode: EditorMode; originalId: string | null; draft: AccountFeeRuleV1 };

export function AccountFeePolicyEditor({ value, baseCurrency, onChange }: { value?: AccountFeePolicyV1 | null; baseCurrency: Currency; onChange: (policy: AccountFeePolicyV1 | null) => void }) {
  const { t } = useI18n();
  const [editor, setEditor] = useState<RuleEditor | null>(null);
  const [deleting, setDeleting] = useState<AccountFeeRuleV1 | null>(null);
  const [error, setError] = useState("");
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  const policy = value ?? { version: 1 as const, enabled: false, rules: [] };

  function openEditor(mode: EditorMode, rule: AccountFeeRuleV1 | null, opener: HTMLElement) {
    const id = crypto.randomUUID();
    const draft = rule ? { ...rule, id: mode === "duplicate" ? id : rule.id, name: mode === "duplicate" ? `${rule.name} ${t("복사본")}` : rule.name } : createDefaultAccountFeeRule(baseCurrency, localToday(), id, t("기본 수수료"));
    setReturnFocus(opener); setError(""); setEditor({ mode, originalId: mode === "edit" ? rule?.id ?? null : null, draft });
  }
  function closeEditor() { setEditor(null); setError(""); focusLater(returnFocus); }
  function saveRule(draft: AccountFeeRuleV1) {
    const rules = editor?.originalId ? policy.rules.map((rule) => rule.id === editor.originalId ? draft : rule) : [...policy.rules, draft];
    const result = validateAccountFeePolicy({ version: 1, enabled: true, rules });
    if (!result.valid) { setError(result.issues[0]?.message ?? t("수수료 규칙을 저장할 수 없습니다.")); return; }
    onChange(result.policy); closeEditor();
  }
  function confirmDelete() {
    if (!deleting) return;
    onChange({ ...policy, rules: policy.rules.filter((rule) => rule.id !== deleting.id) });
    setDeleting(null); focusLater(returnFocus);
  }

  return <section className="rounded-xl border bg-[var(--surface-muted)] p-4" aria-labelledby="fee-policy-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="fee-policy-title" className="font-semibold">{t("계좌 수수료 정책")}</h3><p id="fee-policy-help" className="mt-1 text-xs leading-5 text-[var(--muted)]">{t("앞으로 입력할 거래의 수수료를 계좌별 규칙으로 계산합니다. 기존 거래의 수수료는 변경하지 않습니다.")}</p></div><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" aria-describedby="fee-policy-help" checked={policy.enabled} onChange={(event) => onChange({ version: 1, enabled: event.target.checked, rules: policy.rules })}/>{t("수수료 정책 사용")}</label></div>
    <p className={`mt-3 inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${policy.enabled ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "bg-[var(--surface)] text-[var(--muted)]"}`}>{t(policy.enabled ? "사용 중 · {count}개 규칙" : "사용 안 함", { count: policy.rules.length })}</p>
    {policy.enabled && <><div className="mt-4 space-y-2">{policy.rules.map((rule) => <article key={rule.id} className="rounded-lg border bg-[var(--surface)] p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium">{rule.name}</p><p className="mt-1 text-xs leading-5 text-[var(--muted)]">{ruleSummary(rule, t)}</p></div><div className="flex gap-1"><button type="button" aria-label={t("{name} 수정", { name: rule.name })} onClick={(event) => openEditor("edit", rule, event.currentTarget)} className="rounded-md p-2 hover:bg-[var(--surface-muted)]"><Pencil size={15}/></button><button type="button" disabled={policy.rules.length >= maximumAccountFeeRules} aria-label={t("{name} 복제", { name: rule.name })} onClick={(event) => openEditor("duplicate", rule, event.currentTarget)} className="rounded-md p-2 hover:bg-[var(--surface-muted)] disabled:opacity-40"><Copy size={15}/></button><button type="button" aria-label={t("{name} 삭제", { name: rule.name })} onClick={(event) => { setReturnFocus(event.currentTarget); setDeleting(rule); }} className="destructive-icon-action rounded-md p-2"><Trash2 size={15}/></button></div></div></article>)}{!policy.rules.length && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-[var(--muted)]">{t("등록된 수수료 규칙이 없습니다. 일치하는 규칙이 없으면 수수료는 자동 입력되지 않습니다.")}</p>}</div><button type="button" disabled={policy.rules.length >= maximumAccountFeeRules} onClick={(event) => openEditor("add", null, event.currentTarget)} className="mt-3 inline-flex items-center gap-2 rounded-lg border bg-[var(--surface)] px-3 py-2 text-sm disabled:opacity-40"><Plus size={15}/>{t("수수료 규칙 추가")}</button>{policy.rules.length >= maximumAccountFeeRules && <p className="mt-2 text-xs text-[var(--muted)]">{t("수수료 규칙은 최대 50개까지 저장할 수 있습니다.")}</p>}</>}
    {editor && (
      <FeeRuleDialog editor={editor} error={error} setError={setError} onCancel={closeEditor} onSave={saveRule}/>
    )}
    {deleting && <div className="fixed inset-0 z-[90] grid place-items-center bg-black/55 p-4" role="alertdialog" aria-modal="true" aria-labelledby="fee-rule-delete-title" aria-describedby="fee-rule-delete-description"><section className="w-full max-w-sm rounded-xl bg-[var(--surface)] p-5 shadow-2xl"><h3 id="fee-rule-delete-title" className="text-lg font-semibold">{t("수수료 규칙을 삭제할까요?")}</h3><p id="fee-rule-delete-description" className="mt-2 text-sm leading-6 text-[var(--muted)]">{t("{name} 규칙만 삭제됩니다. 기존 거래에 저장된 수수료는 변경되지 않습니다.", { name: deleting.name })}</p><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => { setDeleting(null); focusLater(returnFocus); }} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button type="button" autoFocus onClick={confirmDelete} className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white">{t("삭제")}</button></div></section></div>}
  </section>;
}

function FeeRuleDialog({ editor, error, setError, onCancel, onSave }: { editor: RuleEditor; error: string; setError: (value: string) => void; onCancel: () => void; onSave: (rule: AccountFeeRuleV1) => void }) {
  const { t } = useI18n(); const [draft, setDraft] = useState(editor.draft); const [previewAmount, setPreviewAmount] = useState("1000");
  const set = <K extends keyof AccountFeeRuleV1>(key: K, value: AccountFeeRuleV1[K]) => { setDraft((current) => ({ ...current, [key]: value })); setError(""); };
  const preview = t(previewFee(draft, previewAmount));
  return createPortal(<div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="fee-rule-editor-title"><section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-xl bg-[var(--surface)] p-5 shadow-2xl"><h3 id="fee-rule-editor-title" className="text-lg font-semibold">{t(editor.mode === "add" ? "수수료 규칙 추가" : editor.mode === "duplicate" ? "수수료 규칙 복제" : "수수료 규칙 수정")}</h3><p className="mt-1 text-sm text-[var(--muted)]">{t("같은 우선순위의 규칙은 날짜와 거래금액 범위가 겹치지 않아야 합니다.")}</p>{error && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">{t(error)}</p>}
    <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <DialogField label={t("규칙 이름")}><input autoFocus required maxLength={60} value={draft.name} onChange={(event) => set("name", event.target.value)}/></DialogField>
      <DialogField label={t("시장")}><select value={draft.market} onChange={(event) => set("market", event.target.value as AccountFeeRuleV1["market"])}><option value="all">{t("전체 시장")}</option>{markets.map((market) => <option key={market} value={market}>{t(market)}</option>)}</select></DialogField>
      <DialogField label={t("통화")}><select value={draft.currency} onChange={(event) => set("currency", event.target.value as Currency)}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></DialogField>
      <DialogField label={t("매수·매도")}><select value={draft.side} onChange={(event) => set("side", event.target.value as AccountFeeRuleV1["side"])}>{accountFeeRuleSides.map((side) => <option key={side} value={side}>{t(side === "buy" ? "매수" : side === "sell" ? "매도" : "매수·매도 모두")}</option>)}</select></DialogField>
      <DialogField label={t("수수료율 (%)")}><input required inputMode="decimal" value={draft.ratePercent} onChange={(event) => set("ratePercent", event.target.value)}/></DialogField>
      <DialogField label={t("고정 수수료")}><input required inputMode="decimal" value={draft.fixedFee} onChange={(event) => set("fixedFee", event.target.value)}/></DialogField>
      <NullableMoneyField label={t("최소 수수료")} value={draft.minimumFee} onChange={(value) => set("minimumFee", value)}/><NullableMoneyField label={t("최대 수수료")} value={draft.maximumFee} onChange={(value) => set("maximumFee", value)}/>
      <NullableMoneyField label={t("거래금액 하한 (포함)")} value={draft.grossAmountFrom} onChange={(value) => set("grossAmountFrom", value)}/><NullableMoneyField label={t("거래금액 상한 (미포함)")} value={draft.grossAmountTo} onChange={(value) => set("grossAmountTo", value)}/>
      <DialogField label={t("적용 시작일")}><input required type="date" value={draft.effectiveFrom} onChange={(event) => set("effectiveFrom", event.target.value)}/></DialogField><DialogField label={t("적용 종료일 (선택)")}><input type="date" value={draft.effectiveTo ?? ""} onChange={(event) => set("effectiveTo", event.target.value || null)}/></DialogField>
      <DialogField label={t("반올림 방식")}><select value={draft.roundingMode} onChange={(event) => set("roundingMode", event.target.value as AccountFeeRuleV1["roundingMode"])}>{accountFeeRoundingModes.map((mode) => <option key={mode} value={mode}>{t(mode === "floor" ? "내림" : mode === "ceil" ? "올림" : "반올림")}</option>)}</select></DialogField>
      <DialogField label={t("반올림 단위")} help={t("예: KRW 1, USD 0.01")}><input required inputMode="decimal" value={draft.roundingUnit} onChange={(event) => set("roundingUnit", event.target.value)}/></DialogField>
    </div>
    <section className="mt-5 rounded-lg border bg-[var(--surface-muted)] p-4" aria-labelledby="fee-preview-title"><h4 id="fee-preview-title" className="font-medium">{t("수수료 미리보기")}</h4><div className="mt-3 flex flex-wrap items-end gap-3"><label className="text-sm">{t("예상 거래금액")}<input aria-describedby="fee-preview-description" inputMode="decimal" value={previewAmount} onChange={(event) => setPreviewAmount(event.target.value)} className="mt-1 block h-10 w-44 rounded-lg border bg-[var(--surface)] px-3"/></label><p id="fee-preview-description" className="pb-2 text-sm" aria-live="polite">{preview}</p></div><p className="mt-2 text-xs text-[var(--muted)]">{t("미리보기 값은 저장되지 않으며 실제 거래에 영향을 주지 않습니다.")}</p></section>
    <div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onCancel} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button type="button" onClick={() => onSave(draft)} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white">{t("규칙 저장")}</button></div></section></div>, document.body);
}

function previewFee(rule: AccountFeeRuleV1, grossAmount: string) {
  const validation = validateAccountFeePolicy({ version: 1, enabled: true, rules: [rule] });
  if (!validation.valid) return validation.issues[0]?.message ?? "—";
  const result = calculateAccountFee(validation.policy, { accountId: "preview", market: rule.market === "all" ? "한국" : rule.market, currency: rule.currency, side: rule.side === "sell" ? "sell" : "buy", tradedAt: rule.effectiveFrom, grossAmount });
  return result.status === "matched" ? `${result.fee} ${rule.currency}` : result.status === "invalid-input" ? "거래금액을 확인해 주세요." : "적용되는 규칙이 없습니다.";
}

function ruleSummary(rule: AccountFeeRuleV1, t: (key: string, params?: Record<string, string | number>) => string) {
  const scope = `${rule.market === "all" ? t("전체 시장") : t(rule.market)} · ${rule.currency} · ${t(rule.side === "buy" ? "매수" : rule.side === "sell" ? "매도" : "매수·매도 모두")}`;
  const fee = t("{rate}% + {fixed}", { rate: rule.ratePercent, fixed: rule.fixedFee });
  const dates = `${rule.effectiveFrom} ~ ${rule.effectiveTo ?? t("계속")}`;
  return `${scope} · ${fee} · ${dates}`;
}
function NullableMoneyField({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) { return <DialogField label={label}><input inputMode="decimal" placeholder="—" value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}/></DialogField>; }
function DialogField({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) { return <label className="text-sm font-medium">{label}<span className="mt-1 block [&>*]:h-10 [&>*]:w-full [&>*]:rounded-lg [&>*]:border [&>*]:bg-[var(--surface)] [&>*]:px-3">{children}</span>{help && <span className="mt-1 block text-xs font-normal text-[var(--muted)]">{help}</span>}</label>; }
function localToday() { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10); }
function focusLater(element: HTMLElement | null) { if (element) window.setTimeout(() => element.focus(), 0); }
