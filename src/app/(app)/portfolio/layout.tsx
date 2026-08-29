import { PortfolioShell } from "@/features/portfolio-shell/portfolio-shell";

export default function PortfolioLayout({ children }: { children: React.ReactNode }) {
  return <PortfolioShell>{children}</PortfolioShell>;
}
