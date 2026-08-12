"use client";

import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ModalActions, ModalHeader } from "@/features/observations/observations-page-client";
import { useI18n } from "@/i18n/i18n-provider";
import { useLocalCollection } from "@/lib/use-local-collection";
import type { Note } from "./types";

export function NotesPageClient() {
  const { formatDate, t } = useI18n();
  const notes = useLocalCollection<Note>("notes", []);
  const [editing, setEditing] = useState<Note | "new" | null>(null);
  const items = [...notes.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const formatUpdatedAt = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? t("수정일 미상")
      : t("{date} 수정", { date: formatDate(date, { dateStyle: "medium", timeStyle: "short" }) });
  };

  return <>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-sm text-[var(--muted)]">{t("형식에 얽매이지 않는 개인 메모")}</p>
        <h1 className="mt-1 text-2xl font-semibold">{t("Note")}</h1>
      </div>
      <button type="button" onClick={() => setEditing("new")} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm text-white">
        <Plus size={17} />{t("새 메모")}
      </button>
    </div>
    {items.length ? <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((note) => <article key={note.id} className="flex min-h-56 flex-col rounded-xl border bg-[var(--surface)] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[var(--accent)]"><FileText size={16} /><h2 className="truncate font-semibold">{note.title}</h2></div>
            <p className="mt-1 text-xs text-[var(--muted)]">{formatUpdatedAt(note.updatedAt)}</p>
          </div>
          <div className="flex shrink-0">
            <button
              type="button"
              aria-label={t("{title} 수정", { title: note.title })}
              onClick={() => setEditing(note)}
              className="grid size-8 place-items-center text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              <Pencil size={15} />
            </button>
            <button
              type="button"
              aria-label={t("{title} 삭제", { title: note.title })}
              onClick={() => notes.remove(note.id)}
              className="destructive-icon-action grid size-8 place-items-center rounded-md"
            >
              <Trash2 size={15} />
            </button>
          </div>
        </div>
        <p className="mt-4 line-clamp-6 whitespace-pre-wrap text-sm leading-7 text-[var(--muted)]">{note.content || t("내용이 없는 메모입니다.")}</p>
        <button type="button" onClick={() => setEditing(note)} className="mt-auto pt-4 text-left text-xs text-[var(--accent)]">{t("열어서 편집")}</button>
      </article>)}
    </section> : <section className="mt-6 grid min-h-80 place-items-center rounded-xl border border-dashed bg-[var(--surface)] text-center">
      <div>
        <FileText size={30} className="mx-auto text-[var(--muted)]" />
        <p className="mt-3 font-medium">{t("아직 작성한 메모가 없습니다.")}</p>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("투자 아이디어, 할 일, 생각을 자유롭게 기록해 보세요.")}</p>
      </div>
    </section>}
    {editing && <NoteForm
      value={editing === "new" ? undefined : editing}
      onCancel={() => setEditing(null)}
      onSave={(note) => {
        if (editing === "new") notes.add(note);
        else notes.update(note);
        setEditing(null);
      }}
    />}
  </>;
}

function NoteForm({ value, onCancel, onSave }: { value?: Note; onCancel: () => void; onSave: (note: Note) => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(value?.title ?? "");
  const [content, setContent] = useState(value?.content ?? "");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const now = new Date().toISOString();
    onSave({ id: value?.id ?? crypto.randomUUID(), title: title.trim(), content, createdAt: value?.createdAt ?? now, updatedAt: now, deletedAt: null });
  }

  return <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="dialog" aria-modal="true">
    <form onSubmit={submit} className="flex h-full w-full max-w-2xl flex-col bg-[var(--surface)]">
      <ModalHeader title={t(value ? "메모 수정" : "새 메모")} close={onCancel} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
        <label className="text-sm font-medium">
          {t("제목")}
          <input
            required
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 h-11 w-full rounded-lg border bg-[var(--surface)] px-3 text-base"
            placeholder={t("메모 제목")}
          />
        </label>
        <label className="flex min-h-0 flex-1 flex-col text-sm font-medium">
          {t("내용")}
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            className="mt-1 min-h-80 flex-1 resize-none rounded-lg border bg-[var(--surface)] p-4 text-sm font-normal leading-7"
            placeholder={t("자유롭게 작성하세요.")}
          />
        </label>
      </div>
      <ModalActions cancel={onCancel} />
    </form>
  </div>;
}
