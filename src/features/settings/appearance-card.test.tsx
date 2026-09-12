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
    await waitFor(() => expect(mint).toBeChecked());
    expect(rose).not.toBeChecked();
    expect(screen.getByText("현재 테마")).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-theme", "mint");
    expect(container.querySelector("fieldset > div")).toHaveClass("lg:grid-cols-1", "2xl:grid-cols-2");
  });

  it("applies and persists Rose Purple immediately, then switches back to Mint", async () => {
    render(<AppearanceCard />);
    const mint = screen.getByRole("radio", { name: "민트" });
    const rose = screen.getByRole("radio", { name: "로즈 퍼플" });

    fireEvent.click(rose);
    expect(rose).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "rose-purple");
    expect(localStorage.getItem(themeStorageKey)).toBe("rose-purple");

    fireEvent.click(mint);
    expect(mint).toBeChecked();
    expect(document.documentElement).toHaveAttribute("data-theme", "mint");
    expect(localStorage.getItem(themeStorageKey)).toBe("mint");
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
