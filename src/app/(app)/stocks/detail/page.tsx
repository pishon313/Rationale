"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { StockDetailClient } from "@/features/stocks/stock-detail-client";
import { useI18n } from "@/i18n/i18n-provider";

function Detail() { const params = useSearchParams(); return <StockDetailClient stockId={params.get("id") ?? ""} />; }
export default function StockDetailPage() { const { t } = useI18n(); return <main className="p-4 md:p-7"><div className="mx-auto max-w-7xl"><Suspense fallback={<div className="p-10 text-center">{t("종목을 불러오는 중...")}</div>}><Detail /></Suspense></div></main>; }
