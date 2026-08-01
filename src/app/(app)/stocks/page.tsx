import { StocksPageClient } from "@/features/stocks/stocks-page-client";

export const metadata = { title: "종목" };
export default function StocksPage() { return <main className="p-4 md:p-7"><div className="mx-auto max-w-[1500px]"><StocksPageClient /></div></main>; }
