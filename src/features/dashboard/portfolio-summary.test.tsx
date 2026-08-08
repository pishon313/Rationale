import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { calculatePortfolioProfit, PortfolioSummary, type PortfolioSummaryValues } from "./portfolio-summary";

const values: PortfolioSummaryValues = {
  invested: 8_324_740,
  marketValue: 5_469_014,
  cash: 10_000,
  realizedProfit: 0,
  unrealizedProfit: -2_855_726,
  plannedTradeCount: 8,
  tradeCount: 32,
  plannedTradeRate: 25,
};
const display = (value: number) => `${value < 0 ? "-" : ""}₩${Math.abs(value).toLocaleString("en-US")}`;

describe("PortfolioSummary", () => {
  it("세 카드에 포트폴리오 핵심 값과 계획 매매 통계를 표시한다", () => {
    render(<PortfolioSummary {...values} display={display} priceNote="저장된 현재가 · 환율 2026. 8. 7." />);
    const section = screen.getByRole("region", { name: "포트폴리오 요약" });
    expect(within(section).getByText("₩8,324,740")).toBeInTheDocument();
    expect(within(section).getByText("₩5,469,014")).toBeInTheDocument();
    expect(within(section).getByText("₩10,000")).toBeInTheDocument();
    expect(within(section).getByText("+₩0")).toBeInTheDocument();
    expect(within(section).getAllByText("-₩2,855,726")).toHaveLength(2);
    expect(within(section).getByText("25%")).toBeInTheDocument();
    expect(within(section).getByText("8건")).toBeInTheDocument();
    expect(within(section).getByText("32건")).toBeInTheDocument();
    expect(within(section).getAllByRole("article")).toHaveLength(3);
  });

  it("총 손익을 실현손익과 미실현손익의 합으로 계산한다", () => {
    expect(calculatePortfolioProfit({ invested: 1_000, realizedProfit: 100, unrealizedProfit: -250 })).toEqual({ totalProfit: -150, totalReturnPercent: -15 });
  });

  it("투자 원금이 0이면 수익률 대신 대시를 표시한다", () => {
    render(<PortfolioSummary {...values} invested={0} display={display} priceNote="note" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("큰 금액은 줄바꿈 방지 전용 DOM class에 둔다", () => {
    render(<PortfolioSummary {...values} marketValue={123_456_789_012_345} display={display} priceNote="note" />);
    expect(screen.getByTitle("₩123,456,789,012,345")).toHaveClass("portfolio-metric-value");
    expect(screen.getByTitle("₩8,324,740").closest("dl")).toHaveClass("portfolio-metric-details");
  });
});
