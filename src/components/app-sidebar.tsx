"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, ChevronUp, ClipboardCheck, Eye, FileText, Gauge, Lightbulb, ListChecks, MoreHorizontal, Settings, Tags, WalletCards, Landmark } from "lucide-react";
import { useI18n } from "@/i18n/i18n-provider";

const nav = [
  ["대시보드", "/dashboard", Gauge], ["종목", "/stocks", Tags], ["매수 계획", "/plans", Lightbulb],
  ["관찰 기록", "/observations", Eye], ["회고", "/reviews", BookOpen],
  ["분석", "/analytics", BarChart3], ["투자 원칙", "/rules", ClipboardCheck], ["Note", "/notes", FileText], ["설정", "/settings", Settings],
  ["매매", "/trades", WalletCards], ["계좌", "/accounts", Landmark],
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const { t } = useI18n();
  const isActive = (href: string) => pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));
  const primary = nav.slice(0, 4);
  const secondary = nav.slice(4);
  return <>
    <aside className="app-sidebar">
      <Link href="/dashboard" className="app-brand" aria-label={t("대시보드")}>
        <span className="app-brand-mark" aria-hidden="true"><span /></span>
        <span><b>Rationale</b><small>{t("투자 의사결정 노트")}</small></span>
      </Link>
      <nav aria-label={t("주요 메뉴")} className="app-nav">
        {nav.map(([label, href, Icon]) => <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined} className="app-nav-link"><Icon size={18} strokeWidth={1.8} /><span>{t(label)}</span></Link>)}
      </nav>
      <div className="app-local-note"><ListChecks size={17} /><p>{t("로그인 없는 개인용 로컬 앱")}<br />{t("모든 기록은 이 Mac에 저장됩니다.")}</p></div>
    </aside>
    <nav aria-label={t("모바일 주요 메뉴")} className="mobile-nav">
      {primary.map(([label, href, Icon]) => <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined} className="mobile-nav-link"><Icon size={19} /><span>{t(label)}</span></Link>)}
      <details className="mobile-more"><summary className="mobile-nav-link"><MoreHorizontal size={19} /><span>{t("더보기")}</span><ChevronUp className="mobile-more-chevron" size={12} /></summary><div className="mobile-more-menu">{secondary.map(([label, href, Icon]) => <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined}><Icon size={17} /><span>{t(label)}</span></Link>)}</div></details>
    </nav>
  </>;
}
