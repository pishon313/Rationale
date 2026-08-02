import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/i18n/i18n-provider";

export const metadata: Metadata = {
  title: { default: "TradeJournal", template: "%s · TradeJournal" },
  description: "투자 아이디어부터 회고까지 연결하는 개인 투자 의사결정 도구",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body><ThemeProvider><I18nProvider>{children}</I18nProvider></ThemeProvider></body>
    </html>
  );
}
