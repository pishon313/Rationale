"use client";

import { Merge, Pencil, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useI18n } from "@/i18n/i18n-provider";
import {
  clearPortfolioCategory,
  collectPortfolioCategories,
  mergePortfolioCategory,
  normalizePortfolioCategoryDisplay,
  normalizePortfolioCategoryKey,
  renamePortfolioCategory,
  type PortfolioCategorySummary,
} from "./portfolio-categories";
import type { Stock } from "./types";

type Props = {
  stocks: readonly Stock[];
  onReplace: (stocks: Stock[]) => Promise<void>;
  onClose: () => void;
};

type Editor = { mode: "rename" | "merge"; source: PortfolioCategorySummary } | null;
type Confirmation = { mode: "merge"; source: PortfolioCategorySummary; target: PortfolioCategorySummary } | { mode: "clear"; source: PortfolioCategorySummary } | null;

export function PortfolioCategoryManager({ stocks, onReplace, onClose }: Props) {
  const { t, localeTag, formatNumber } = useI18n();
  const categories = collectPortfolioCategories(stocks, "", localeTag);
  const [editor, setEditor] = useState<Editor>(null);
  const [name, setName] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function beginRename(category: PortfolioCategorySummary) {
    setEditor({ mode: "rename", source: category });
    setName(category.name);
    setTargetKey("");
    setError("");
  }

  function beginMerge(category: PortfolioCategorySummary) {
    setEditor({ mode: "merge", source: category });
    setName("");
    setTargetKey("");
    setError("");
  }

  function requestRename() {
    if (!editor || editor.mode !== "rename") return;
    const display = normalizePortfolioCategoryDisplay(name);
    if (!display) { setError(t("내 분류 이름을 입력해 주세요.")); return; }
    if (display.length > 60) { setError(t("내 분류는 60자 이내로 입력해 주세요.")); return; }
    const target = categories.find((category) => category.key === normalizePortfolioCategoryKey(display));
    if (target && target.key !== editor.source.key) {
      setConfirmation({ mode: "merge", source: editor.source, target });
      return;
    }
    void persist(() => renamePortfolioCategory(stocks, editor.source.key, display, new Date().toISOString()));
  }

  function requestMerge() {
    if (!editor || editor.mode !== "merge") return;
    if (!targetKey) { setError(t("병합할 분류를 선택해 주세요.")); return; }
    if (targetKey === editor.source.key) { setError(t("같은 분류로 병합할 수 없습니다.")); return; }
    const target = categories.find((category) => category.key === targetKey);
    if (!target) { setError(t("병합할 분류를 선택해 주세요.")); return; }
    setConfirmation({ mode: "merge", source: editor.source, target });
  }

  async function persist(build: () => Stock[]) {
    setSaving(true);
    setError("");
    try {
      await onReplace(build());
      setEditor(null);
      setConfirmation(null);
    } catch {
      setError(t("내 분류 변경을 저장하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-[60] grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="portfolio-category-manager-title">
    <section className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border bg-[var(--surface)] shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
        <div><h2 id="portfolio-category-manager-title" className="text-lg font-semibold">{t("내 분류 관리")}</h2><p className="mt-1 text-sm text-[var(--muted)]">{t("사용 중인 내 분류를 정리합니다.")}</p></div>
        <button type="button" aria-label={t("닫기")} disabled={saving} onClick={onClose} className="grid size-9 place-items-center rounded-lg hover:bg-[var(--surface-muted)] disabled:opacity-50"><X size={18} /></button>
      </div>
      <div className="overflow-y-auto p-5">
        {categories.length ? <ul className="space-y-3">{categories.map((category) => <li key={category.key} className="rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-3"><div className="min-w-0 flex-1"><p className="truncate font-medium">{category.name}</p><p className="mt-1 text-xs text-[var(--muted)]">{t("{active}개 활성 종목 · {total}개 전체 종목", { active: formatNumber(category.activeStockCount), total: formatNumber(category.totalStockCount) })}</p></div><div className="flex flex-wrap gap-1"><button type="button" onClick={() => beginRename(category)} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs hover:bg-[var(--surface-muted)]"><Pencil size={14} />{t("이름 변경")}</button><button type="button" disabled={categories.length < 2} onClick={() => beginMerge(category)} className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs hover:bg-[var(--surface-muted)] disabled:opacity-40"><Merge size={14} />{t("병합")}</button><button type="button" onClick={() => { setEditor(null); setError(""); setConfirmation({ mode: "clear", source: category }); }} className="destructive-icon-action inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs"><Trash2 size={14} />{t("분류 해제")}</button></div></div>
          {editor?.source.key === category.key && <div className="mt-4 border-t pt-4">
            {editor.mode === "rename" ? <div className="flex flex-col gap-2 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-sm font-medium">{t("새 분류 이름")}<input autoFocus value={name} maxLength={60} onChange={(event) => setName(event.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm" /></label><button type="button" disabled={saving} onClick={requestRename} className="h-10 rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-white disabled:opacity-50">{t("이름 저장")}</button></div> : <div className="flex flex-col gap-2 sm:flex-row sm:items-end"><label className="min-w-0 flex-1 text-sm font-medium">{t("합칠 대상")}<select value={targetKey} onChange={(event) => setTargetKey(event.target.value)} className="mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm"><option value="">{t("미지정")}</option>{categories.filter((target) => target.key !== category.key).map((target) => <option key={target.key} value={target.key}>{target.name}</option>)}</select></label><button type="button" disabled={saving} onClick={requestMerge} className="h-10 rounded-lg bg-[var(--accent)] px-4 text-sm font-medium text-white disabled:opacity-50">{t("병합 계속")}</button></div>}
          </div>}
        </li>)}</ul> : <p className="py-10 text-center text-sm text-[var(--muted)]">{t("내 분류가 없습니다.")}</p>}
        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-200">{error}</p>}
      </div>
    </section>
    {confirmation && <div className="fixed inset-0 z-[70] grid place-items-center bg-black/55 p-4" role="alertdialog" aria-modal="true" aria-labelledby="portfolio-category-confirmation-title">
      <div className="w-full max-w-md rounded-xl border bg-[var(--surface)] p-5 shadow-2xl">
        <h2 id="portfolio-category-confirmation-title" className="text-lg font-semibold">{t(confirmation.mode === "merge" ? "분류를 병합할까요?" : "분류를 해제할까요?")}</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{confirmation.mode === "merge"
          ? t("{source} 분류의 종목 {count}개를 {target}(으)로 변경합니다.", { source: confirmation.source.name, count: formatNumber(confirmation.source.totalStockCount), target: confirmation.target.name })
          : t("{name} 분류의 종목 {count}개에서 내 분류를 비웁니다. 종목은 삭제되지 않습니다.", { name: confirmation.source.name, count: formatNumber(confirmation.source.totalStockCount) })}</p>
        <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setConfirmation(null)} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button><button type="button" disabled={saving} onClick={() => void persist(() => confirmation.mode === "merge" ? mergePortfolioCategory(stocks, confirmation.source.key, confirmation.target.key, new Date().toISOString()) : clearPortfolioCategory(stocks, confirmation.source.key, new Date().toISOString()))} className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${confirmation.mode === "clear" ? "bg-red-600" : "bg-[var(--accent)]"}`}>{t(confirmation.mode === "merge" ? "분류 병합" : "분류 해제")}</button></div>
      </div>
    </div>}
  </div>;
}
