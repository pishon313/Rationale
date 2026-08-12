"use client";
/* eslint-disable @next/next/no-img-element */

import { Calendar, Globe2, Pencil, Plus, Tag, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ImageAttachments } from "@/components/image-attachments";
import type { Stock } from "@/features/stocks/types";
import { useI18n } from "@/i18n/i18n-provider";
import { localDateTimeValue } from "@/lib/local-date";
import { useLocalCollection } from "@/lib/use-local-collection";
import { filterObservations, marketTargetLabels, marketTargets, normalizeObservation, type MarketTarget, type Observation, type ObservationScope } from "./types";

const stockViews: Observation["stockView"][] = ["강세", "중립", "약세", "판단 보류"];

export function ObservationsPageClient() {
  const { formatDate, t } = useI18n();
  const store = useLocalCollection<Observation>("observations", []);
  const stocks = useLocalCollection<Stock>("stocks", []);
  const [editing, setEditing] = useState<Observation | "new" | null>(null);
  const [scopeFilter, setScopeFilter] = useState<"all" | ObservationScope>("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [targetFilter, setTargetFilter] = useState("all");
  const items = useMemo(() => filterObservations(store.items, scopeFilter, targetFilter, stockFilter), [scopeFilter, stockFilter, store.items, targetFilter]);
  const formatObservedAt = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : formatDate(date, { dateStyle: "medium", timeStyle: "short" });
  };

  return <>
    <Header
      title={t("관찰 기록")}
      subtitle={t("시장과 종목의 변화를 시간순으로 기록")}
      action={() => setEditing("new")}
    />
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <div className="flex rounded-lg bg-[var(--surface-muted)] p-1" aria-label={t("관찰 대상 필터")}>{(["all", "market", "stock"] as const).map((scope) => <button key={scope} type="button" aria-pressed={scopeFilter === scope} onClick={() => setScopeFilter(scope)} className={`rounded-md px-3 py-1.5 text-sm ${scopeFilter === scope ? "bg-[var(--surface)] font-medium text-[var(--accent)] shadow-sm" : "text-[var(--muted)]"}`}>{t(scope === "all" ? "전체" : scope === "market" ? "시장" : "종목")}</button>)}</div>
      {scopeFilter === "stock" && <><label className="text-sm text-[var(--muted)]">{t("종목")}</label>
      <select
        aria-label={t("관찰 종목 필터")}
        value={stockFilter}
        onChange={(event) => setStockFilter(event.target.value)}
        className="h-9 rounded-lg border bg-[var(--surface)] px-3 text-sm"
      >
        <option value="all">{t("전체 종목")}</option>
        {stocks.items.map((stock) => <option key={stock.id} value={stock.id}>{stock.name}</option>)}
      </select></>}
      {scopeFilter === "market" && <><label className="text-sm text-[var(--muted)]">{t("시장 / 지수")}</label><select aria-label={t("시장 대상 필터")} value={targetFilter} onChange={(event) => setTargetFilter(event.target.value)} className="h-9 rounded-lg border bg-[var(--surface)] px-3 text-sm"><option value="all">{t("전체 시장 대상")}</option>{marketTargets.map((target) => <option key={target} value={target}>{t(marketTargetLabels[target])}</option>)}</select></>}
    </div>
    <section className="relative mt-6 space-y-4 before:absolute before:bottom-4 before:left-[19px] before:top-4 before:w-px before:bg-[var(--border)]">
      {items.map((item) => <article key={item.id} className="relative pl-12">
        <span className="absolute left-3 top-5 size-3 rounded-full border-2 border-[var(--surface)] bg-[var(--accent)] ring-1 ring-[var(--border)]" />
        <div className="rounded-xl border bg-[var(--surface)] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1 text-xs font-medium text-[var(--accent)]">{item.scope === "market" && <Globe2 size={13} />}{item.scope === "market" ? t("시장 관찰") : item.stockName}</span>
                <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs">{t(item.stockView)}</span>
              </div>
              {item.scope === "market" && <p className="mt-1 text-xs text-[var(--muted)]">{item.marketTargets.map((target) => t(marketTargetLabels[target])).join(" · ")}</p>}
              <h2 className="mt-2 font-semibold">{item.title}</h2>
              <p className="mt-1 flex items-center gap-1 text-xs text-[var(--muted)]">
                <Calendar size={13} />
                {formatObservedAt(item.observedAt)} · {item.marketCondition || t("시장 상황 미기록")}
              </p>
            </div>
            <div className="flex">
              <button
                aria-label={t("{title} 수정", { title: item.title })}
                onClick={() => setEditing(item)}
                className="grid size-8 place-items-center"
              >
                <Pencil size={15} />
              </button>
              <button
                aria-label={t("{title} 삭제", { title: item.title })}
                onClick={() => store.remove(item.id)}
                className="grid size-8 place-items-center text-red-600"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-7">{item.content}</p>
          {item.attachmentUrls.length > 0 && <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {item.attachmentUrls.map((source, index) => <button
              key={`${item.id}-${index}`}
              type="button"
              onClick={() => window.open(source, "_blank")}
              className="aspect-video overflow-hidden rounded-lg border"
            >
              <img
                src={source}
                alt={t("{title} 첨부 {index}", { title: item.title, index: index + 1 })}
                className="size-full object-cover"
              />
            </button>)}
          </div>}
          <div className="mt-4 flex flex-wrap gap-2">
            {item.tags.map((tag) => <span key={tag} className="flex items-center gap-1 rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs"><Tag size={11} />{tag}</span>)}
          </div>
        </div>
      </article>)}
      {!items.length && <div className="rounded-xl border bg-[var(--surface)] p-12 text-center text-sm text-[var(--muted)]">{t(emptyMessage(scopeFilter, stockFilter, targetFilter))}</div>}
    </section>
    {editing && <ObservationForm
      stocks={stocks.items}
      value={editing === "new" ? undefined : editing}
      onCancel={() => setEditing(null)}
      onSave={(next) => {
        if (editing === "new") store.add(next);
        else store.update(next);
        setEditing(null);
      }}
    />}
  </>;
}

