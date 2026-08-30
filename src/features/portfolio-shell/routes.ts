import { ClipboardList, LayoutGrid, type LucideIcon } from "lucide-react";

export type PortfolioRouteId = "overview" | "plan" | "allocation" | "holdings" | "activity" | "rationale" | "reports";

export type PortfolioRoute = {
  id: PortfolioRouteId;
  href: string;
  label: string;
  icon: LucideIcon;
  implemented: boolean;
};

export const portfolioRoutes: readonly PortfolioRoute[] = [
  { id: "overview", href: "/portfolio", label: "개요", icon: LayoutGrid, implemented: true },
  { id: "plan", href: "/portfolio/plan", label: "계획", icon: ClipboardList, implemented: true },
] as const;

export function portfolioRouteForPath(pathname: string) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (normalized === "/portfolio") return portfolioRoutes.find((route) => route.id === "overview") ?? null;
  return portfolioRoutes.find((route) => route.id !== "overview" && (normalized === route.href || normalized.startsWith(`${route.href}/`))) ?? null;
}
