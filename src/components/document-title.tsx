"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/i18n/i18n-provider";

const routeTitles: Record<string, string> = {
  dashboard: "대시보드",
  portfolio: "포트폴리오",
  stocks: "종목",
  plans: "매수 계획",
  trades: "매매",
  observations: "관찰 기록",
  reviews: "회고",
  analytics: "분석",
  rules: "투자 원칙",
  notes: "Note",
  settings: "설정",
};

export function DocumentTitle() {
  const pathname = usePathname();
  const { locale, ready, t } = useI18n();
  const route = pathname.split("/").filter(Boolean)[0] ?? "";
  const title = routeTitles[route];

  useEffect(() => {
    if (!ready) return;
    const nextTitle = title ? `${t(title)} · Rationale` : "Rationale";
    const update = () => { document.title = nextTitle; };
    update();
    // Next.js may stream static metadata after hydration. Keep the title tied
    // to the restored client-side locale if the head is updated afterward.
    const observer = new MutationObserver(() => {
      if (document.title !== nextTitle) update();
    });
    observer.observe(document.head, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }, [locale, ready, t, title]);

  return null;
}
