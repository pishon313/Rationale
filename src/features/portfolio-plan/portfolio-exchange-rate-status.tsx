"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { ExchangeRateSnapshot } from "@/domain/currency";
import { useI18n } from "@/i18n/i18n-provider";

export function PortfolioExchangeRateStatus({ snapshot, refreshing, onlineError, onRefresh }: {
  snapshot: Pick<ExchangeRateSnapshot, "source" | "rateDate" | "fetchedAt">;
  refreshing: boolean;
  onlineError: string;
  onRefresh: () => void;
}) {
  const { t, formatDate } = useI18n();
  const [checkedAt, setCheckedAt] = useState(0);
  useEffect(() => {
    const update = () => setCheckedAt(Date.now());
    const initialTimer = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 60_000);
    return () => { window.clearTimeout(initialTimer); window.clearInterval(interval); };
  }, []);
  const fetchedAt = snapshot.fetchedAt ? Date.parse(snapshot.fetchedAt) : Number.NaN;
  const stale = !Number.isFinite(fetchedAt) || checkedAt > 0 && checkedAt - fetchedAt > 24 * 60 * 60 * 1000;
  const fallback = snapshot.source !== "frankfurter";
  const date = snapshot.rateDate ?? snapshot.fetchedAt;
  const label = refreshing ? t("환율 업데이트 중입니다.")
    : fallback ? t("기본 환율을 사용 중입니다. 온라인 환율을 확인해 주세요.")
      : stale ? t("마지막 저장 환율을 사용 중입니다. 기준일 {date}", { date: date ? formatDate(date, { dateStyle: "medium" }) : "—" })
        : t("환율 기준일 {date}", { date: date ? formatDate(date, { dateStyle: "medium" }) : "—" });
  return <section className={`portfolio-rate-status ${fallback || stale || onlineError ? "is-warning" : ""}`} aria-label={t("환율 상태")}>
    <p>{onlineError ? t(onlineError) : label}</p>
    <button type="button" onClick={onRefresh} disabled={refreshing}><RefreshCw size={14} aria-hidden="true" className={refreshing ? "animate-spin" : ""} />{t("환율 새로고침")}</button>
  </section>;
}
