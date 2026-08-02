"use client";
import { useI18n } from "@/i18n/i18n-provider";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const { t } = useI18n();
  return <main className="grid min-h-screen place-items-center p-6"><div className="text-center"><h1 className="text-xl font-semibold">{t("화면을 불러오지 못했습니다")}</h1><p className="mt-2 text-sm text-[var(--muted)]">{t("잠시 후 다시 시도해 주세요.")}</p><button className="mt-5 rounded-lg bg-[var(--accent)] px-4 py-2 text-white" onClick={reset}>{t("다시 시도")}</button></div></main>;
}
