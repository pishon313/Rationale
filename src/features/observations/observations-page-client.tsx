"use client";
/* eslint-disable @next/next/no-img-element */

import { Calendar, Pencil, Plus, Tag, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ImageAttachments } from "@/components/image-attachments";
import type { Stock } from "@/features/stocks/types";
import { useI18n } from "@/i18n/i18n-provider";
import { localDateTimeValue } from "@/lib/local-date";
import { useLocalCollection } from "@/lib/use-local-collection";
import type { Observation } from "./types";

const stockViews: Observation["stockView"][] = ["강세", "중립", "약세", "판단 보류"];

export function ObservationsPageClient() {
  const { formatDate, t } = useI18n();
  const store = useLocalCollection<Observation>("observations", []);
  const stocks = useLocalCollection<Stock>("stocks", []);
  const [editing, setEditing] = useState<Observation | "new" | null>(null);
  const [stockFilter, setStockFilter] = useState("전체");
  const items = useMemo(
    () => [...store.items]
      .filter((item) => stockFilter === "전체" || item.stockId === stockFilter)
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt)),
    [store.items, stockFilter],
  );
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
    <div className="mt-5 flex items-center gap-2">
      <label className="text-sm text-[var(--muted)]">{t("종목")}</label>
      <select
        aria-label={t("관찰 종목 필터")}
        value={stockFilter}
        onChange={(event) => setStockFilter(event.target.value)}
        className="h-9 rounded-lg border bg-[var(--surface)] px-3 text-sm"
      >
        <option value="전체">{t("전체")}</option>
        {stocks.items.map((stock) => <option key={stock.id} value={stock.id}>{stock.name}</option>)}
      </select>
    </div>
    <section className="relative mt-6 space-y-4 before:absolute before:bottom-4 before:left-[19px] before:top-4 before:w-px before:bg-[var(--border)]">
      {items.map((item) => <article key={item.id} className="relative pl-12">
        <span className="absolute left-3 top-5 size-3 rounded-full border-2 border-[var(--surface)] bg-[var(--accent)] ring-1 ring-[var(--border)]" />
        <div className="rounded-xl border bg-[var(--surface)] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-[var(--accent)]">{item.stockName}</span>
                <span className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs">{t(item.stockView)}</span>
              </div>
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
      {!items.length && <div className="rounded-xl border bg-[var(--surface)] p-12 text-center text-sm text-[var(--muted)]">{t("아직 관찰 기록이 없습니다.")}</div>}
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

export function ObservationForm({ value, stocks, initialStockId, onCancel, onSave }: { value?: Observation; stocks: Stock[]; initialStockId?: string; onCancel: () => void; onSave: (value: Observation) => void }) {
  const { t } = useI18n();
  const initialStock = stocks.find((stock) => stock.id === initialStockId) ?? stocks[0];
  const [form, setForm] = useState(() => value ?? ({ stockId: initialStock?.id ?? "", observedAt: localDateTimeValue(), title: "", content: "", marketCondition: "", stockView: "판단 보류", tags: [], attachmentUrls: [] } as unknown as Observation));
  const [tags, setTags] = useState(value?.tags.join(", ") ?? "");
  const set = (key: keyof Observation, next: unknown) => setForm((old) => ({ ...old, [key]: next }));
  const input = "mt-1 h-10 w-full rounded-lg border bg-[var(--surface)] px-3 text-sm";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const stock = stocks.find((item) => item.id === form.stockId);
    if (!stock) return;
    const now = new Date().toISOString();
    onSave({ ...form, id: value?.id ?? crypto.randomUUID(), stockName: stock.name, tags: splitTags(tags), attachmentUrls: form.attachmentUrls ?? [], createdAt: value?.createdAt ?? now, updatedAt: now, deletedAt: null });
  }

  return <div className="fixed inset-0 z-50 flex justify-end bg-black/35">
    <form className="h-full w-full max-w-xl overflow-y-auto bg-[var(--surface)]" onSubmit={submit}>
      <ModalHeader title={t(value ? "관찰 기록 수정" : "새 관찰 기록")} close={onCancel} />
      <div className="space-y-5 p-5">
        <Field label={t("종목")}>
          <select required className={input} value={form.stockId} onChange={(event) => set("stockId", event.target.value)}>
            <option value="">{t("종목 선택")}</option>
            {stocks.map((stock) => <option key={stock.id} value={stock.id}>{stock.name}</option>)}
          </select>
        </Field>
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
          <Field label={t("현재 판단")}>
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
