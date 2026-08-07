import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/i18n/i18n-provider";

export const metadata: Metadata = {
  title: { default: "Rationale", template: "%s · Rationale" },
  description: "투자 아이디어부터 회고까지 연결하는 개인 투자 의사결정 도구",
};

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className={`${geist.variable} ${bricolage.variable}`}><ThemeProvider><I18nProvider>{children}</I18nProvider></ThemeProvider></body>
    </html>
  );
}
