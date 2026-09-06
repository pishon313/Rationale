"use client";

import { AlertCircle, FolderOpen, LoaderCircle, MousePointer2, RotateCcw } from "lucide-react";
import { useI18n } from "@/i18n/i18n-provider";

export function PortfolioLoadingState() {
  const { t } = useI18n();
  return <section className="portfolio-shell-state" aria-live="polite" aria-busy="true"><LoaderCircle className="animate-spin" size={22} aria-hidden="true" /><div><h1>{t("포트폴리오 정보를 불러오는 중입니다.")}</h1><p>{t("선택한 포트폴리오의 공통 정보를 준비하고 있습니다.")}</p></div></section>;
}

export function PortfolioErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return <section className="portfolio-shell-state is-error" role="alert"><AlertCircle size={22} aria-hidden="true" /><div><h1>{t("포트폴리오 정보를 불러오지 못했습니다.")}</h1><p>{t("저장된 기록을 확인한 뒤 다시 시도해 주세요.")}</p><button type="button" onClick={onRetry}><RotateCcw size={15} aria-hidden="true" />{t("다시 시도")}</button></div></section>;
}

export function PortfolioNoSelectionState() {
  const { t } = useI18n();
  return <section className="portfolio-shell-state" role="status"><MousePointer2 size={22} aria-hidden="true" /><div><h1>{t("선택된 포트폴리오가 없습니다.")}</h1><p>{t("포트폴리오를 선택하면 관련 기록을 확인할 수 있습니다.")}</p></div></section>;
}

export function PortfolioEmptyState() {
  const { t } = useI18n();
  return <aside className="portfolio-shell-empty" role="status"><FolderOpen size={18} aria-hidden="true" /><div><b>{t("아직 포트폴리오 기록이 없습니다.")}</b><p>{t("종목이나 매매 기록을 추가하면 이 포트폴리오에 반영됩니다.")}</p></div></aside>;
}
