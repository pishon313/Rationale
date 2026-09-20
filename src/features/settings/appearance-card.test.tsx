import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceCard } from "./appearance-card";
import { themeStorageKey } from "./theme-preference";

vi.mock("@/i18n/i18n-provider", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

describe("AppearanceCard", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.setAttribute("data-theme", "mint");
  });

  afterEach(() => vi.restoreAllMocks());

  it("defaults to an accessible Mint selection", async () => {
    const { container } = render(<AppearanceCard />);
    const mint = screen.getByRole("radio", { name: "민트" });
    const rose = screen.getByRole("radio", { name: "로즈 퍼플" });
    const midnight = screen.getByRole("radio", { name: "미드나이트" });
    const lemon = screen.getByRole("radio", { name: "레몬" });
    await waitFor(() => expect(mint).toBeChecked());
    expect(rose).not.toBeChecked();
    expect(midnight).not.toBeChecked();
    expect(lemon).not.toBeChecked();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByText("현재 테마")).toBeInTheDocument();
    expect(screen.getByText("밝고 낙관적인")).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-theme", "mint");
    expect(container.querySelector("fieldset > div")).toHaveClass("lg:grid-cols-1", "2xl:grid-cols-2");
  });

  it("applies and persists every palette immediately", async () => {
    render(<AppearanceCard />);
    for (const [name, id] of [["로즈 퍼플", "rose-purple"], ["미드나이트", "midnight"], ["레몬", "lemon"], ["민트", "mint"]] as const) {
      const option = screen.getByRole("radio", { name });
      fireEvent.click(option);
      expect(option).toBeChecked();
      expect(document.documentElement).toHaveAttribute("data-theme", id);
      expect(localStorage.getItem(themeStorageKey)).toBe(id);
    }
  });

  it("keeps the selected theme usable when persistence fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<AppearanceCard />);
    const rose = screen.getByRole("radio", { name: "로즈 퍼플" });
    expect(() => fireEvent.click(rose)).not.toThrow();
    expect(rose).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "rose-purple");
  });
});