export function ObservationForm({ value, stocks, initialStockId, lockScope = false, onCancel, onSave }: { value?: Observation; stocks: Stock[]; initialStockId?: string; lockScope?: boolean; onCancel: () => void; onSave: (value: Observation) => void }) {
  const { t } = useI18n();
  const initialStock = stocks.find((stock) => stock.id === initialStockId) ?? stocks[0];
  const [form, setForm] = useState(() => value ? normalizeObservation(value) : normalizeObservation({ id: "", scope: "stock", stockId: initialStock?.id ?? "", stockName: initialStock?.name ?? "", marketTargets: [], observedAt: localDateTimeValue(), title: "", content: "", marketCondition: "", stockView: "판단 보류", tags: [], attachmentUrls: [], createdAt: "", updatedAt: "", deletedAt: null }));
  const [tags, setTags] = useState(value?.tags.join(", ") ?? "");
  const set = (key: keyof Observation, next: unknown) => setForm((old) => ({ ...old, [key]: next }));
  const input = "mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const stock = form.scope === "stock" ? stocks.find((item) => item.id === form.stockId) : null;
    if (form.scope === "stock" && !stock || form.scope === "market" && form.marketTargets.length === 0) return;
    const now = new Date().toISOString();
    onSave({ ...form, id: value?.id ?? crypto.randomUUID(), stockId: stock?.id ?? null, stockName: stock?.name ?? "", marketTargets: form.scope === "market" ? form.marketTargets : [], tags: splitTags(tags), attachmentUrls: form.attachmentUrls ?? [], createdAt: value?.createdAt ?? now, updatedAt: now, deletedAt: null });
  }

  function changeScope(scope: ObservationScope) { setForm((current) => ({ ...current, scope, stockId: scope === "stock" ? initialStock?.id ?? "" : null, stockName: scope === "stock" ? initialStock?.name ?? "" : "", marketTargets: [] })); }
  function toggleTarget(target: MarketTarget) { setForm((current) => ({ ...current, marketTargets: current.marketTargets.includes(target) ? current.marketTargets.filter((item) => item !== target) : [...current.marketTargets, target] })); }

  return <div className="fixed inset-0 z-50 flex justify-end bg-black/35">
    <form className="h-full w-full max-w-xl overflow-y-auto bg-[var(--surface)]" onSubmit={submit}>
      <ModalHeader title={t(value ? "관찰 기록 수정" : "새 관찰 기록")} close={onCancel} />
      <div className="space-y-5 p-5">
        {!lockScope && <Field label={t("관찰 대상")}><div className="mt-2 grid grid-cols-2 rounded-lg bg-[var(--surface-muted)] p-1">{(["market", "stock"] as const).map((scope) => { const label = t(scope === "market" ? "시장" : "종목"); return <button key={scope} type="button" aria-label={label} aria-pressed={form.scope === scope} onClick={() => changeScope(scope)} className={`rounded-md px-3 py-2 text-sm ${form.scope === scope ? "bg-[var(--surface)] font-medium text-[var(--accent)] shadow-sm" : "text-[var(--muted)]"}`}>{label}</button>; })}</div></Field>}
        {form.scope === "stock" ? <Field label={t("종목")}>
          <select required className={input} value={form.stockId ?? ""} onChange={(event) => set("stockId", event.target.value)}>
            <option value="">{t("종목 선택")}</option>
            {stocks.map((stock) => <option key={stock.id} value={stock.id}>{stock.name}</option>)}
          </select>
        </Field> : <Field label={t("시장 / 지수")}><div className="mt-2 flex flex-wrap gap-2">{marketTargets.map((target) => { const label = t(marketTargetLabels[target]); return <button key={target} type="button" aria-label={label} aria-pressed={form.marketTargets.includes(target)} onClick={() => toggleTarget(target)} className={`rounded-full border px-3 py-2 text-sm ${form.marketTargets.includes(target) ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "text-[var(--muted)]"}`}>{form.marketTargets.includes(target) ? "✓ " : ""}{label}</button>; })}</div>{form.marketTargets.length === 0 && <p className="mt-2 text-xs text-[var(--muted)]">{t("시장 또는 지수를 하나 이상 선택해 주세요.")}</p>}</Field>}
        <Field label={t("관찰 시각")}>
          <input required type="datetime-local" className={input} value={form.observedAt} onChange={(event) => set("observedAt", event.target.value)} />
        </Field>
        <Field label={t("제목")}>
          <input required className={input} value={form.title} onChange={(event) => set("title", event.target.value)} />
        </Field>
        <Field label={t("내용")}>
          <textarea required className="mt-1 min-h-40 w-full rounded-lg border p-3 text-sm leading-6" value={form.content} onChange={(event) => set("content", event.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("시장 상황")}>
            <input className={input} value={form.marketCondition} onChange={(event) => set("marketCondition", event.target.value)} />
          </Field>
          <Field label={t(form.scope === "market" ? "시장 판단" : "현재 판단")}>
            <select className={input} value={form.stockView} onChange={(event) => set("stockView", event.target.value)}>
              {stockViews.map((item) => <option key={item} value={item}>{t(item)}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t("태그")}>
          <input className={input} value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t("쉼표로 구분")} />
        </Field>
        <Field label={t("이미지 첨부")}>
          <ImageAttachments values={form.attachmentUrls ?? []} onChange={(next) => set("attachmentUrls", next)} />
        </Field>
      </div>
      <ModalActions cancel={onCancel} />
    </form>
  </div>;
}

