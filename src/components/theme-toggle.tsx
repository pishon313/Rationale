"use client";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { useI18n } from "@/i18n/i18n-provider";

const emptySubscribe = () => () => undefined;

export function ThemeToggle() {
  const { t } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);
  if (!mounted) return <span className="size-9" />;
  const dark = resolvedTheme === "dark";
  return <button aria-label={t(dark ? "밝은 모드" : "어두운 모드")} className="grid size-9 place-items-center rounded-lg border bg-[var(--surface)]" onClick={() => setTheme(dark ? "light" : "dark")}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button>;
}
