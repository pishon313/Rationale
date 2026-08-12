import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./app-sidebar";

const navigation = vi.hoisted(() => ({ pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("@/i18n/i18n-provider", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const desktopOrder = ["대시보드", "종목", "관찰 기록", "매수 계획", "매매", "회고", "분석", "계좌", "투자 원칙", "Note", "설정"];

describe("AppSidebar", () => {
  beforeEach(() => { navigation.pathname = "/dashboard"; });

  it("renders desktop navigation in three workflow groups", () => {
    render(<AppSidebar />);
    const nav = screen.getByRole("navigation", { name: "주요 메뉴" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(desktopOrder);
    const groups = nav.querySelectorAll(".app-nav-group");
    expect(groups).toHaveLength(3);
    expect([...groups].map((group) => within(group as HTMLElement).getAllByRole("link").map((link) => link.textContent))).toEqual([
      ["대시보드", "종목"],
      ["관찰 기록", "매수 계획", "매매", "회고", "분석"],
      ["계좌", "투자 원칙", "Note", "설정"],
    ]);
  });

  it("keeps the mobile primary navigation explicit and puts the rest in more", () => {
    render(<AppSidebar />);
    const nav = screen.getByRole("navigation", { name: "모바일 주요 메뉴" });
    expect(within(nav).getAllByRole("link").slice(0, 4).map((link) => link.textContent)).toEqual(["대시보드", "종목", "관찰 기록", "매수 계획"]);
    const more = nav.querySelector(".mobile-more-menu");
    expect(more).not.toBeNull();
    expect(within(more as HTMLElement).getAllByRole("link").map((link) => link.textContent)).toEqual(["매매", "회고", "분석", "계좌", "투자 원칙", "Note", "설정"]);
  });

  it("preserves active state for nested routes", () => {
    navigation.pathname = "/accounts/detail";
    render(<AppSidebar />);
    expect(within(screen.getByRole("navigation", { name: "주요 메뉴" })).getByRole("link", { name: "계좌" })).toHaveAttribute("aria-current", "page");
    expect(within(screen.getByRole("navigation", { name: "모바일 주요 메뉴" })).getByRole("link", { name: "계좌" })).toHaveAttribute("aria-current", "page");
  });
});
