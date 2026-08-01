"use client";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { StockDetailClient } from "@/features/stocks/stock-detail-client";

function Detail() { const params = useSearchParams(); return <StockDetailClient stockId={params.get("id") ?? ""} />; }
export default function StockDetailPage() { return <main className="p-4 md:p-7"><div className="mx-auto max-w-7xl"><Suspense fallback={<div className="p-10 text-center">불러오는 중...</div>}><Detail /></Suspense></div></main>; }
