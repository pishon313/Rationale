import { DashboardPageClient } from "@/features/dashboard/dashboard-page-client";

export const metadata = { title: "대시보드" };
export default function DashboardPage() { return <main className="p-4 md:p-7"><div className="mx-auto max-w-7xl"><DashboardPageClient /></div></main>; }
