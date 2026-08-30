import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/i18n/messages";
import { locales } from "@/i18n/types";
import { PortfolioShell, usePortfolioShell } from "./portfolio-shell";
import { portfolioRouteForPath, portfolioRoutes } from "./routes";

const mocks = vi.hoisted(() => ({
  pathname: "/portfolio",
  mode: "ready" as "ready" | "loading" | "error",
  collections: new Map<string, unknown[]>(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/lib/use-local-collection", () => ({
  useLocalCollection: (name: string, fallback: unknown[]) => {
    const allItems = mocks.collections.get(name) ?? fallback;
    return {
      items: allItems,
      allItems,
      ready: mocks.mode !== "loading",
      loadError: mocks.mode === "error" && name === "accounts" ? "load failed" : "",
    };
  },
}));

const account = { id: "account-1", archivedAt: null, updatedAt: "2026-08-20T00:00:00.000Z" };
const stock = { id: "stock-1", deletedAt: null, updatedAt: "2026-08-22T00:00:00.000Z" };
const trade = { id: "trade-1", deletedAt: null, updatedAt: "2026-08-21T00:00:00.000Z" };

function reset() {
  mocks.pathname = "/portfolio";
  mocks.mode = "ready";
  mocks.collections = new Map([
    ["accounts", [account]],
    ["stocks", [stock]],
    ["trades", [trade]],
    ["preferences", [{ id: "currency", displayCurrency: "USD", updatedAt: "2026-08-19T00:00:00.000Z" }]],
    ["portfolio-plan-state", [{ id: "default", activeRevisionId: "revision-4" }]],
    ["portfolio-plan-revisions", [{ id: "revision-4", revisionNumber: 4 }]],
  ]);
}

function ContractProbe() {
  const { snapshot, formatMoney, formatPercentage, formatAsOf } = usePortfolioShell();
  return <output data-testid="contract-probe">{snapshot.status === "ready" ? [snapshot.portfolio.id, snapshot.portfolio.baseCurrency, snapshot.asOf, formatMoney(1250), formatPercentage(0.125), formatAsOf("2026-08-22T00:00:00.000Z")].join("|") : snapshot.status}</output>;
}

function SessionProbe() {
  const [value, setValue] = useState("kept");
  return <label>Session probe<input aria-label="Session probe" value={value} onChange={(event) => setValue(event.target.value)} /></label>;
}

describe("PortfolioShell", () => {
  beforeEach(reset);

  it("renders only Overview and Plan and marks the root Overview active", () => {
    render(<PortfolioShell><div>overview child</div></PortfolioShell>);
    const nav = screen.getByRole("navigation", { name: "포트폴리오 메뉴" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["개요", "계획"]);
    expect(within(nav).getByRole("link", { name: "개요" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "계획" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "개요" })).toHaveAttribute("href", "/portfolio");
    expect(within(nav).getByRole("link", { name: "계획" })).toHaveAttribute("href", "/portfolio/plan");
    expect(portfolioRouteForPath("/portfolio/")?.id).toBe("overview");
  });

  it("marks a nested route active without remounting the shared session", () => {
    const view = render(<PortfolioShell><SessionProbe /></PortfolioShell>);
    fireEvent.change(screen.getByLabelText("Session probe"), { target: { value: "still here" } });
    mocks.pathname = "/portfolio/plan/detail";
    view.rerender(<PortfolioShell><SessionProbe /></PortfolioShell>);
    expect(screen.getByRole("link", { name: "계획" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("Session probe")).toHaveValue("still here");
  });

  it("publishes portfolio identity, as-of, and locale-aware shared formatters", () => {
    render(<PortfolioShell><ContractProbe /></PortfolioShell>);
    expect(screen.getByLabelText("포트폴리오 선택")).toHaveValue("default");
    expect(screen.getByText("단일 포트폴리오 · V1")).toBeInTheDocument();
    expect(screen.getByText("USD")).toBeInTheDocument();
    expect(screen.getByText("리비전 4")).toBeInTheDocument();
    expect(screen.getByTestId("contract-probe")).toHaveTextContent("default|USD|2026-08-22T00:00:00.000Z|$1,250.00|12.5%|Aug 22, 2026");
  });

  it("renders loading, error with retry, and no-selection states", () => {
    mocks.mode = "loading";
    const loading = render(<PortfolioShell><div>hidden child</div></PortfolioShell>);
    expect(screen.getByRole("heading", { name: "포트폴리오 정보를 불러오는 중입니다." })).toBeInTheDocument();
    expect(screen.queryByText("hidden child")).not.toBeInTheDocument();
    loading.unmount();

    mocks.mode = "error";
    const error = render(<PortfolioShell><div>ready child</div></PortfolioShell>);
    expect(screen.getByRole("alert")).toHaveTextContent("포트폴리오 정보를 불러오지 못했습니다.");
    mocks.mode = "ready";
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(screen.getByText("ready child")).toBeInTheDocument();
    error.unmount();

    render(<PortfolioShell selectedPortfolioId={null}><div>hidden child</div></PortfolioShell>);
    expect(screen.getByRole("heading", { name: "선택된 포트폴리오가 없습니다." })).toBeInTheDocument();
    expect(screen.queryByText("hidden child")).not.toBeInTheDocument();
  });

  it("keeps the empty notice additive so route content remains available", () => {
    mocks.collections = new Map([
      ["accounts", [{ ...account, archivedAt: "2026-08-23T00:00:00.000Z" }]],
      ["stocks", [{ ...stock, deletedAt: "2026-08-23T00:00:00.000Z" }]],
      ["trades", [{ ...trade, deletedAt: "2026-08-23T00:00:00.000Z" }]],
      ["preferences", []],
    ]);
    render(<PortfolioShell><div>overview child</div></PortfolioShell>);
    expect(screen.getByRole("status")).toHaveTextContent("아직 포트폴리오 기록이 없습니다.");
    expect(screen.getByText("overview child")).toBeInTheDocument();
    expect(screen.getByText("KRW")).toBeInTheDocument();
  });
});

describe("portfolio shell localization and metadata", () => {
  it("translates dynamic navigation and shell state keys in every supported non-Korean locale", () => {
    const keys = [...portfolioRoutes.map((route) => route.label), "내 포트폴리오", "단일 포트폴리오 · V1", "포트폴리오 선택", "기준일", "활성 Plan", "활성 Plan 없음", "포트폴리오 메뉴", "포트폴리오 정보를 불러오는 중입니다.", "{name} 화면은 다음 단계에서 구현됩니다."];
    for (const locale of locales.filter((item) => item !== "ko")) {
      for (const key of keys) expect(translate(locale, key), `${locale}:${key}`).not.toBe(key);
    }
  });

  it("keeps Overview at the root and exposes Plan as the only second tab", () => {
    expect(portfolioRoutes).toMatchObject([{ id: "overview", href: "/portfolio", implemented: true }, { id: "plan", href: "/portfolio/plan", implemented: true }]);
  });
});
