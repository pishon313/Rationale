"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, ClipboardCheck, Eye, FileText, Gauge, Lightbulb, ListChecks, Settings, Tags, WalletCards } from "lucide-react";

const nav = [
  ["대시보드", "/dashboard", Gauge], ["종목", "/stocks", Tags], ["매수 계획", "/plans", Lightbulb],
  ["매매", "/trades", WalletCards], ["관찰 기록", "/observations", Eye], ["회고", "/reviews", BookOpen],
  ["분석", "/analytics", BarChart3], ["투자 원칙", "/rules", ClipboardCheck], ["Note", "/notes", FileText], ["설정", "/settings", Settings],
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  return <aside className="hidden w-60 shrink-0 border-r bg-[var(--surface)] md:flex md:flex-col"><div className="flex h-16 items-center gap-3 border-b px-5"><div className="grid size-9 place-items-center rounded-xl bg-[var(--accent)] text-sm font-bold text-white">TJ</div><div><p className="font-semibold">TradeJournal</p><p className="text-xs text-[var(--muted)]">투자 의사결정 노트</p></div></div><nav aria-label="주요 메뉴" className="space-y-1 p-3">{nav.map(([label, href, Icon]) => { const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`)); return <Link key={href} href={href} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${active ? "bg-[var(--accent-soft)] font-medium text-[var(--accent)]" : "text-[var(--muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)]"}`}><Icon size={18} />{label}</Link>; })}</nav><div className="mt-auto border-t p-4 text-xs leading-5 text-[var(--muted)]"><ListChecks className="mb-2" size={17} />로그인 없는 개인용 로컬 앱<br />모든 기록은 이 Mac에 저장됩니다.</div></aside>;
}
