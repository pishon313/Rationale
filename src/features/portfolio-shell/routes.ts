import { ArrowLeftRight, ChartPie, FileText, Layers3, LayoutGrid, Lightbulb, type LucideIcon } from "lucide-react";

export type PortfolioRouteId = "overview" | "allocation" | "holdings" | "activity" | "rationale" | "reports";

export type PortfolioRoute = {
  id: PortfolioRouteId;
  href: string;
  label: string;
  icon: LucideIcon;
  implemented: boolean;
};

export const portfolioRoutes: readonly PortfolioRoute[] = [
  { id: "overview", href: "/portfolio/overview", label: "개요", icon: LayoutGrid, implemented: false },
  { id: "allocation", href: "/portfolio", label: "배분", icon: ChartPie, implemented: true },
  { id: "holdings", href: "/portfolio/holdings", label: "보유 자산", icon: Layers3, implemented: false },
  { id: "activity", href: "/portfolio/activity", label: "활동", icon: ArrowLeftRight, implemented: false },
  { id: "rationale", href: "/portfolio/rationale", label: "투자 근거", icon: Lightbulb, implemented: false },
  { id: "reports", href: "/portfolio/reports", label: "보고서", icon: FileText, implemented: false },
] as const;

export function portfolioRouteForPath(pathname: string) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (normalized === "/portfolio") return portfolioRoutes.find((route) => route.id === "allocation") ?? null;
  return portfolioRoutes.find((route) => route.id !== "allocation" && (normalized === route.href || normalized.startsWith(`${route.href}/`))) ?? null;
}
