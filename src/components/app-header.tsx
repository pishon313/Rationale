"use client";
import { Search, Sparkles } from "lucide-react";
import { useI18n } from "@/i18n/i18n-provider";
import { PersistenceStatus } from "./persistence-status";
import { ThemeToggle } from "./theme-toggle";

export function AppHeader() {
  const { t } = useI18n();
  return <header className="app-header"><div className="app-search"><Search size={16} /><input aria-label={t("전체 검색")} placeholder={t("종목, 티커, 메모 검색")} /><kbd>⌘ K</kbd></div><p className="app-header-rationale">Why did I make this investment?</p><div className="app-header-actions"><span className="app-decision-mode"><Sparkles size={14} />{t("판단 모드")}</span><PersistenceStatus /><ThemeToggle /><div className="app-avatar" aria-label={t("사용자")}>ME</div></div></header>;
}
