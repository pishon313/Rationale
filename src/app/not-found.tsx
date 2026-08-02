"use client";
import Link from "next/link";
import { useI18n } from "@/i18n/i18n-provider";

export default function NotFound() {
  const { t } = useI18n();
  return <main className="grid min-h-screen place-items-center p-6"><div className="text-center"><p className="text-sm text-[var(--muted)]">404</p><h1 className="mt-2 text-2xl font-semibold">{t("페이지를 찾을 수 없습니다")}</h1><Link className="mt-5 inline-block text-[var(--accent)] underline" href="/dashboard">{t("대시보드로 돌아가기")}</Link></div></main>;
}
