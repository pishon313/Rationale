"use client";

import { returnRate } from "@/domain/portfolio";
import { useI18n } from "@/i18n/i18n-provider";

export type PortfolioSummaryValues = {
  invested: number;
  marketValue: number;
  cash: number;
  realizedProfit: number;
  unrealizedProfit: number;
  plannedTradeCount: number;
  tradeCount: number;
  plannedTradeRate: number;
};

type PortfolioSummaryProps = PortfolioSummaryValues & {
  display: (value: number) => string;
  priceNote: string;
};

export function calculatePortfolioProfit(values: Pick<PortfolioSummaryValues, "invested" | "realizedProfit" | "unrealizedProfit">) {
  const totalProfit = values.realizedProfit + values.unrealizedProfit;
  return { totalProfit, totalReturnPercent: returnRate(totalProfit, values.invested)?.toNumber() ?? null };
}

export function PortfolioSummary({ invested, marketValue, cash, realizedProfit, unrealizedProfit, plannedTradeCount, tradeCount, plannedTradeRate, display, priceNote }: PortfolioSummaryProps) {
  const { t, formatNumber } = useI18n();
  const { totalProfit, totalReturnPercent } = calculatePortfolioProfit({ invested, realizedProfit, unrealizedProfit });
  const signedAmount = (value: number) => `${value >= 0 ? "+" : ""}${display(value)}`;
  const percent = totalReturnPercent === null ? "—" : formatNumber(totalReturnPercent / 100, { style: "percent", maximumFractionDigits: 1 });
  const plannedPercent = formatNumber(plannedTradeRate / 100, { style: "percent", maximumFractionDigits: 0 });

  return <section aria-label={t("포트폴리오 요약")} className="portfolio-metrics">
    <article className="portfolio-metric-card">
      <p className="portfolio-metric-label">{t("현재 평가금액")}</p>
      <strong className="portfolio-metric-value" title={display(marketValue)}>{display(marketValue)}</strong>
      <dl className="portfolio-metric-details">
        <MetricRow label={t("총 투자 원금")} value={display(invested)} />
        <MetricRow label={t("기록 현금")} value={display(cash)} />
      </dl>
      <small className="portfolio-metric-note">{priceNote}</small>
    </article>

    <article className="portfolio-metric-card">
      <p className="portfolio-metric-label">{t("총 손익")}</p>
      <strong className={`portfolio-metric-value ${profitTone(totalProfit)}`} title={signedAmount(totalProfit)}>{signedAmount(totalProfit)}</strong>
      <p className={`portfolio-metric-return ${profitTone(totalProfit)}`}>{percent}</p>
      <dl className="portfolio-metric-details">
        <MetricRow label={t("실현손익")} value={signedAmount(realizedProfit)} tone={profitTone(realizedProfit)} />
        <MetricRow label={t("미실현손익")} value={signedAmount(unrealizedProfit)} tone={profitTone(unrealizedProfit)} />
      </dl>
    </article>

    <article className="portfolio-metric-card">
      <p className="portfolio-metric-label">{t("계획 매매율")}</p>
      <strong className="portfolio-metric-value" title={plannedPercent}>{plannedPercent}</strong>
      <dl className="portfolio-metric-details portfolio-metric-details-push">
        <MetricRow label={t("계획 매매")} value={t("{count}건", { count: formatNumber(plannedTradeCount) })} />
        <MetricRow label={t("전체 매매")} value={t("{count}건", { count: formatNumber(tradeCount) })} />
      </dl>
    </article>
  </section>;
}

function MetricRow({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <div><dt>{label}</dt><dd className={tone} title={value}>{value}</dd></div>;
}

function profitTone(value: number) {
  if (value > 0) return "is-positive";
  if (value < 0) return "is-negative";
  return "";
}
