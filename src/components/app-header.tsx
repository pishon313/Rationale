"use client";
import { Search } from "lucide-react";
import { useI18n } from "@/i18n/i18n-provider";
import { ThemeToggle } from "./theme-toggle";

export function AppHeader() {
  const { t } = useI18n();
  return <header className="flex h-16 items-center gap-4 border-b bg-[var(--surface)] px-4 md:px-6"><div className="relative max-w-xl flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={17} /><input aria-label={t("전체 검색")} className="h-10 w-full rounded-lg border bg-[var(--surface-muted)] pl-10 pr-4 text-sm" placeholder={t("종목, 티커, 메모 검색")} /></div><ThemeToggle /><div className="grid size-9 place-items-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent)]">ME</div></header>;
}
