"use client";

import { useI18n } from "@/i18n/i18n-provider";
import { portfolioRoutes, type PortfolioRouteId } from "./routes";

export function PortfolioRoutePlaceholder({ routeId }: { routeId: Exclude<PortfolioRouteId, "allocation"> }) {
  const { t } = useI18n();
  const route = portfolioRoutes.find((item) => item.id === routeId);
  if (!route) return null;
  const title = t(route.label);
  return <main className="portfolio-route-page"><section className="portfolio-route-placeholder" aria-labelledby={`portfolio-${route.id}-title`}><p>{t("포트폴리오")}</p><h1 id={`portfolio-${route.id}-title`}>{title}</h1><span>{t("{name} 화면은 다음 단계에서 구현됩니다.", { name: title })}</span></section></main>;
}