export function Header({ title, subtitle, action }: { title: string; subtitle: string; action: () => void }) {
  const { t } = useI18n();
  return <div className="flex items-end justify-between gap-4">
    <div><p className="text-sm text-[var(--muted)]">{subtitle}</p><h1 className="mt-1 text-2xl font-semibold">{title}</h1></div>
    <button onClick={action} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm text-white"><Plus size={17} />{t("새 기록")}</button>
  </div>;
}

export function ModalHeader({ title, close }: { title: string; close: () => void }) {
  const { t } = useI18n();
  return <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-[var(--surface)] p-5">
    <h2 className="text-lg font-semibold">{title}</h2>
    <button type="button" onClick={close} aria-label={t("닫기")}><X size={20} /></button>
  </div>;
}

export function ModalActions({ cancel }: { cancel: () => void }) {
  const { t } = useI18n();
  return <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-[var(--surface)] p-4">
    <button type="button" onClick={cancel} className="rounded-lg border px-4 py-2 text-sm">{t("취소")}</button>
    <button className="rounded-lg bg-[var(--accent)] px-5 py-2 text-sm text-white">{t("저장")}</button>
  </div>;
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-sm font-medium">{label}{children}</label>;
}

function splitTags(value: string) {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function emptyMessage(scope: "all" | ObservationScope, stockFilter: string, targetFilter: string) {
  if (scope === "all") return "아직 관찰 기록이 없습니다.";
  if (scope === "market") return targetFilter === "all" ? "아직 시장 관찰 기록이 없습니다." : "조건에 맞는 관찰 기록이 없습니다.";
  return stockFilter === "all" ? "아직 종목 관찰 기록이 없습니다." : "조건에 맞는 관찰 기록이 없습니다.";
}
