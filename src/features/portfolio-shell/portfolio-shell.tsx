"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { fallbackCurrencyPreference, type CurrencyPreference } from "@/domain/currency";
import type { InvestmentAccount } from "@/features/accounts/types";
import type { Stock } from "@/features/stocks/types";
import type { Trade } from "@/features/trades/types";
import { useI18n } from "@/i18n/i18n-provider";
import { useLocalCollection } from "@/lib/use-local-collection";
import { PortfolioEmptyState, PortfolioErrorState, PortfolioLoadingState, PortfolioNoSelectionState } from "./portfolio-shell-states";
import { portfolioRouteForPath, portfolioRoutes } from "./routes";
import { defaultPortfolioId, type PortfolioIdentity, type PortfolioShellContextValue, type PortfolioShellSnapshot } from "./types";

const PortfolioShellContext = createContext<PortfolioShellContextValue | null>(null);

export function PortfolioShell({ children, selectedPortfolioId = defaultPortfolioId }: { children: ReactNode; selectedPortfolioId?: typeof defaultPortfolioId | null }) {
  const [generation, setGeneration] = useState(0);
  return <PortfolioShellSession key={generation} selectedPortfolioId={selectedPortfolioId} onRetry={() => setGeneration((value) => value + 1)}>{children}</PortfolioShellSession>;
}

function PortfolioShellSession({ children, selectedPortfolioId, onRetry }: { children: ReactNode; selectedPortfolioId: typeof defaultPortfolioId | null; onRetry: () => void }) {
  const { t, formatDate, formatNumber } = useI18n();
  const accounts = useLocalCollection<InvestmentAccount>("accounts", []);
  const stocks = useLocalCollection<Stock>("stocks", []);
  const trades = useLocalCollection<Trade>("trades", []);
  const preferences = useLocalCollection<CurrencyPreference>("preferences", [fallbackCurrencyPreference]);
  const snapshot = useMemo<PortfolioShellSnapshot>(() => {
    const error = [accounts.loadError, stocks.loadError, trades.loadError, preferences.loadError].find(Boolean);
    if (error) return { status: "error", portfolio: null, asOf: null, isEmpty: false, error };
    if (!accounts.ready || !stocks.ready || !trades.ready || !preferences.ready) return { status: "loading", portfolio: null, asOf: null, isEmpty: false, error: null };
    if (!selectedPortfolioId) return { status: "noSelection", portfolio: null, asOf: null, isEmpty: false, error: null };
    const portfolio: PortfolioIdentity = {
      id: defaultPortfolioId,
      name: t("내 포트폴리오"),
      kind: "personal",
      baseCurrency: preferences.allItems[0]?.displayCurrency ?? fallbackCurrencyPreference.displayCurrency,
    };
    return {
      status: "ready",
      portfolio,
      asOf: latestUpdatedAt([...accounts.allItems, ...stocks.allItems, ...trades.allItems]),
      isEmpty: accounts.allItems.every((account) => account.archivedAt) && stocks.allItems.every((stock) => stock.deletedAt) && trades.allItems.every((trade) => trade.deletedAt),
      error: null,
    };
  }, [accounts.allItems, accounts.loadError, accounts.ready, preferences.allItems, preferences.loadError, preferences.ready, selectedPortfolioId, stocks.allItems, stocks.loadError, stocks.ready, t, trades.allItems, trades.loadError, trades.ready]);
  const value = useMemo<PortfolioShellContextValue>(() => ({
    snapshot,
    formatMoney: (amount, currency = snapshot.portfolio?.baseCurrency ?? fallbackCurrencyPreference.displayCurrency, options) => formatNumber(amount, { ...options, style: "currency", currency }),
    formatPercentage: (ratio, options) => formatNumber(ratio, { ...options, style: "percent", maximumFractionDigits: options?.maximumFractionDigits ?? 2 }),
    formatAsOf: (input, options) => formatDate(input, { dateStyle: "medium", ...options }),
  }), [formatDate, formatNumber, snapshot]);

  return <PortfolioShellContext.Provider value={value}><PortfolioShellFrame snapshot={snapshot} onRetry={onRetry}>{children}</PortfolioShellFrame></PortfolioShellContext.Provider>;
}

function PortfolioShellFrame({ snapshot, onRetry, children }: { snapshot: PortfolioShellSnapshot; onRetry: () => void; children: ReactNode }) {
  const pathname = usePathname();
  const { t, formatDate } = useI18n();
  const currentRoute = portfolioRouteForPath(pathname);
  const portfolio = snapshot.portfolio;
  return <div className="portfolio-shell-root">
    <header className="portfolio-shell-header">
      <div className="portfolio-shell-toolbar">
        <Link href="/portfolio" className="portfolio-shell-brand" aria-label="Rationale"><span className="portfolio-shell-brand-mark" aria-hidden="true"><span /></span><span><b>Rationale</b><small>{t("포트폴리오")}</small></span></Link>
        <label className="portfolio-shell-switcher"><span>{t("포트폴리오 선택")}</span><select aria-label={t("포트폴리오 선택")} value={portfolio?.id ?? ""} disabled={!portfolio} onChange={() => undefined}><option value={portfolio?.id ?? ""}>{portfolio?.name ?? t("포트폴리오")}</option></select></label>
        <dl className="portfolio-shell-metadata">
          <div><dt>{t("유형")}</dt><dd>{portfolio ? t("개인 포트폴리오") : "—"}</dd></div>
          <div><dt>{t("기준 통화")}</dt><dd>{portfolio?.baseCurrency ?? "—"}</dd></div>
          <div><dt>{t("최근 기록")}</dt><dd>{snapshot.asOf ? formatDate(snapshot.asOf, { dateStyle: "medium" }) : t("기록 없음")}</dd></div>
        </dl>
      </div>
      <nav className="portfolio-shell-nav" aria-label={t("포트폴리오 메뉴")}>
        {portfolioRoutes.map(({ id, href, label, icon: Icon }) => <Link key={id} href={href} aria-current={currentRoute?.id === id ? "page" : undefined}><Icon size={18} strokeWidth={1.7} aria-hidden="true" /><span>{t(label)}</span></Link>)}
      </nav>
    </header>
    <div className="portfolio-shell-body">
      {snapshot.status === "loading" && <PortfolioLoadingState />}
      {snapshot.status === "error" && <PortfolioErrorState onRetry={onRetry} />}
      {snapshot.status === "noSelection" && <PortfolioNoSelectionState />}
      {snapshot.status === "ready" && <>{snapshot.isEmpty && <PortfolioEmptyState />}{children}</>}
    </div>
  </div>;
}

export function usePortfolioShell() {
  const value = useContext(PortfolioShellContext);
  if (!value) throw new Error("usePortfolioShell must be used within PortfolioShell");
  return value;
}

function latestUpdatedAt(records: readonly { updatedAt?: string }[]) {
  let latest = Number.NEGATIVE_INFINITY;
  for (const record of records) {
    const timestamp = Date.parse(record.updatedAt ?? "");
    if (Number.isFinite(timestamp) && timestamp > latest) latest = timestamp;
  }
  return Number.isFinite(latest) ? new Date(latest).toISOString() : null;
}
